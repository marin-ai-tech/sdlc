import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseConfig } from '../src/core/config.js';
import type { VerifyCommandRecord, VerifyMcpRecord, VerifyRecord } from '../src/core/change-state.js';
import { allChecksPassed, allConfiguredChecksPassed } from '../src/core/verify-merge.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B333 (E25): a check with `required: false` runs and is recorded, but its failure fails neither the run nor the
 * verify gate, as before 0.34.0. It still needs a result on the current code with an unchanged identity. A required
 * failure, a stale or cancelled result and a changed `required` flag still keep the gate closed, and a reuse source
 * with a failed optional check is never reused.
 */

const FP = 'f'.repeat(40);
const RUN = 'run-1';

const CONFIG = parseConfig({
  verify: {
    commands: [
      { name: 'main', run: 'node main.cjs', required: true },
      { name: 'extra', run: 'node extra.cjs', required: false },
    ],
    mcp: [{ name: 'ci', server: 'ci', tool: 'status', required: false, args: {} }],
  },
});

function command(name: string, required: boolean, exit: number, extra: Partial<VerifyCommandRecord> = {}) {
  return { name, command: `node ${name}.cjs`, exit_code: exit, duration_ms: 1, required,
    fingerprint: FP, run_id: RUN, attempt: 1, ...extra } as VerifyCommandRecord;
}

/** The arguments digest is part of an MCP check's identity (sha256 of the JSON of its arguments). */
const ARGS_DIGEST = createHash('sha256').update(JSON.stringify({})).digest('hex');

function mcp(ok: boolean, extra: Partial<VerifyMcpRecord> = {}): VerifyMcpRecord {
  return { name: 'ci', server: 'ci', tool: 'status', required: false, ok, duration_ms: 1,
    args_digest: ARGS_DIGEST, fingerprint: FP, run_id: RUN, attempt: 1, ...extra };
}

function record(results: VerifyCommandRecord[], mcpResults: VerifyMcpRecord[] = [mcp(true)]): VerifyRecord {
  return { status: 'failed', at: '2026-11-23T00:00:00.000Z', id: RUN, fingerprint: FP, results,
    mcp: mcpResults } as VerifyRecord;
}

describe('B333 unit: the gate rule counts only required checks as needing a pass', () => {
  it('U1: a passed required check and a failed optional check pass', () => {
    const r = record([command('main', true, 0), command('extra', false, 1)], [mcp(false)]);
    expect(allChecksPassed(r, CONFIG, FP, true)).toBe(true);
  });

  it('U2: negative: a failed required check fails beside a passed optional one', () => {
    const r = record([command('main', true, 1), command('extra', false, 0)]);
    expect(allChecksPassed(r, CONFIG, FP, true)).toBe(false);
  });

  it('U3: negative: an optional check with no result does not pass', () => {
    const r = record([command('main', true, 0)]);
    expect(allChecksPassed(r, CONFIG, FP, true)).toBe(false);
  });

  it('U4: negative: a cancelled optional result does not pass', () => {
    const r = record([command('main', true, 0), command('extra', false, null as unknown as number,
      { cancelled: 'SIGINT' })]);
    expect(allChecksPassed(r, CONFIG, FP, true)).toBe(false);
  });

  it('U5: negative: an optional result on another fingerprint does not pass', () => {
    const r = record([command('main', true, 0), command('extra', false, 1, { fingerprint: 'e'.repeat(40) })]);
    expect(allChecksPassed(r, CONFIG, FP)).toBe(false);
  });

  it('U6: negative: an optional result recorded as required (a changed flag) does not pass', () => {
    const r = record([command('main', true, 0), command('extra', true, 1)]);
    expect(allChecksPassed(r, CONFIG, FP, true)).toBe(false);
  });

  it('U7: negative: the reuse rule stays strict: a failed optional check is not a source', () => {
    const r = record([command('main', true, 0), command('extra', false, 1)], [mcp(false)]);
    expect(allChecksPassed(r, CONFIG, FP)).toBe(true);
    expect(allConfiguredChecksPassed(r, CONFIG, FP)).toBe(false);
    const clean = record([command('main', true, 0), command('extra', false, 0)]);
    expect(allConfiguredChecksPassed(clean, CONFIG, FP)).toBe(true);
  });

  it('U8: an optional check with exit 0 and a rejected answer passes the gate rule, not the reuse rule', () => {
    const r = record([command('main', true, 0), command('extra', false, 0, { answer_failed: true })]);
    expect(allChecksPassed(r, CONFIG, FP)).toBe(true);
    expect(allConfiguredChecksPassed(r, CONFIG, FP)).toBe(false);
  });

  it('U9: an optional check that timed out or failed its cleanup does not fail the gate rule', () => {
    const timedOut = record([command('main', true, 0), command('extra', false, null as unknown as number,
      { timed_out: true })]);
    const cleanup = record([command('main', true, 0), command('extra', false, 0, { cleanup_failed: true })]);
    expect(allChecksPassed(timedOut, CONFIG, FP)).toBe(true);
    expect(allChecksPassed(cleanup, CONFIG, FP)).toBe(true);
  });

  it('U10: negative: a failed required MCP check fails beside passed optional checks', () => {
    const config = parseConfig({
      verify: {
        commands: [{ name: 'extra', run: 'node extra.cjs', required: false }],
        mcp: [{ name: 'ci', server: 'ci', tool: 'status', required: true, args: {} }],
      },
    });
    const failed = record([command('extra', false, 0)], [mcp(false, { required: true })]);
    const ok = record([command('extra', false, 1)], [mcp(true, { required: true })]);
    expect(allChecksPassed(failed, config, FP)).toBe(false);
    expect(allChecksPassed(ok, config, FP)).toBe(true);
  });

  it('U11: negative: an optional MCP result for other arguments does not pass', () => {
    const r = record([command('main', true, 0), command('extra', false, 0)],
      [mcp(true, { args_digest: 'a'.repeat(64) })]);
    expect(allChecksPassed(r, CONFIG, FP)).toBe(false);
  });
});

