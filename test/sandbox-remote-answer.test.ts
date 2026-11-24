import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, git, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * B332: this repository's server tool answers the remote verify contract of B252 (src/core/verify-remote.ts). With
 * SDLC_VERIFY_ANSWER set it writes {commit, status} after the server run; with SDLC_VERIFY_LOG set it copies the full
 * run.log of the server run. A refused run, another commit or an unknown result writes no answer, a stale answer is
 * never left behind, a forged run folder writes no log, and without the variables nothing changes.
 * The fake ssh is a function parameter, as in sandbox-remote-test.test.ts: an environment variable that replaced ssh
 * would let a verify pass with nothing tested.
 */

const ORIGIN = 'ssh://tester@server.example/home/tester/git/x.git';
const SCRIPT = 'echo server\nmain "$@"\n';

interface SshResult { status: number | null; signal: string | null; stdout?: string; error?: Error }
interface SshCall { args: string[]; script: string; capture?: boolean; timeoutSeconds?: number }

function project(): string {
  const root = tempDir('sdlc-remote-answer-');
  initGitRepo(root);
  write(path.join(root, 'scripts/sandbox/test.sh'), SCRIPT);
  write(path.join(root, 'a.txt'), 'a\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'first']);
  git(root, ['remote', 'add', 'origin', ORIGIN]);
  return root;
}

function head(root: string): string {
  return spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
}

/** A run folder the server would print for this commit. */
function runFolder(commit: string): string {
  return `sandbox_runs/sdlc/sdlc-sandbox-${commit.slice(0, 8)}-20261124_073108`;
}

function lastLine(folder: string, exit = 0): string {
  return `sandbox finished 09:07:07, exit=${exit}, logs: ${folder}\n`;
}

/** The second ssh reads only the part of run.log that sdlc keeps (LOG_LIMIT in src/core/verify-remote.ts). */
const KEPT_BYTES = String(8 * 1024 * 1024);

/** Files for the contract in a folder of their own, as sdlc gives them. */
function contract(root: string, extra: Record<string, string> = {}) {
  const dir = tempDir('sdlc-remote-contract-');
  const answer = path.join(dir, 'answer.json');
  const log = path.join(dir, 'check.log');
  const env = { SDLC_VERIFY_COMMIT: head(root), SDLC_VERIFY_ANSWER: answer, SDLC_VERIFY_LOG: log, ...extra };
  return { dir, answer, log, env };
}

async function remote(root: string, args: string[], results: SshResult[], env: Record<string, string> = {}) {
  const runner = await import('../scripts/sandbox/remote-test.mjs');
  const calls: SshCall[] = [];
  const messages: string[] = [];
  const printed: string[] = [];
  const code: number = runner.runRemoteTest({
    cwd: root,
    args,
    env,
    log: (message: string) => messages.push(message),
    print: (text: string) => printed.push(text),
    ssh: (sshArgs: string[], script: string, capture?: boolean, timeoutSeconds?: number) => {
      calls.push({ args: sshArgs, script, capture, timeoutSeconds });
      return results[Math.min(calls.length - 1, results.length - 1)];
    },
  });
  return { code, calls, messages: messages.join('\n'), printed: printed.join(''), runner };
}

function answerOf(file: string): Record<string, unknown> {
  return JSON.parse(read(file)) as Record<string, unknown>;
}

describe('B332: the answer names the tested commit and a status that follows the server run', () => {
  it('A1: exit 0 answers passed for the commit at HEAD', async () => {
    const root = project();
    const c = contract(root);
    const r = await remote(root, ['npm', 'run', 'typecheck'], [{ status: 0, signal: null, stdout: 'ok\n' }], c.env);
    expect(r.code).toBe(0);
    expect(answerOf(c.answer)).toEqual({ commit: head(root), status: 'passed' });
  });

  it.each([[1, 'failed'], [124, 'failed'], [5, 'failed'], [75, 'busy'], [255, 'unavailable']])(
    'A2: exit %i answers %s and the exit code passes through',
    async (status, expected) => {
      const root = project();
      const c = contract(root);
      const r = await remote(root, [], [{ status, signal: null, stdout: '' }], c.env);
      expect(r.code).toBe(status);
      expect(answerOf(c.answer)).toEqual({ commit: head(root), status: expected });
    },
  );

  it('A3: ssh that could not start answers unavailable, never passed', async () => {
    const root = project();
    const c = contract(root);
    const failure = { status: null, signal: null, error: new Error('spawn ssh ENOENT') };
    const r = await remote(root, [], [failure], c.env);
    expect(r.code).not.toBe(0);
    expect(answerOf(c.answer)).toEqual({ commit: head(root), status: 'unavailable' });
  });

  it('A4: the answer is the only file left beside it: written whole, through no file that stays behind', async () => {
    const root = project();
    const c = contract(root, { SDLC_VERIFY_LOG: '' });
    await remote(root, [], [{ status: 0, signal: null, stdout: '' }], c.env);
    expect(fs.readdirSync(c.dir)).toEqual(['answer.json']);
  });

  it('A5: SDLC_VERIFY_COMMIT equal to HEAD runs; the answer is the same commit', async () => {
    const root = project();
    const c = contract(root);
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: '' }], c.env);
    expect(r.calls).toHaveLength(1);
    expect(answerOf(c.answer).commit).toBe(c.env.SDLC_VERIFY_COMMIT);
  });
});

