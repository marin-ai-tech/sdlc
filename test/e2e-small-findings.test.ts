import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * The smaller findings of the E4 and E5 team runs of 2026-10-16, decided by the owner for 0.22.4.
 *
 * П3: the adopt draft listed 94 people with commit counts but no date, so authors who left could not be told apart;
 * `--apply` wrote all of them into roles.yaml. The draft shows each person's last commit, and `--apply` leaves out
 * people with no commit in the last 12 months.
 * П4: `sdlc layout scaffold` named the project after its folder ("lead") instead of package.json ("semver").
 * П10: init took both `npm test` and `npm run lint` although `posttest` already runs lint: every verify ran lint twice.
 * A script that the test script's pre/post hooks already run is not added again.
 * Т2: `sdlc new` said nothing about the lite track it suggested; only the last line of `sdlc status` did.
 * Т8: the audit planned one approval per gate, also on a high-risk change where spec and plan need the tech lead as
 * well (4 planned for 6 required approvals).
 */

const YEAR = 365 * 86_400_000;

function repo(pkg?: Record<string, unknown>) {
  const root = tempDir('sdlc-small-findings-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  if (pkg) write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'README.md'), '# x\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  return { root, cli };
}

function commitAs(root: string, author: string, date: Date, file: string): void {
  write(path.join(root, file), `${file}\n`);
  git(root, ['add', '-A']);
  const stamp = date.toISOString();
  const env = { ...process.env, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp };
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync('git', ['commit', '-q', '-m', file, '--author', author], { cwd: root, env });
}

describe('П3: the adopt draft dates people and leaves out those who left', () => {
  it('each person has a last commit date; --apply writes only people active in the last 12 months', () => {
    const p = repo({ name: 'demo' });
    commitAs(p.root, 'Old Author <old@example.com>', new Date(Date.now() - 3 * YEAR), 'old.txt');
    commitAs(p.root, 'New Author <new@example.com>', new Date(Date.now() - YEAR / 12), 'new.txt');
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const draft = p.cli(['adopt', '--json']).json<{ people: Array<{ email: string; lastCommit?: string }> }>();
    const old = draft.people.find((person) => person.email === 'old@example.com');
    const recent = draft.people.find((person) => person.email === 'new@example.com');
    expect(old?.lastCommit).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(recent?.lastCommit).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.cli(['adopt']).stdout).toMatch(/Old Author[^\n]*\d{4}-\d{2}-\d{2}/);
    expect(p.cli(['adopt', '--apply', '--json']).code).toBe(0);
    const roles = read(path.join(p.root, 'openspec/roles.yaml'));
    expect(roles).toContain('new@example.com');
    expect(roles).not.toContain('old@example.com');
  }, 240000);
});

describe('П4: the scaffold names the project from its manifest', () => {
  it('package.json name is the project name in the generated documents', () => {
    const p = repo({ name: 'semver' });
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(p.cli(['layout', 'scaffold', '--json']).code).toBe(0);
    const agents = read(path.join(p.root, 'AGENTS.md'));
    expect(agents).toMatch(/semver/);
    expect(agents).not.toContain(path.basename(p.root));
  }, 240000);

  it('negative: without a manifest the folder name stays', () => {
    const p = repo();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(p.cli(['layout', 'scaffold', '--json']).code).toBe(0);
    expect(read(path.join(p.root, 'AGENTS.md'))).toContain(path.basename(p.root));
  }, 240000);
});

describe('П10: verify commands are not run twice', () => {
  it('lint run by posttest is not added again; init says why', () => {
    const p = repo({ name: 'demo', scripts: { test: 'node -e 0', posttest: 'npm run lint', lint: 'node -e 0' } });
    const init = p.cli(['init', '--tools', 'none']);
    expect(init.code).toBe(0);
    const config = parse(read(path.join(p.root, 'openspec/sdlc.yaml')));
    expect(config.verify.commands.map((c: { name: string }) => c.name)).toEqual(['test']);
    expect(init.stdout).toMatch(/posttest/);
  }, 240000);

  it('negative: without hooks both scripts stay', () => {
    const p = repo({ name: 'demo', scripts: { test: 'node -e 0', lint: 'node -e 0' } });
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const config = parse(read(path.join(p.root, 'openspec/sdlc.yaml')));
    expect(config.verify.commands.map((c: { name: string }) => c.name)).toEqual(['lint', 'test']);
  }, 240000);
});

describe('Т2: sdlc new says which track it suggests', () => {
  it('a low-risk docs change: the output names lite and the command a person runs', () => {
    const p = repo({ name: 'demo' });
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const r = p.cli(['new', 'readme-run', '--kind', 'docs', '--risk', 'low']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/lite/);
    expect(r.stdout).toContain('sdlc track set lite --change readme-run');
  }, 240000);

  it('negative: a feature of medium risk gets no lite suggestion', () => {
    const p = repo({ name: 'demo' });
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const r = p.cli(['new', 'add-export']);
    expect(r.stdout).not.toContain('track set lite');
  }, 240000);
});

describe('Т8: the audit plans the high-risk approvals', () => {
  function planned(risk: string): number {
    const p = repo({ name: 'demo' });
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(p.cli(['new', 'hr', '--risk', risk, '--json']).code).toBe(0);
    const audit = p.cli(['audit', '--change', 'hr', '--json']).json();
    expect(fs.existsSync(path.join(p.root, 'openspec/changes/hr'))).toBe(true);
    return audit.metrics.participation.planned.approvals;
  }

  it('high risk: spec and plan need the tech lead too (6); low risk: one per gate (4)', () => {
    expect(planned('low')).toBe(4);
    expect(planned('high')).toBe(6);
  }, 240000);
});
