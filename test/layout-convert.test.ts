import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { defaultConfig } from '../src/core/config.js';
import { applyConversion, planConversion } from '../src/core/layout.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const gitOut = (cwd: string, args: string[]) => spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout.trim();
const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

function legacyRepo(): string {
  const root = tempDir('sdlc-convert-');
  initGitRepo(root);
  write(path.join(root, 'README.md'), '# Legacy\n\nSee [architecture](ARCHITECTURE.md), [ADR 1](docs/adr/0001-db.md) and [security](SECURITY.md).\n');
  // Enough unchanged text that git still detects the rename after the link rewrites.
  const body = Array.from({ length: 12 }, (_, i) => `The system has layer ${i + 1}, described here in plain words that do not change.`).join('\n');
  write(path.join(root, 'ARCHITECTURE.md'), `# Arch\n\n${body}\n\nDecisions: [ADRs](docs/adr/). Back to [readme](README.md). Specs: [greeting](openspec/specs/greeting/spec.md).\n`);
  write(path.join(root, 'openspec/specs/greeting/spec.md'), '# Greeting\n');
  write(path.join(root, 'SECURITY.md'), '# Security\n');
  write(path.join(root, 'CONTRIBUTING.md'), '# Contributing\n');
  write(path.join(root, 'docs/adr/0001-db.md'), '# ADR 1\n\nContext: [arch](../../ARCHITECTURE.md).\n');
  write(path.join(root, 'docs/guide.md'), 'Read [the architecture](../ARCHITECTURE.md#layers) and [external](https://example.com/ARCHITECTURE.md).\n');
  write(path.join(root, 'openspec/changes/x/proposal.md'), 'Keep [arch](../../../ARCHITECTURE.md) as written.\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'legacy layout']);
  return root;
}

describe('planConversion', () => {
  let root: string;
  beforeEach(() => {
    root = legacyRepo();
  });

  it('plans moves to canonical paths and the link rewrites they need', () => {
    const plan = planConversion(root, defaultConfig());
    expect(plan.moves).toEqual(expect.arrayContaining([
      { role: 'architecture', from: 'ARCHITECTURE.md', to: 'docs/architecture.md' },
      { role: 'decisions', from: 'docs/adr/', to: 'docs/decisions/' },
    ]));
    const files = plan.linkRewrites.map((l) => l.file).sort();
    expect(files).toEqual(['ARCHITECTURE.md', 'README.md', 'docs/adr/0001-db.md', 'docs/guide.md']);
    expect(plan.conflicts).toEqual([]);
  });

  it('negative: pinned paths are skipped with a reason, openspec/ is never touched', () => {
    const plan = planConversion(root, defaultConfig());
    const moved = plan.moves.map((m) => m.from);
    for (const pinned of ['README.md', 'SECURITY.md', 'CONTRIBUTING.md']) expect(moved).not.toContain(pinned);
    expect(plan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'security', path: 'SECURITY.md' }),
      expect.objectContaining({ role: 'conventions', path: 'CONTRIBUTING.md' }),
    ]));
    expect(plan.linkRewrites.map((l) => l.file).some((f) => f.startsWith('openspec/'))).toBe(false);
  });

  it('negative: never moves over an existing canonical file', () => {
    write(path.join(root, 'docs/architecture.md'), '# another\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'both']);
    // Unmapped: the canonical file wins detection; the alias is skipped, not moved over it.
    const plan = planConversion(root, defaultConfig());
    expect(plan.moves.find((m) => m.role === 'architecture')).toBeUndefined();
    expect(plan.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'architecture', path: 'ARCHITECTURE.md', reason: expect.stringMatching(/exists/) }),
    ]));
    // Mapped to the alias: the mapping wins detection, so the move is wanted but blocked.
    const config = defaultConfig();
    config.layout = { architecture: 'ARCHITECTURE.md' };
    const mapped = planConversion(root, config);
    expect(mapped.moves.find((m) => m.role === 'architecture')).toBeUndefined();
    expect(mapped.conflicts).toEqual([
      expect.objectContaining({ role: 'architecture', from: 'ARCHITECTURE.md', to: 'docs/architecture.md', reason: expect.stringMatching(/exists/) }),
    ]);
  });

  it('is read-only', () => {
    const before = gitOut(root, ['status', '--porcelain']);
    planConversion(root, defaultConfig());
    expect(gitOut(root, ['status', '--porcelain'])).toBe(before);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
  });
});