describe('B332: a refused run or an unknown result writes no answer', () => {
  it('R1: negative: a disk that is not the commit is refused with no answer and no ssh', async () => {
    const root = project();
    const c = contract(root);
    write(path.join(root, 'a.txt'), 'changed\n');
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: '' }], c.env);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(fs.existsSync(c.answer)).toBe(false);
  });

  it('R2: negative: an unsafe argument and a missing test.sh are refused with no answer', async () => {
    const root = project();
    const c = contract(root);
    expect((await remote(root, ['a;b'], [{ status: 0, signal: null }], c.env)).code).toBe(2);
    expect(fs.existsSync(c.answer)).toBe(false);
    git(root, ['rm', '-q', 'scripts/sandbox/test.sh']);
    git(root, ['commit', '-q', '-m', 'no tools']);
    const again = contract(root);
    expect((await remote(root, [], [{ status: 0, signal: null }], again.env)).code).toBe(2);
    expect(fs.existsSync(again.answer)).toBe(false);
  });

  it('R3: negative: SDLC_VERIFY_COMMIT naming another commit is refused before ssh, with no answer', async () => {
    const root = project();
    const c = contract(root, { SDLC_VERIFY_COMMIT: 'f'.repeat(40) });
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: '' }], c.env);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
    expect(fs.existsSync(c.answer)).toBe(false);
    expect(r.messages).toMatch(/commit/i);
  });

  it('R4: negative: the server refusing the commit (exit 3) writes no answer', async () => {
    const root = project();
    const c = contract(root);
    const r = await remote(root, [], [{ status: 3, signal: null, stdout: '' }], c.env);
    expect(r.code).toBe(3);
    expect(fs.existsSync(c.answer)).toBe(false);
  });

  it('R5: negative: ssh ended by a signal is an unknown result: no answer, never a pass', async () => {
    const root = project();
    const c = contract(root);
    const r = await remote(root, [], [{ status: null, signal: 'SIGTERM', stdout: '' }], c.env);
    expect(r.code).not.toBe(0);
    expect(fs.existsSync(c.answer)).toBe(false);
  });

  it('R5b: negative: ssh killed for too much output (a signal with an error) is unknown too: no answer', async () => {
    const root = project();
    const c = contract(root);
    const overflow = { status: null, signal: 'SIGTERM', stdout: '', error: new Error('spawnSync ssh ENOBUFS') };
    const r = await remote(root, [], [overflow], c.env);
    expect(r.code).not.toBe(0);
    expect(fs.existsSync(c.answer)).toBe(false);
  });

  it('R5c: a server refusal or stop other than 3 (exit 2, exit 143) answers failed, never passed', async () => {
    for (const status of [2, 143]) {
      const root = project();
      const c = contract(root);
      await remote(root, [], [{ status, signal: null, stdout: '' }], c.env);
      expect(answerOf(c.answer).status, String(status)).toBe('failed');
    }
  });

  it('R5d: negative: an answer path that cannot be cleared (a folder there) refuses the run before ssh', async () => {
    const root = project();
    const c = contract(root);
    fs.mkdirSync(path.join(c.answer, 'inside'), { recursive: true });
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: '' }], c.env);
    expect(r.code).toBe(2);
    expect(r.calls).toEqual([]);
  });

  it('R6: negative: a stale answer at the path is gone after a refused run', async () => {
    const root = project();
    const c = contract(root);
    write(c.answer, JSON.stringify({ commit: head(root), status: 'passed' }));
    write(path.join(root, 'a.txt'), 'changed\n');
    await remote(root, [], [{ status: 0, signal: null, stdout: '' }], c.env);
    expect(fs.existsSync(c.answer)).toBe(false);
  });

  it('R7: negative: a stale answer is gone after a server refusal too', async () => {
    const root = project();
    const c = contract(root);
    write(c.answer, JSON.stringify({ commit: head(root), status: 'passed' }));
    await remote(root, [], [{ status: 3, signal: null, stdout: '' }], c.env);
    expect(fs.existsSync(c.answer)).toBe(false);
  });
});

