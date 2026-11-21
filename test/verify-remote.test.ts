import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { readChangeState } from '../src/core/change-state.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B252 (E25): a verify command marked `remote: true` runs only on a committed tree, receives the commit and a fresh
 * answer path, and passes only when it exits 0 and its JSON answer names the same commit with status passed. A busy or
 * silent remote has its own reason; the full log is kept with the evidence. An unmarked command is unchanged.
 */

const AGENT = { CLAUDECODE: '1' };
const ID = 'add-export';

type Mode = 'pass' | 'stale' | 'nocommit' | 'none' | 'busy' | 'failed' | 'exit1' | 'sleep' | 'log' | 'nolog'
  | 'bom' | 'biglog';

/** A fake remote outside the project: what it does is read from a mode file; it records what it saw. */
function fakeRemote() {
  const dir = tempDir('sdlc-remote-fake-');
  const slash = (p: string) => p.replace(/\\/g, '/');
  const modeFile = path.join(dir, 'mode.txt');
  const seenFile = path.join(dir, 'seen.jsonl');
  const script = path.join(dir, 'remote.cjs');
  write(modeFile, 'pass');
  write(script, [
    "const fs = require('fs');",
    `const mode = fs.readFileSync(${JSON.stringify(slash(modeFile))}, 'utf8').trim();`,
    'const e = process.env;',
    'const answerExisted = !!e.SDLC_VERIFY_ANSWER && fs.existsSync(e.SDLC_VERIFY_ANSWER);',
    `fs.appendFileSync(${JSON.stringify(slash(seenFile))}, JSON.stringify({ commit: e.SDLC_VERIFY_COMMIT,`,
    '  answer: e.SDLC_VERIFY_ANSWER, log: e.SDLC_VERIFY_LOG, answerExisted }) + "\\n");',
    // An unmarked command gets no answer path; it must not crash on a missing variable.
    'const answer = (body) => {',
    '  if (e.SDLC_VERIFY_ANSWER) fs.writeFileSync(e.SDLC_VERIFY_ANSWER, JSON.stringify(body));',
    '};',
    "const other = '0123456789abcdef0123456789abcdef01234567';",
    "if (mode === 'sleep') { setTimeout(() => process.exit(0), 60000); return; }",
    "if (mode === 'pass' || mode === 'exit1' || mode === 'nolog') answer({ commit: e.SDLC_VERIFY_COMMIT, status: 'passed' });",
    "if (mode === 'log') {",
    "  fs.writeFileSync(e.SDLC_VERIFY_LOG, Array.from({ length: 5000 }, (_, i) => 'line ' + (i + 1)).join('\\n') + '\\n');",
    "  answer({ commit: e.SDLC_VERIFY_COMMIT, status: 'passed' });",
    '}',
    "if (mode === 'stale') answer({ commit: other, status: 'passed' });",
    "if (mode === 'nocommit') answer({ status: 'passed' });",
    "if (mode === 'busy') answer({ commit: e.SDLC_VERIFY_COMMIT, status: 'busy' });",
    "if (mode === 'failed') answer({ commit: e.SDLC_VERIFY_COMMIT, status: 'failed' });",
    "if (mode === 'bom') fs.writeFileSync(e.SDLC_VERIFY_ANSWER,",
    "  '\\uFEFF' + JSON.stringify({ commit: e.SDLC_VERIFY_COMMIT, status: 'passed' }));",
    "if (mode === 'biglog') {",
    "  const line = 'x'.repeat(1023) + '\\n';",
    "  const fd = fs.openSync(e.SDLC_VERIFY_LOG, 'w');",
    "  for (let i = 0; i < 9 * 1024; i++) fs.writeSync(fd, line);",
    "  fs.writeSync(fd, 'the last line\\n');",
    '  fs.closeSync(fd);',
    "  answer({ commit: e.SDLC_VERIFY_COMMIT, status: 'passed' });",
    '}',
    "process.exit(mode === 'exit1' ? 1 : 0);",
    '',
  ].join('\n'));
  return {
    run: `node "${slash(script)}"`,
    mode: (value: Mode) => write(modeFile, value),
    seen: () => (fs.existsSync(seenFile)
      ? read(seenFile).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>) : []),
  };
}

