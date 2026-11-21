import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B282 (E25): the unstable list `verify.unstable` is protected configuration ({ file, item, since }); adding a file
 * is a weakening, removing one is not; patterns and escaping paths are invalid_config; sdlc passes the list to every
 * verify command in SDLC_UNSTABLE_TESTS (set even when empty, never inherited); health reports an entry listed longer
 * than health.unstable_days (default 14).
 */

const AGENT = { CLAUDECODE: '1' };

type Entry = { file: string; item: string; since: string };

/** A script outside the project that prints the variable between markers. */
function printEnvScript(): string {
  const file = path.join(tempDir('sdlc-unstable-script-'), 'print-env.cjs');
  write(file, "process.stdout.write('<<' + (process.env.SDLC_UNSTABLE_TESTS ?? 'UNSET') + '>>\\n');\n");
  return file.replace(/\\/g, '/');
}

function project(unstable?: Entry[]) {
  const root = tempDir('sdlc-unstable-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (argv: string[], extra: NodeJS.ProcessEnv = {}) => runCli(argv, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'env', run: `node "${printEnvScript()}"`, required: true }];
  if (unstable) config.verify.unstable = unstable;
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const evidence = () => read(path.join(root, 'openspec/changes/add-export/verification.md'));
  return { root, cli, file, evidence };
}

function days(ago: number): string {
  return new Date(Date.now() - ago * 86_400_000).toISOString().slice(0, 10);
}

function proposalWarnings(p: ReturnType<typeof project>, value: string) {
  const r = p.cli(['config', 'propose', '--set', `verify.unstable=${value}`, '--reason', 'x', '--json'], AGENT);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const id = r.json<{ id: string }>().id;
  return p.cli(['config', 'show', id, '--json']).json<{ warnings: string[]; weakens: boolean }>();
}

describe('B282: the unstable list is protected configuration', () => {
  it('U1: a proposal that adds a file is a weakening naming the file and its item', () => {
    const p = project();
    const shown = proposalWarnings(p, JSON.stringify([{ file: 'test/flaky.test.ts', item: 'B900', since: days(0) }]));
    expect(shown.weakens).toBe(true);
    const text = shown.warnings.join('\n');
    expect(text).toContain('test/flaky.test.ts');
    expect(text).toContain('B900');
  }, 240000);

  it('negative U2: a proposal that only removes a file is not a weakening', () => {
    const p = project([{ file: 'test/flaky.test.ts', item: 'B900', since: days(1) }]);
    const shown = proposalWarnings(p, '[]');
    expect(shown.weakens).toBe(false);
    expect(shown.warnings.join('\n')).not.toContain('test/flaky.test.ts');
  }, 240000);

  it.each([['test/*.test.ts'], ['../other/a.test.ts']])('U3: the file %s is invalid_config naming its key', (bad) => {
    const p = project([{ file: bad, item: 'B900', since: days(0) }]);
    const r = p.cli(['verify', '--list', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('invalid_config');
    expect(r.stdout + r.stderr).toContain('verify.unstable[0].file');
  }, 240000);
});

describe('B282: the list reaches every verify command', () => {
  it('U4: a command sees the listed files, one per line, in order', () => {
    const p = project([
      { file: 'test/a.test.ts', item: 'B900', since: days(0) },
      { file: 'test/b.test.ts', item: 'B901', since: days(0) },
    ]);
    const r = p.cli(['verify', '--change', 'add-export', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.evidence()).toMatch(/<<test\/a\.test\.ts\r?\ntest\/b\.test\.ts>>/);
  }, 240000);

  it('U5: without a list the variable is set and empty, and an inherited value is not passed on', () => {
    const p = project();
    const r = p.cli(['verify', '--change', 'add-export', '--json'], { ...AGENT, SDLC_UNSTABLE_TESTS: 'test/evil.test.ts' });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.evidence()).toContain('<<>>');
    expect(p.evidence()).not.toContain('evil');
    expect(p.evidence()).not.toContain('UNSET');
  }, 240000);
});

describe('B282: health reports a test that stays unstable', () => {
  it('U6: an entry older than the default 14 days is reported; a recent one is not', () => {
    const p = project([
      { file: 'test/old.test.ts', item: 'B901', since: days(20) },
      { file: 'test/new.test.ts', item: 'B902', since: days(2) },
    ]);
    const r = p.cli(['health', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const findings = JSON.stringify(r.json<{ findings: unknown[] }>().findings);
    expect(findings).toContain('test/old.test.ts');
    expect(findings).toContain('B901');
    expect(findings).not.toContain('test/new.test.ts');
  }, 240000);
});
