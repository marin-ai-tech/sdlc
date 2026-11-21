import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import type { LogEntry } from '../src/core/log.js';
import { summarizeVerifyRuns } from '../src/core/verify-runs.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B183 (E25): a reused record names its source in the evidence and in the log, and is not counted as a run.
 */

const AGENT = { CLAUDECODE: '1' };
const A = 'first-change';
const B = 'second-change';

function reusedProject() {
  const root = tempDir('sdlc-reuse-count-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const ok = path.join(tempDir('sdlc-reuse-count-scripts-'), 'ok.cjs');
  write(ok, 'process.exit(0);\n');
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  for (const id of [A, B]) {
    expect(runCli(['new', id, '--json'], root, env).code).toBe(0);
    write(path.join(root, `openspec/changes/${id}/tasks.md`), '# Tasks\n\n- [x] 1.1 done\n');
  }
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  const run = `node "${ok.replace(/\\/g, '/')}"`;
  config.verify.commands = [{ name: 'typecheck', run, required: true }, { name: 'test', run, required: true }];
  config.verify.reuse = true;
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const verify = (id: string) => runCli(['verify', '--change', id, '--json'], root, { ...env, ...AGENT });
  const first = verify(A);
  expect(first.code, first.stdout + first.stderr).toBe(0);
  const second = verify(B);
  expect(second.code, second.stdout + second.stderr).toBe(0);
  const sourceRun = parse(read(path.join(root, `openspec/changes/${A}/.sdlc.yaml`))).verify.id as string;
  const log = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').filter(Boolean)
    .map((text) => JSON.parse(text) as LogEntry);
  return { root, sourceRun, log };
}

describe('B183: a reused record is shown as reused', () => {
  it('C1: every result row of B names the source change and run', () => {
    const p = reusedProject();
    const evidence = read(path.join(p.root, `openspec/changes/${B}/verification.md`));
    for (const name of ['typecheck', 'test']) {
      const row = evidence.split('\n').find((line) => line.startsWith(`| ${name} `)) ?? '';
      expect(row, name).toContain(A);
      expect(row, name).toContain(p.sourceRun);
    }
  }, 240000);

  it('C2: the log has one verify.passed for B with trigger reuse and the source', () => {
    const p = reusedProject();
    const finishes = p.log.filter((entry) => entry.change === B && /^verify\.(passed|failed)$/.test(entry.event));
    expect(finishes).toHaveLength(1);
    expect(finishes[0].event).toBe('verify.passed');
    const run = finishes[0].run as Record<string, unknown>;
    expect(run.trigger).toBe('reuse');
    expect(run.reused_from).toEqual({ change: A, run_id: p.sourceRun });
    expect(p.log.some((entry) => entry.change === B && entry.event === 'verify.started')).toBe(false);
  }, 240000);

  it('negative C3: the run summary of B counts no run and no minutes for the reused entry', () => {
    const p = reusedProject();
    const summary = summarizeVerifyRuns(p.log.filter((entry) => entry.change === B));
    expect(summary.finished).toBe(0);
    expect(summary.passed).toBe(0);
    expect(summary.minutes).toBe(0);
    expect(summary.bySource.reduce((sum, source) => sum + source.runs, 0)).toBe(0);
    const whole = summarizeVerifyRuns(p.log);
    expect(whole.passed).toBe(1);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/log.jsonl'))).toBe(true);
  }, 240000);

  it('C4: the first real run after a reuse is not a repeat of it (review F8)', () => {
    const p = reusedProject();
    const env = humanEnv(tempDir('sdlc-home-'));
    const r = runCli(['verify', '--change', B, '--no-reuse', '--json'], p.root, { ...env, ...AGENT });
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const log = read(path.join(p.root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
    const finishes = log.filter((e: LogEntry) => e.change === B && e.event === 'verify.passed');
    expect(finishes).toHaveLength(2);
    expect(finishes[1].run.trigger).toBe('first');
  }, 240000);

  it('C5: the guide documents verify.reuse and --no-reuse (review F12)', () => {
    const guide = read(path.join(REPO_ROOT, 'docs/en/05-guide.md'));
    expect(guide).toMatch(/reuse: (false|true)/);
    expect(guide).toContain('--no-reuse');
  });
});