interface Command { name: string; run: string; required: boolean; remote?: unknown; timeout_seconds?: number }

function project(commands: (remote: ReturnType<typeof fakeRemote>) => Command[]) {
  const root = tempDir('sdlc-remote-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const remote = fakeRemote();
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  expect(runCli(['new', ID, '--json'], root, env).code).toBe(0);
  write(path.join(root, `openspec/changes/${ID}/tasks.md`), '# Tasks\n\n- [x] 1.1 done\n');
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = commands(remote);
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const cli = (argv: string[], extra: Record<string, string> = {}) =>
    runCli(argv, root, { ...env, ...AGENT, ...extra });
  const verify = (extra: string[] = [], vars: Record<string, string> = {}) =>
    cli(['verify', '--change', ID, ...extra, '--json'], vars);
  const record = () => parse(read(path.join(root, `openspec/changes/${ID}/.sdlc.yaml`))).verify as Record<string, any>;
  const result = (name: string) => (record().results as Array<Record<string, any>>).find((r) => r.name === name)!;
  const row = (name: string) => read(path.join(root, `openspec/changes/${ID}/verification.md`))
    .split('\n').find((line) => line.startsWith(`| ${name} `)) ?? '';
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const gate = () => {
    const status = cli(['status', '--change', ID, '--json']).json();
    return ((status.change ?? status).verification as { status: string }).status;
  };
  return { root, file, remote, cli, verify, record, result, row, head, gate };
}

const remoteTest = (r: ReturnType<typeof fakeRemote>): Command[] => [{ name: 'suite', run: r.run, required: true, remote: true }];

describe('B252: the mark', () => {
  it('M1: an unmarked command gets no remote variables, runs on a dirty tree and passes on exit 0', () => {
    const p = project((r) => [{ name: 'suite', run: r.run, required: true }]);
    p.remote.mode('none');
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    const v = p.verify();
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(p.remote.seen()).toEqual([{ answerExisted: false }]);
    expect(p.result('suite').reason).toBeUndefined();
  }, 240000);

  it('M2: a mark that is not a boolean is invalid config naming the field', () => {
    const p = project((r) => [{ name: 'suite', run: r.run, required: true, remote: 'yes' }]);
    const r = p.cli(['status', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('verify.commands[0].remote');
  }, 240000);

  it('M3: the mark is part of the identity, so a local pass does not count for a remote check', () => {
    const p = project((r) => [{ name: 'suite', run: r.run, required: true }]);
    p.remote.mode('pass');
    expect(p.verify().code).toBe(0);
    const cfg = parse(read(p.file));
    cfg.verify.commands[0].remote = true;
    write(p.file, stringify(cfg));
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'mark remote']);
    expect(p.gate()).not.toBe('passed');
    const rerun = p.verify(['--failed']);
    expect(rerun.code, rerun.stdout + rerun.stderr).toBe(0);
    expect(p.remote.seen()).toHaveLength(2);
  }, 240000);
});

describe('B252: only a committed tree goes out', () => {
  it('D1: an uncommitted edit fails the check before it starts, naming the file', () => {
    const p = project(remoteTest);
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    const v = p.verify();
    expect(v.code).not.toBe(0);
    expect(p.remote.seen()).toEqual([]);
    expect(p.result('suite').reason).toBe('remote_dirty');
    expect(v.stdout + v.stderr).toContain('src/app.js');
  }, 240000);

  it('D2: an untracked file fails the check naming it', () => {
    const p = project(remoteTest);
    write(path.join(p.root, 'src/extra.js'), 'export const b = 1;\n');
    const v = p.verify();
    expect(v.code).not.toBe(0);
    expect(p.remote.seen()).toEqual([]);
    expect(p.result('suite').reason).toBe('remote_dirty');
    expect(v.stdout + v.stderr).toContain('src/extra.js');
  }, 240000);

  it('negative D3: edits only under openspec/ do not block the check', () => {
    const p = project(remoteTest);
    write(path.join(p.root, `openspec/changes/${ID}/notes.md`), 'local note\n');
    const v = p.verify();
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(p.remote.seen()).toHaveLength(1);
  }, 240000);
});

describe('B252: the commit, the answer and the log path', () => {
  it('E1: the command gets HEAD, an absent answer path and a log path inside the change', () => {
    const p = project(remoteTest);
    expect(p.verify().code).toBe(0);
    const [seen] = p.remote.seen();
    expect(seen.commit).toBe(p.head());
    expect(seen.answerExisted).toBe(false);
    const log = path.resolve(String(seen.log));
    expect(log.startsWith(path.resolve(p.root, `openspec/changes/${ID}/verification`))).toBe(true);
  }, 240000);

  it('A1: a matching answer with exit 0 passes the gate', () => {
    const p = project(remoteTest);
    const v = p.verify();
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(p.gate()).toBe('passed');
  }, 240000);

  it('negative A2: an answer that names another commit fails with no infrastructure reason', () => {
    const p = project(remoteTest);
    p.remote.mode('stale');
    expect(p.verify().code).not.toBe(0);
    expect(p.result('suite').reason).toBeUndefined();
    expect(p.gate()).not.toBe('passed');
  }, 240000);

  it('negative A3: an answer that names no commit fails', () => {
    const p = project(remoteTest);
    p.remote.mode('nocommit');
    expect(p.verify().code).not.toBe(0);
    expect(p.result('suite').reason).toBeUndefined();
  }, 240000);

  it('negative A4: a passed answer with exit code 1 fails', () => {
    const p = project(remoteTest);
    p.remote.mode('exit1');
    expect(p.verify().code).not.toBe(0);
    expect(p.gate()).not.toBe('passed');
  }, 240000);

  it('negative A5: an inherited answer path is replaced, and no answer is remote_no_answer', () => {
    const p = project(remoteTest);
    p.remote.mode('none');
    const planted = path.join(tempDir('sdlc-remote-planted-'), 'answer.json');
    write(planted, JSON.stringify({ commit: p.head(), status: 'passed' }));
    const v = p.verify([], { SDLC_VERIFY_ANSWER: planted });
    expect(v.code).not.toBe(0);
    const [seen] = p.remote.seen();
    expect(path.resolve(String(seen.answer))).not.toBe(path.resolve(planted));
    expect(seen.answerExisted).toBe(false);
    expect(p.result('suite').reason).toBe('remote_no_answer');
  }, 240000);

  it('negative A6: a failed answer fails with no infrastructure reason', () => {
    const p = project(remoteTest);
    p.remote.mode('failed');
    expect(p.verify().code).not.toBe(0);
    expect(p.result('suite').reason).toBeUndefined();
  }, 240000);
});

describe('B252: an unavailable or silent remote', () => {
  it('U1: a busy answer is remote_unavailable, recorded on the run, and the check ran once', () => {
    const p = project(remoteTest);
    p.remote.mode('busy');
    expect(p.verify().code).not.toBe(0);
    expect(p.remote.seen()).toHaveLength(1);
    expect(p.result('suite').reason).toBe('remote_unavailable');
    expect(p.record().reason).toBe('remote_unavailable');
  }, 240000);

  it('U2: a timeout is remote_no_answer with timed_out', () => {
    const p = project((r) => [{ name: 'suite', run: r.run, required: true, remote: true, timeout_seconds: 3 }]);
    p.remote.mode('sleep');
    expect(p.verify().code).not.toBe(0);
    expect(p.result('suite').timed_out).toBe(true);
    expect(p.result('suite').reason).toBe('remote_no_answer');
  }, 240000);

  it('negative U3: a local code failure wins over a busy remote', () => {
    const broken = path.join(tempDir('sdlc-remote-broken-'), 'broken.cjs');
    write(broken, 'process.exit(1);\n');
    const lint = `node "${broken.replace(/\\/g, '/')}"`;
    const p = project((r) => [...remoteTest(r), { name: 'lint', run: lint, required: true }]);
    p.remote.mode('busy');
    expect(p.verify().code).not.toBe(0);
    expect(p.result('suite').reason).toBe('remote_unavailable');
    expect(p.record().reason).toBeUndefined();
  }, 240000);
});

describe('B252: the full log', () => {
  it('L1: every line of the remote log is kept and the row names it', () => {
    const p = project(remoteTest);
    p.remote.mode('log');
    expect(p.verify().code).toBe(0);
    const kept = String(p.result('suite').log);
    const file = path.resolve(p.root, `openspec/changes/${ID}`, kept);
    expect(read(file).trim().split('\n')).toHaveLength(5000);
    expect(p.row('suite')).toContain(path.basename(file));
  }, 240000);

  it('L2: no log still passes and the row says so', () => {
    const p = project(remoteTest);
    p.remote.mode('nolog');
    expect(p.verify().code).toBe(0);
    expect(p.result('suite').log).toBeUndefined();
    expect(p.row('suite')).toMatch(/no log/i);
  }, 240000);
});

describe('B252 review: answer, log and record hardening', () => {
  it('V1: an answer with a UTF-8 byte order mark still passes (review: PowerShell writes one)', () => {
    const p = project(remoteTest);
    p.remote.mode('bom');
    const v = p.verify();
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(p.result('suite').reason).toBeUndefined();
  }, 240000);

  it('V2: a dirty-only failure records remote_dirty on the run, and the event detail is not a timeout', () => {
    const p = project(remoteTest);
    write(path.join(p.root, 'src/app.js'), 'export const a = 2;\n');
    expect(p.verify().code).not.toBe(0);
    expect(p.record().reason).toBe('remote_dirty');
    const log = read(path.join(p.root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
    const failed = log.filter((e: { event: string; change?: string }) => e.event === 'verify.failed' && e.change === ID);
    expect(failed).toHaveLength(1);
    expect(String(failed[0].detail)).toContain('suite=remote_dirty');
    expect(String(failed[0].detail)).not.toContain('timeout');
  }, 240000);

  it('V3: the kept log has one file per check, overwritten by the next run', () => {
    const p = project(remoteTest);
    p.remote.mode('log');
    expect(p.verify().code).toBe(0);
    expect(p.verify().code).toBe(0);
    const dir = path.join(p.root, `openspec/changes/${ID}/verification/remote`);
    expect(fs.readdirSync(dir).filter((name) => name.endsWith('.log'))).toEqual(['suite.log']);
  }, 240000);

  it('V4: a log over 8 MiB keeps its last part and says it was cut', () => {
    const p = project(remoteTest);
    p.remote.mode('biglog');
    expect(p.verify().code).toBe(0);
    const file = path.resolve(p.root, `openspec/changes/${ID}`, String(p.result('suite').log));
    const size = fs.statSync(file).size;
    expect(size).toBeLessThanOrEqual(8 * 1024 * 1024 + 512);
    const text = read(file);
    expect(text.trimEnd().endsWith('the last line')).toBe(true);
    expect(text.slice(0, 300)).toMatch(/cut|truncated/i);
  }, 240000);

  it('V5: a blocked log folder does not abort verify; the check runs and keeps no log', () => {
    const p = project(remoteTest);
    write(path.join(p.root, `openspec/changes/${ID}/verification/remote`), 'a file, not a folder\n');
    const v = p.verify();
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(p.remote.seen()).toHaveLength(1);
    expect(p.result('suite').log).toBeUndefined();
    const log = read(path.join(p.root, 'openspec/.sdlc/log.jsonl'));
    expect(log).toContain('"verify.passed"');
  }, 240000);

  it('negative V6: a tampered log path in the record is dropped when the state is read', () => {
    const p = project(remoteTest);
    p.remote.mode('log');
    expect(p.verify().code).toBe(0);
    const statePath = path.join(p.root, `openspec/changes/${ID}/.sdlc.yaml`);
    for (const bad of ['../../outside.log', 'verification/remote/a`b.log', 'verification/remote/x.log\n| y |']) {
      const state = parse(read(statePath));
      state.verify.results[0].log = bad;
      write(statePath, stringify(state));
      const result = readChangeState(path.dirname(statePath)).verify?.results[0] as { log?: string };
      expect(result.log, bad).toBeUndefined();
    }
  }, 240000);

  it('V7: --list shows the remote mark', () => {
    const p = project(remoteTest);
    const listed = p.cli(['verify', '--list', '--json']).json<{ commands: Array<{ name: string; remote?: boolean }> }>();
    expect(listed.commands.find((c) => c.name === 'suite')?.remote).toBe(true);
  }, 240000);
});