const AGENT = { CLAUDECODE: '1' };
const A = 'first-change';
const B = 'second-change';

function scripts() {
  const dir = tempDir('sdlc-optional-scripts-');
  const runlog = path.join(dir, 'runs.txt').replace(/\\/g, '/');
  const script = (name: string, code: number) => {
    const file = path.join(dir, `${name}-${code}.cjs`);
    write(file, [`require('fs').appendFileSync(${JSON.stringify(runlog)}, '${name}\\n');`,
      `process.exit(${code});`, ''].join('\n'));
    return `node "${file.replace(/\\/g, '/')}"`;
  };
  return {
    script,
    runs: () => (fs.existsSync(runlog) ? read(runlog).trim().split('\n').filter(Boolean) : []),
    reset: () => fs.rmSync(runlog, { force: true }),
  };
}

function project(main: number, extra: number, options: { reuse?: boolean } = {}) {
  const root = tempDir('sdlc-optional-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const s = scripts();
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (argv: string[]) => runCli(argv, root, { ...env, ...AGENT });
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  for (const id of [A, B]) {
    expect(runCli(['new', id, '--json'], root, env).code).toBe(0);
    write(path.join(root, `openspec/changes/${id}/tasks.md`), '# Tasks\n\n- [x] 1.1 done\n');
  }
  const file = path.join(root, 'openspec/sdlc.yaml');
  const setConfig = (edit: (cfg: Record<string, any>) => void) => {
    const cfg = parse(read(file));
    edit(cfg);
    write(file, stringify(cfg));
  };
  setConfig((cfg) => {
    cfg.verify.commands = [
      { name: 'main', run: s.script('main', main), required: true },
      { name: 'extra', run: s.script('extra', extra), required: false },
    ];
    if (options.reuse) cfg.verify.reuse = true;
  });
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const statePath = (id: string) => path.join(root, 'openspec/changes', id, '.sdlc.yaml');
  const verify = (id: string, extra: string[] = []) => cli(['verify', '--change', id, ...extra, '--json']);
  const recordOf = (id: string) => parse(read(statePath(id))).verify as Record<string, any>;
  const editRecord = (id: string, edit: (verify: Record<string, any>) => void) => {
    const state = parse(read(statePath(id)));
    edit(state.verify);
    write(statePath(id), stringify(state));
  };
  const gate = (id: string) => {
    const status = cli(['status', '--change', id, '--json']).json();
    return ((status.change ?? status).verification as { status: string }).status;
  };
  const evidence = (id: string) => read(path.join(root, 'openspec/changes', id, 'verification.md'));
  return { root, s, verify, recordOf, editRecord, gate, setConfig, evidence };
}

const out = (r: { stdout: string; stderr: string }) => r.stdout + r.stderr;

describe('B333: a failing optional check does not fail the run or the gate', () => {
  it('O1: a passing required check and a failing optional check: exit 0, gate passed, evidence marks it', () => {
    const p = project(0, 1);
    const run = p.verify(A);
    expect(run.code, out(run)).toBe(0);
    expect(p.gate(A)).toBe('passed');
    expect(p.evidence(A)).toMatch(/extra \(optional\)/);
  }, 240000);

  it('O2: negative: a failing required check still fails beside a passing optional one', () => {
    const p = project(1, 0);
    const run = p.verify(A);
    expect(run.code, out(run)).not.toBe(0);
    expect(p.gate(A)).toBe('failed');
  }, 240000);

  it('O3: negative: after an edit, an --only run of the required check does not pass the gate', () => {
    const p = project(0, 1);
    expect(p.verify(A).code).toBe(0);
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    const only = p.verify(A, ['--only', 'main']);
    expect(only.code, out(only)).not.toBe(0);
    expect(p.gate(A)).not.toBe('passed');
  }, 240000);

  it('O4: negative: making the optional check required closes the gate until it passes', () => {
    const p = project(0, 1);
    expect(p.verify(A).code).toBe(0);
    p.setConfig((cfg) => {
      cfg.verify.commands[1].required = true;
    });
    expect(p.gate(A)).not.toBe('passed');
  }, 240000);

  it('O5: a 0.34.0 record failed only by the optional check: --failed reruns it alone and passes', () => {
    const p = project(0, 1);
    expect(p.verify(A).code).toBe(0);
    p.editRecord(A, (verify) => {
      verify.status = 'failed';
    });
    expect(p.gate(A)).toBe('failed');
    p.s.reset();
    const rerun = p.verify(A, ['--failed']);
    expect(rerun.code, out(rerun)).toBe(0);
    expect(p.s.runs()).toEqual(['extra']);
    expect(p.gate(A)).toBe('passed');
  }, 240000);

  it('O6: negative: a source run with a failed optional check is not reused; the checks run', () => {
    const p = project(0, 1, { reuse: true });
    const first = p.verify(A);
    expect(first.code, out(first)).toBe(0);
    p.s.reset();
    const second = p.verify(B);
    expect(second.code, out(second)).toBe(0);
    expect(p.s.runs()).toEqual(['main', 'extra']);
    expect(p.recordOf(B).reused_from).toBeUndefined();
  }, 240000);
});