describe('B332: the full server log is copied from the run folder the server named', () => {
  it('L1: the last line names the run folder; a second ssh reads its run.log into SDLC_VERIFY_LOG', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    const r = await remote(root, [], [
      { status: 0, signal: null, stdout: `tail of the log\n${lastLine(folder)}` },
      { status: 0, signal: null, stdout: 'the whole run log\n' },
    ], c.env);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(2);
    expect(r.calls[1].args.slice(-6)).toEqual(['tester@server.example', 'tail', '-c', KEPT_BYTES, '--',
      `${folder}/run.log`]);
    expect(read(c.log)).toBe('the whole run log\n');
  });

  it('L1b: the copy has a time limit of its own, and the first call captures only because the log is asked', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    const r = await remote(root, [], [
      { status: 0, signal: null, stdout: lastLine(folder) },
      { status: 0, signal: null, stdout: 'log\n' },
    ], c.env);
    expect(r.calls[0].capture).toBe(true);
    expect(r.calls[0].timeoutSeconds).toBeUndefined();
    expect(r.calls[1].capture).toBe(true);
    expect(r.calls[1].timeoutSeconds).toBe(r.runner.LOG_COPY_SECONDS);
    expect(r.runner.LOG_COPY_SECONDS).toBeGreaterThan(0);
  });

  it('L1c: control bytes the container wrote are removed from the kept log; tabs and line ends stay', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    await remote(root, [], [
      { status: 0, signal: null, stdout: lastLine(folder) },
      { status: 0, signal: null, stdout: 'a\u001b]0;title\u0007b\tc\r\nd\u0000e\u007f\n' },
    ], c.env);
    expect(read(c.log)).toBe('a]0;titleb\tc\nde\n');
  });

  it('L1d: negative: a finished line whose exit is not the exit of the run names no folder', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    const r = await remote(root, [], [{ status: 1, signal: null, stdout: lastLine(folder, 0) }], c.env);
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(1);
    expect(fs.existsSync(c.log)).toBe(false);
  });

  it('L1e: a temporary file left by an earlier run beside the log is removed, and none is left', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    write(path.join(c.dir, '.check.log.123.tmp'), 'left over');
    await remote(root, [], [
      { status: 0, signal: null, stdout: lastLine(folder) },
      { status: 0, signal: null, stdout: 'log\n' },
    ], c.env);
    expect(fs.readdirSync(c.dir).sort()).toEqual(['answer.json', 'check.log']);
  });

  it('L2: the output of the server is still shown when it is captured for the log', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    const r = await remote(root, [], [
      { status: 0, signal: null, stdout: `shard summary\n${lastLine(folder)}` },
      { status: 0, signal: null, stdout: 'log\n' },
    ], c.env);
    expect(r.printed).toContain('shard summary');
    expect(r.printed).toContain('sandbox finished');
  });

  it('L3: the last such line wins: a line the container printed earlier cannot choose the folder', async () => {
    const root = project();
    const c = contract(root);
    const real = runFolder(head(root));
    const forged = `sandbox_runs/sdlc/sdlc-sandbox-${head(root).slice(0, 8)}-20200101_000000`;
    const r = await remote(root, [], [
      { status: 0, signal: null, stdout: `${lastLine(forged)}more output\n${lastLine(real)}` },
      { status: 0, signal: null, stdout: 'log\n' },
    ], c.env);
    expect(r.calls[1].args.at(-1)).toBe(`${real}/run.log`);
  });

  it.each([
    ['no last line', 'just output\n'],
    ['a parent folder', lastLine('sandbox_runs/sdlc/../../.ssh')],
    ['an absolute folder', lastLine('/home/tester/sandbox_runs/sdlc/sdlc-sandbox-00000000-20261124_073108')],
    ['another project', lastLine('sandbox_runs/marin/sdlc-sandbox-00000000-20261124_073108')],
    ['a shell character', lastLine('sandbox_runs/sdlc/sdlc-sandbox-$(id)-20261124_073108')],
    ['a space', lastLine('sandbox_runs/sdlc/sdlc-sandbox-0000 0000-20261124_073108')],
  ])('L4: negative: %s writes no log and runs no second ssh', async (_name, stdout) => {
    const root = project();
    const c = contract(root);
    const r = await remote(root, [], [{ status: 0, signal: null, stdout }], c.env);
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(fs.existsSync(c.log)).toBe(false);
    expect(answerOf(c.answer).status).toBe('passed');
  });

  it('L5: negative: the run folder of another commit writes no log', async () => {
    const root = project();
    const c = contract(root);
    const other = runFolder('0123456789abcdef0123456789abcdef01234567');
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: lastLine(other) }], c.env);
    expect(r.calls).toHaveLength(1);
    expect(fs.existsSync(c.log)).toBe(false);
  });

  it('L6: a log that could not be read writes no log and does not change the answer', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    const r = await remote(root, [], [
      { status: 1, signal: null, stdout: lastLine(folder, 1) },
      { status: 1, signal: null, stdout: '' },
    ], c.env);
    expect(r.calls).toHaveLength(2);
    expect(r.code).toBe(1);
    expect(fs.existsSync(c.log)).toBe(false);
    expect(answerOf(c.answer).status).toBe('failed');
  });

  it('L7: negative: a copy that ran out of time writes no log and leaves the answer and the exit as they were', async () => {
    const root = project();
    const c = contract(root);
    const folder = runFolder(head(root));
    const timedOut = { status: null, signal: 'SIGTERM', stdout: 'part', error: new Error('spawnSync ssh ETIMEDOUT') };
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: lastLine(folder) }, timedOut], c.env);
    expect(r.code).toBe(0);
    expect(fs.existsSync(c.log)).toBe(false);
    expect(answerOf(c.answer).status).toBe('passed');
  });
});

