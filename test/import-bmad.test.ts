import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { detectBmadDocs, planBmadImport } from '../src/core/import-bmad.js';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/bmad/claims');
const PRD = 'prd-claims-status.md';
const SPEC = 'spec-claims-status.md';
const ARCH = 'architecture-claims-status.md';

/** An initialized project with the BMAD output copied into `_bmad-output/claims/` (all three, or the named ones). */
function project(files: string[] = [PRD, SPEC, ARCH]) {
  const root = tempDir('sdlc-bmad-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  for (const f of files) write(path.join(root, '_bmad-output/claims', f), fs.readFileSync(path.join(FIXTURES, f), 'utf-8'));
  write(path.join(root, '_bmad-output/notes.md'), '# Meeting notes\n\nNot a BMAD artifact.\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli, dir: (id: string) => path.join(root, 'openspec/changes', id) };
}

describe('BMAD detection and mapping (core)', () => {
  it('detects PRD, SPEC and architecture by content, ignoring other markdown', () => {
    const { root } = project();
    const docs = detectBmadDocs(root, '_bmad-output');
    expect(docs.map((d) => d.kind).sort()).toEqual(['architecture', 'prd', 'spec']);
    expect(docs.find((d) => d.kind === 'spec')!.path).toBe('_bmad-output/claims/spec-claims-status.md');
  });

  it('negative: a folder without BMAD artifacts is refused', () => {
    const root = tempDir('sdlc-bmad-none-');
    write(path.join(root, 'docs/readme.md'), '# Hello\n');
    expect(() => detectBmadDocs(root, 'docs')).toThrow(/BMAD/);
  });

  it('with a SPEC, capabilities come from CAP-N; intent from the PRD; design and deferred from the architecture', () => {
    const { root } = project();
    const plan = planBmadImport(root, '_bmad-output/claims', 'claims-status');
    const file = (p: string) => plan.files.find((f) => f.path === p)?.content ?? '';
    const specFiles = plan.files.filter((f) => /^specs\/[^/]+\/spec\.md$/.test(f.path));
    expect(specFiles.length).toBeGreaterThan(0);
    const specs = specFiles.map((f) => f.content).join('\n');
    expect(specs).toContain('CAP-1');
    expect(specs).toContain('CAP-2');
    expect(specs).not.toContain('FR-1');
    expect(specs.match(/^### Requirement: /gm)).toHaveLength(2);
    expect(specs.match(/^#### Scenario: /gm)!.length).toBeGreaterThanOrEqual(2);
    for (const block of specs.split(/^### Requirement: /m).slice(1)) expect(block).toMatch(/\b(SHALL|MUST)\b/);
    expect(file('intent.md')).toMatch(/call support/i);
    expect(file('intent.md')).toMatch(/## Open questions[\s\S]*brokers/i);
    expect(file('intent.md')).toMatch(/## Out of scope[\s\S]*Editing/i);
    expect(file('proposal.md')).toMatch(/## Why[\s\S]*support/);
    expect(file('design.md')).toMatch(/AD-1[\s\S]*read model/i);
    expect(plan.deferred.map((d) => d.title)).toEqual([expect.stringMatching(/SMS/), expect.stringMatching(/Broker/)]);
  });

  it('with only a PRD, requirements come from FR-N with their testable consequences as scenarios', () => {
    const { root } = project([PRD]);
    const plan = planBmadImport(root, '_bmad-output/claims', 'claims-status');
    const specs = plan.files.filter((f) => f.path.startsWith('specs/')).map((f) => f.content).join('\n');
    expect(specs).toContain('FR-1');
    expect(specs).toContain('FR-2');
    expect(specs).toMatch(/another policyholder is never shown/);
    expect(plan.files.some((f) => f.path === 'design.md')).toBe(false);
  });

  it('reports sections it could not place instead of dropping them silently', () => {
    const { root } = project([PRD]);
    const plan = planBmadImport(root, '_bmad-output/claims', 'claims-status');
    expect(plan.unmapped.map((u) => u.section)).toEqual(expect.arrayContaining([expect.stringMatching(/Glossary/)]));
  });
});

describe('sdlc import bmad (CLI)', () => {
  it('creates a draft change that passes OpenSpec validation, keeps the sources, records deferred work; nothing approved', () => {
    const { root, cli, dir } = project();
    const r = cli(['import', 'bmad', '_bmad-output/claims', '--change', 'claims-status', '--kind', 'feature', '--risk', 'medium', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const out = r.json();
    expect(out.change).toBe('claims-status');
    expect(out.docs).toHaveLength(3);
    for (const f of ['intent.md', 'proposal.md', 'design.md']) expect(fs.existsSync(path.join(dir('claims-status'), f)), f).toBe(true);
    for (const f of [PRD, SPEC, ARCH]) expect(fs.existsSync(path.join(dir('claims-status'), 'sources/bmad', f)), f).toBe(true);

    const state = parse(read(path.join(dir('claims-status'), '.sdlc.yaml')));
    expect(state.source).toEqual({ type: 'bmad', ref: '_bmad-output/claims' });
    expect(state.history.map((h: { event: string }) => h.event)).toContain('change.imported');

    const status = cli(['status', '--change', 'claims-status', '--json']).json();
    expect(status.change.gates.every((g: { status: string }) => g.status !== 'approved')).toBe(true);

    const validate = cli(['validate', '--change', 'claims-status', '--json']);
    expect(validate.code, validate.stdout).toBe(0);

    const deferred = cli(['defer', 'list', '--change', 'claims-status', '--json']).json();
    expect(deferred.items.map((i: { title: string }) => i.title)).toEqual([expect.stringMatching(/SMS/), expect.stringMatching(/Broker/)]);
  });

  it('--dry-run shows the plan and writes nothing', () => {
    const { root, cli, dir } = project();
    const r = cli(['import', 'bmad', '_bmad-output/claims', '--change', 'claims-status', '--dry-run', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().files.map((f: { path: string }) => f.path)).toContain('intent.md');
    expect(fs.existsSync(dir('claims-status'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'openspec/deferred-work.md'))).toBe(false);
  });

  it('negative: an existing change and a folder without BMAD artifacts are refused', () => {
    const { root, cli } = project();
    expect(cli(['new', 'claims-status', '--json']).code).toBe(0);
    const exists = cli(['import', 'bmad', '_bmad-output/claims', '--change', 'claims-status', '--json']);
    expect(exists.code).toBe(1);
    expect(exists.json().status[0].code).toBe('change_exists');
    write(path.join(root, 'empty/readme.md'), '# nothing\n');
    const none = cli(['import', 'bmad', 'empty', '--change', 'other', '--json']);
    expect(none.code).toBe(1);
    expect(none.json().status[0].code).toBe('no_bmad_artifacts');
  });
});