describe('applyConversion', () => {
  let root: string;
  beforeEach(() => {
    root = legacyRepo();
  });

  it('moves with git (history follows), rewrites relative links, keeps anchors and external links', () => {
    const config = defaultConfig();
    config.layout = { architecture: 'ARCHITECTURE.md', decisions: 'docs/adr/' };
    applyConversion(root, config, planConversion(root, config));

    expect(exists(root, 'ARCHITECTURE.md')).toBe(false);
    expect(read(path.join(root, 'docs/architecture.md'))).toContain('# Arch');
    expect(exists(root, 'docs/decisions/0001-db.md')).toBe(true);
    // Moves and link rewrites are staged together, so `git diff --cached` shows the whole conversion.
    const status = gitOut(root, ['status', '--porcelain']);
    expect(status).toMatch(/^R {2}ARCHITECTURE\.md -> docs\/architecture\.md$/m);
    expect(status).not.toMatch(/^.M /m);

    expect(read(path.join(root, 'README.md'))).toContain('[architecture](docs/architecture.md)');
    expect(read(path.join(root, 'README.md'))).toContain('[ADR 1](docs/decisions/0001-db.md)');
    expect(read(path.join(root, 'README.md'))).toContain('[security](SECURITY.md)');
    const arch = read(path.join(root, 'docs/architecture.md'));
    expect(arch).toContain('[ADRs](decisions/)');
    expect(arch).toContain('[readme](../README.md)');
    // Excluded folders are never moved or rewritten, but links TO them from a moved file must still resolve.
    expect(arch).toContain('[greeting](../openspec/specs/greeting/spec.md)');
    expect(read(path.join(root, 'docs/decisions/0001-db.md'))).toContain('[arch](../architecture.md)');
    const guide = read(path.join(root, 'docs/guide.md'));
    expect(guide).toContain('[the architecture](architecture.md#layers)');
    expect(guide).toContain('(https://example.com/ARCHITECTURE.md)');
    expect(read(path.join(root, 'openspec/changes/x/proposal.md'))).toContain('(../../../ARCHITECTURE.md)');

    expect(config.layout).toEqual({});
  });

  it('negative: refuses on a dirty worktree and changes nothing', () => {
    write(path.join(root, 'notes.md'), 'uncommitted\n');
    const plan = planConversion(root, defaultConfig());
    expect(() => applyConversion(root, defaultConfig(), plan)).toThrow(/dirty|uncommitted|clean/i);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
    expect(exists(root, 'docs/architecture.md')).toBe(false);
  });

  it('negative: refuses a plan with conflicts', () => {
    const plan = planConversion(root, defaultConfig());
    plan.conflicts.push({ role: 'glossary', from: 'GLOSSARY.md', to: 'docs/glossary.md', reason: 'target exists' });
    expect(() => applyConversion(root, defaultConfig(), plan)).toThrow(/conflict/i);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
  });
});

/** A legacy repository with sdlc initialized and adapted, all committed. */
function adaptedRepo(): { root: string; cli: (args: string[]) => ReturnType<typeof runCli> } {
  const root = legacyRepo();
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['layout', 'adapt', '--json']).code).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'sdlc init + adapt']);
  return { root, cli };
}

const logEvents = (dir: string) => read(path.join(dir, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);

describe('sdlc layout convert (CLI)', () => {
  it('is a dry run by default and changes nothing', () => {
    const { root, cli } = adaptedRepo();
    const dry = cli(['layout', 'convert', '--json']);
    expect(dry.code, dry.stderr).toBe(0);
    expect(dry.json()).toMatchObject({ applied: false });
    expect(dry.json().plan.moves.length).toBeGreaterThan(0);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
    expect(gitOut(root, ['status', '--porcelain'])).toBe('');
    expect(gitOut(root, ['worktree', 'list']).split('\n')).toHaveLength(1);
  });

  it('--apply --in-place converts the working copy, saves the config and logs it', () => {
    const { root, cli } = adaptedRepo();
    const applied = cli(['layout', 'convert', '--apply', '--in-place', '--json']);
    expect(applied.code, applied.stderr).toBe(0);
    expect(applied.json()).toMatchObject({ applied: true, mode: 'in-place' });
    expect(exists(root, 'docs/architecture.md')).toBe(true);
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).layout?.architecture).toBeUndefined();
    expect(logEvents(root)).toContain('layout.converted');
  });
});