describe('B332: the real judge of sdlc reads what the script writes', () => {
  /** The check as sdlc runs it: the real preflight, the three variables and the real judge around the script. */
  async function judged(root: string, results: SshResult[]) {
    const { runRemoteCheck } = await import('../src/core/verify-remote.js');
    const { worktreeFingerprint } = await import('../src/core/git.js');
    const { FINGERPRINT_EXCLUDES } = await import('../src/core/lifecycle.js');
    const changeDir = path.join(root, 'openspec/changes/x');
    fs.mkdirSync(changeDir, { recursive: true });
    const run = { root, changeDir, runId: 'r1', commit: head(root),
      fingerprint: worktreeFingerprint(root, FINGERPRINT_EXCLUDES) };
    const check = { name: 'suite', run: 'node scripts/sandbox/remote-test.mjs', timeoutSeconds: 60, required: true,
      remote: true, env: {} };
    return runRemoteCheck(run as never, check as never, async (env: Record<string, string>) => {
      const r = await remote(root, [], results, env);
      return { name: 'suite', command: check.run, exit_code: r.code, duration_ms: 1, required: true,
        output: r.printed } as never;
    });
  }

  it('J1: a passing run with its log passes the check and keeps the log with the evidence', async () => {
    const root = project();
    const folder = runFolder(head(root));
    const outcome = await judged(root, [
      { status: 0, signal: null, stdout: lastLine(folder) },
      { status: 0, signal: null, stdout: 'the whole run log\n' },
    ]) as { exit_code: number; reason?: string; answer_failed?: boolean; log?: string };
    expect(outcome.exit_code).toBe(0);
    expect(outcome.reason).toBeUndefined();
    expect(outcome.answer_failed).toBeUndefined();
    expect(outcome.log).toBe('verification/remote/suite.log');
    expect(read(path.join(root, 'openspec/changes/x', outcome.log!))).toBe('the whole run log\n');
  });

  it('J2: negative: a busy server reads as remote_unavailable, not as a code defect', async () => {
    const root = project();
    const outcome = await judged(root, [{ status: 75, signal: null, stdout: '' }]) as { reason?: string };
    expect(outcome.reason).toBe('remote_unavailable');
  });

  it('J3: negative: a server refusal reads as remote_no_answer', async () => {
    const root = project();
    const outcome = await judged(root, [{ status: 3, signal: null, stdout: '' }]) as { reason?: string };
    expect(outcome.reason).toBe('remote_no_answer');
  });
});

describe('B332: without the variables nothing changes', () => {
  it('N1: one ssh call, no file written anywhere it could, and the exit code of the server', async () => {
    const root = project();
    const before = spawnSync('git', ['status', '--porcelain', '--ignored'], { cwd: root, encoding: 'utf-8' }).stdout;
    const r = await remote(root, ['npm', 'test'], [{ status: 1, signal: null, stdout: lastLine(runFolder(head(root))) }]);
    expect(r.code).toBe(1);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].capture).toBeFalsy();
    expect(r.printed).toBe('');
    const after = spawnSync('git', ['status', '--porcelain', '--ignored'], { cwd: root, encoding: 'utf-8' }).stdout;
    expect(after).toBe(before);
  });

  it('N1b: the real ssh pipes the output only when it captures, and streams it as before otherwise', () => {
    const text = read(path.join(REPO_ROOT, 'scripts/sandbox/remote-test.mjs'));
    expect(text).toMatch(/capture \? 'pipe' : 'inherit'/);
  });

  it('N2: an empty variable counts as unset', async () => {
    const root = project();
    const r = await remote(root, [], [{ status: 0, signal: null, stdout: '' }],
      { SDLC_VERIFY_ANSWER: '', SDLC_VERIFY_LOG: '', SDLC_VERIFY_COMMIT: '' });
    expect(r.code).toBe(0);
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].capture).toBeFalsy();
  });
});
