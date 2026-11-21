import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B183 (E25): when a person enabled `verify.reuse`, `sdlc verify` records another change's passing run on the same
 * fingerprint instead of running the checks, if every configured check passed there with the same identity and
 * timeout and the source change's log confirms the run. Any difference runs the checks as today.
 */

const AGENT = { CLAUDECODE: '1' };
const A = 'first-change';
const B = 'second-change';

/** Scripts outside the project; each appends its name to a run log. */
function scripts() {
  const dir = tempDir('sdlc-reuse-scripts-');
  const runlog = path.join(dir, 'runs.txt').replace(/\\/g, '/');
  const script = (name: string, code: number) => {
    const file = path.join(dir, `${name}.cjs`);
    write(file, [`require('fs').appendFileSync(${JSON.stringify(runlog)}, '${name}\\n');`,
      `process.exit(${code});`, ''].join('\n'));
    return `node "${file.replace(/\\/g, '/')}"`;
  };
  return {
    typecheck: script('typecheck', 0),
    test: script('test', 0),
    broken: script('broken', 1),
    runs: () => (fs.existsSync(runlog) ? read(runlog).trim().split('\n').filter(Boolean) : []),
  };
}

function project(options: { reuse?: boolean; changes?: string[] } = {}) {
  const root = tempDir('sdlc-reuse-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const s = scripts();
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (argv: string[], extra: Record<string, string> = AGENT) => runCli(argv, root, { ...env, ...extra });
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  for (const id of options.changes ?? [A, B]) {
    expect(runCli(['new', id, '--json'], root, env).code).toBe(0);
    write(path.join(root, `openspec/changes/${id}/tasks.md`), '# Tasks\n\n- [x] 1.1 done\n');
  }
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [
    { name: 'typecheck', run: s.typecheck, required: true },
    { name: 'test', run: s.test, required: true },
  ];
  if (options.reuse) config.verify.reuse = true;
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const dir = (id: string) => path.join(root, 'openspec/changes', id);
  const statePath = (id: string) => path.join(dir(id), '.sdlc.yaml');
  const verify = (id: string, extra: string[] = []) => cli(['verify', '--change', id, ...extra, '--json']);
  const record = (id: string) => parse(read(statePath(id))).verify as Record<string, any>;
  const editRecord = (id: string, edit: (verify: Record<string, any>) => void) => {
    const state = parse(read(statePath(id)));
    edit(state.verify);
    write(statePath(id), stringify(state));
  };
  const gate = (id: string) => {
    const status = cli(['status', '--change', id, '--json']).json();
    return ((status.change ?? status).verification as { status: string }).status;
  };
  const setConfig = (edit: (cfg: Record<string, any>) => void) => {
    const cfg = parse(read(file));
    edit(cfg);
    write(file, stringify(cfg));
  };
  return { root, file, s, cli, dir, verify, record, editRecord, gate, setConfig };
}

/** A passed on the shared tree, then the run log is reset to what B does. */
function afterSourcePassed(p: ReturnType<typeof project>) {
  const first = p.verify(A);
  expect(first.code, first.stdout + first.stderr).toBe(0);
  expect(p.s.runs()).toEqual(['typecheck', 'test']);
  return p.record(A);
}

describe('B183: reuse is off until a person enables it', () => {
  it('R1: off by default, B runs every check although A passed on the same tree', () => {
    const p = project();
    afterSourcePassed(p);
    const r = p.verify(B);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('R2: enabling reuse is a weakening warning that names verify.reuse', () => {
    const p = project();
    const r = p.cli(['config', 'propose', '--set', 'verify.reuse=true', '--reason', 'x', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const shown = p.cli(['config', 'show', r.json<{ id: string }>().id, '--json'])
      .json<{ warnings: string[]; weakens: boolean }>();
    expect(shown.weakens).toBe(true);
    expect(shown.warnings.join('\n')).toContain('verify.reuse');
  }, 240000);

  it('negative R3: disabling reuse carries no warning about verify.reuse', () => {
    const p = project({ reuse: true });
    const r = p.cli(['config', 'propose', '--set', 'verify.reuse=false', '--reason', 'x', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const shown = p.cli(['config', 'show', r.json<{ id: string }>().id, '--json'])
      .json<{ warnings: string[]; weakens: boolean }>();
    expect(shown.warnings.join('\n')).not.toContain('verify.reuse');
  }, 240000);

  it('R4: a value that is not a boolean is invalid config naming verify.reuse', () => {
    const p = project();
    p.setConfig((cfg) => { cfg.verify.reuse = 'yes'; });
    const r = p.cli(['status', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('verify.reuse');
  }, 240000);
});

describe('B183: a confirmed passing run on the same tree is reused', () => {
  it('R5: B records A\'s run, runs nothing, names the source and passes the gate', () => {
    const p = project({ reuse: true });
    const source = afterSourcePassed(p);
    const r = p.verify(B);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().status).toBe('passed');
    expect(p.s.runs()).toEqual(['typecheck', 'test']);
    expect(p.record(B).reused_from).toEqual({ change: A, run_id: source.id });
    expect(p.record(B).status).toBe('passed');
    expect(p.gate(B)).toBe('passed');
  }, 240000);

  it('R6: an archived change is a source', () => {
    const p = project({ reuse: true });
    const source = afterSourcePassed(p);
    const archive = path.join(p.root, 'openspec/changes/archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(p.dir(A), path.join(archive, `2026-11-20-${A}`));
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test']);
    expect(p.record(B).reused_from).toEqual({ change: A, run_id: source.id });
  }, 240000);

  it('R7: --no-reuse runs every check', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    const r = p.verify(B, ['--no-reuse']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R8: --only never reuses', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    // A partial run never passes on its own, so its exit code is 1; what matters is what ran.
    p.verify(B, ['--only', 'typecheck']);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R9: --failed never reuses', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    p.verify(B, ['--only', 'typecheck']);
    const r = p.verify(B, ['--failed']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);
});

describe('B183: any difference runs verify as today', () => {
  it('negative R10: another fingerprint', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R11: a changed command line', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    p.setConfig((cfg) => { cfg.verify.commands[0].run = `${cfg.verify.commands[0].run} --changed`; });
    p.verify(B);
    expect(p.s.runs().length).toBeGreaterThan(2);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R12: a changed timeout', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    p.setConfig((cfg) => { cfg.verify.commands[1].timeout_seconds = 1234; });
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R13: an added check', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    p.setConfig((cfg) => { cfg.verify.commands.push({ name: 'lint', run: p.s.typecheck, required: true }); });
    p.verify(B);
    expect(p.s.runs().length).toBeGreaterThan(2);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R14: a failed source', () => {
    const p = project({ reuse: true });
    p.setConfig((cfg) => { cfg.verify.commands[1].run = p.s.broken; });
    p.verify(A);
    p.verify(B);
    expect(p.s.runs()).toEqual(['typecheck', 'broken', 'typecheck', 'broken']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R15: a planted record without its log entry is not a source', () => {
    const p = project({ reuse: true, changes: [A, B, 'third-change'] });
    const source = afterSourcePassed(p);
    const planted = parse(read(path.join(p.dir('third-change'), '.sdlc.yaml')));
    planted.verify = { ...source };
    write(path.join(p.dir('third-change'), '.sdlc.yaml'), stringify(planted));
    p.editRecord(A, (verify) => { verify.status = 'failed'; });
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R16: a reused record is never a source', () => {
    const p = project({ reuse: true, changes: [A, B, 'third-change'] });
    afterSourcePassed(p);
    expect(p.verify(B).code).toBe(0);
    expect(p.record(B).reused_from?.change).toBe(A);
    p.editRecord(A, (verify) => { verify.status = 'failed'; });
    expect(p.verify('third-change').code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record('third-change').reused_from).toBeUndefined();
  }, 240000);

  it('negative R17: a source without recorded timeouts is not reused', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    p.editRecord(A, (verify) => { for (const result of verify.results) delete result.timeout_seconds; });
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);
});

describe('B183: each command result records its timeout', () => {
  it('R18: the configured and the default timeout are recorded', () => {
    const p = project();
    p.setConfig((cfg) => { cfg.verify.commands[0].timeout_seconds = 1800; cfg.verify.timeout_seconds = 3600; });
    expect(p.verify(A).code).toBe(0);
    const results = p.record(A).results as Array<{ name: string; timeout_seconds?: number }>;
    expect(results.find((r) => r.name === 'typecheck')?.timeout_seconds).toBe(1800);
    expect(results.find((r) => r.name === 'test')?.timeout_seconds).toBe(3600);
  }, 240000);
});

describe('B183 review: the source is bound to what its logged runs actually ran', () => {
  it('negative R19: a source result that its logged run never ran is not reused (review F1)', () => {
    const p = project({ reuse: true });
    const source = afterSourcePassed(p);
    p.setConfig((cfg) => { cfg.verify.commands.push({ name: 'lint', run: p.s.typecheck, required: true }); });
    const typecheck = (source.results as Array<Record<string, unknown>>).find((r) => r.name === 'typecheck')!;
    p.editRecord(A, (verify) => {
      verify.results.push({ ...typecheck, name: 'lint' });
    });
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test', 'typecheck']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('negative R20: a source run under another unstable list is not reused (review F2)', () => {
    const p = project({ reuse: true });
    p.setConfig((cfg) => { cfg.verify.unstable = [{ file: 'test/flaky.test.ts', item: 'B900', since: '2026-11-20' }]; });
    afterSourcePassed(p);
    p.setConfig((cfg) => { delete cfg.verify.unstable; });
    expect(p.verify(B).code).toBe(0);
    expect(p.s.runs()).toEqual(['typecheck', 'test', 'typecheck', 'test']);
    expect(p.record(B).reused_from).toBeUndefined();
  }, 240000);

  it('R21: a reused record keeps only the configured checks, in their configured order (review F6)', () => {
    const p = project({ reuse: true });
    p.setConfig((cfg) => { cfg.verify.commands.unshift({ name: 'lint', run: p.s.typecheck, required: true }); });
    expect(p.verify(A).code).toBe(0);
    p.setConfig((cfg) => {
      cfg.verify.commands = cfg.verify.commands.filter((c: { name: string }) => c.name !== 'lint').reverse();
    });
    expect(p.verify(B).code).toBe(0);
    expect(p.record(B).reused_from?.change).toBe(A);
    expect((p.record(B).results as Array<{ name: string }>).map((r) => r.name)).toEqual(['test', 'typecheck']);
  }, 240000);

  it('R22: the terminal output of a reused run names the source change (review F5)', () => {
    const p = project({ reuse: true });
    afterSourcePassed(p);
    const r = p.cli(['verify', '--change', B]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toContain(A);
    expect(r.stdout + r.stderr).toContain('--no-reuse');
  }, 240000);
});