describe('sdlc layout convert --apply (worktree mode, the default)', () => {
  it('converts in a new worktree on a new branch and commits there', () => {
    const { root, cli } = adaptedRepo();
    const r = cli(['layout', 'convert', '--apply', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const out = r.json();
    const wt = path.join(path.dirname(root), `${path.basename(root)}-layout-convert`);
    expect(out).toMatchObject({ applied: true, mode: 'worktree', worktree: { branch: 'sdlc/layout-convert' } });
    expect(path.resolve(out.worktree.path)).toBe(path.resolve(wt));
    expect(out.worktree.commit).toMatch(/^[0-9a-f]{40}$/);

    expect(exists(wt, 'docs/architecture.md')).toBe(true);
    expect(exists(wt, 'ARCHITECTURE.md')).toBe(false);
    expect(read(path.join(wt, 'README.md'))).toContain('[architecture](docs/architecture.md)');
    expect(gitOut(wt, ['status', '--porcelain'])).toBe('');
    expect(gitOut(wt, ['rev-parse', 'HEAD'])).toBe(out.worktree.commit);
    expect(gitOut(wt, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('sdlc/layout-convert');
    expect(gitOut(wt, ['log', '-1', '--format=%an <%ae>'])).toBe('Pat Owner <pat@example.com>');
    expect(gitOut(wt, ['log', '--follow', '--format=%s', '--', 'docs/architecture.md'])).toContain('legacy layout');
    expect(parse(read(path.join(wt, 'openspec/sdlc.yaml'))).layout?.architecture).toBeUndefined();
    expect(logEvents(wt)).toContain('layout.converted');
  });

  it('negative: the main working copy, its branch, config and log stay untouched', () => {
    const { root, cli } = adaptedRepo();
    const branch = gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const head = gitOut(root, ['rev-parse', 'HEAD']);
    const log = read(path.join(root, 'openspec/.sdlc/log.jsonl'));
    expect(cli(['layout', 'convert', '--apply', '--json']).code).toBe(0);
    expect(gitOut(root, ['status', '--porcelain'])).toBe('');
    expect(gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(branch);
    expect(gitOut(root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
    expect(exists(root, 'docs/architecture.md')).toBe(false);
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).layout?.architecture).toBe('ARCHITECTURE.md');
    expect(read(path.join(root, 'openspec/.sdlc/log.jsonl'))).toBe(log);
  });

  it('negative: refuses when the branch or the worktree folder already exists, and creates nothing', () => {
    const { root, cli } = adaptedRepo();
    expect(cli(['layout', 'convert', '--apply', '--json']).code).toBe(0);
    const again = cli(['layout', 'convert', '--apply', '--json']);
    expect(again.code).toBe(1);
    expect(['branch_exists', 'worktree_exists']).toContain(again.json().status[0].code);

    const folder = tempDir('sdlc-occupied-');
    const occupied = cli(['layout', 'convert', '--apply', '--branch', 'sdlc/other', '--worktree', folder, '--json']);
    expect(occupied.code).toBe(1);
    expect(occupied.json().status[0].code).toBe('worktree_exists');
    expect(gitOut(root, ['branch', '--list', 'sdlc/other'])).toBe('');
  });

  it('honours --worktree and --branch', () => {
    const { root, cli } = adaptedRepo();
    const target = path.join(tempDir('sdlc-wt-parent-'), 'conv');
    const r = cli(['layout', 'convert', '--apply', '--worktree', target, '--branch', 'docs/canonical-layout', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(path.resolve(r.json().worktree.path)).toBe(path.resolve(target));
    expect(gitOut(target, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('docs/canonical-layout');
    expect(exists(target, 'docs/decisions/0001-db.md')).toBe(true);
    expect(exists(root, 'docs/adr/0001-db.md')).toBe(true);
  });

  it('converts committed content only: uncommitted work in the main copy is a warning, not a refusal', () => {
    const { root, cli } = adaptedRepo();
    write(path.join(root, 'notes.md'), 'draft, not committed: [arch](ARCHITECTURE.md)\n');
    const r = cli(['layout', 'convert', '--apply', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().warnings.join('\n')).toMatch(/uncommitted/i);
    expect(exists(r.json().worktree.path, 'notes.md')).toBe(false);
    expect(read(path.join(root, 'notes.md'))).toContain('(ARCHITECTURE.md)');
  });

  it('negative: --in-place still refuses a dirty working copy', () => {
    const { root, cli } = adaptedRepo();
    write(path.join(root, 'notes.md'), 'uncommitted\n');
    const r = cli(['layout', 'convert', '--apply', '--in-place', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('dirty_worktree');
    expect(exists(root, 'ARCHITECTURE.md')).toBe(true);
  });
});
