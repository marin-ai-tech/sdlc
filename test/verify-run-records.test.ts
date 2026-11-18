import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { BIN, REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change verify-runs-are-recorded (B182, epic E17). Every `sdlc verify` run leaves a `verify.started` and a
 * `verify.passed|failed` entry in the project log with a `run` object (id, times, duration, fingerprint, commit,
 * trigger, per-check durations), never command text; the start entry stays out of the change history and the event
 * outbox; a run on branch change/<id> belongs to <id>; the ci-green check keeps the provider's duration; `sdlc audit`
 * summarises runs and minutes per source (`metrics.verifyLog`). Oracles: the log file itself, the E20 run ledger
 * (test/fixtures/e20-verify-runs.json) and the change's own history.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const SLOW = 180000;
const SECRET = 'SECRET-TOKEN-4711';

type Command = { name: string; run: string; required: boolean };
type Entry = Record<string, any>;

const unit: Command = { name: 'unit', run: `node ok.cjs ${SECRET} /private/secret-path`, required: true };
const lint: Command = { name: 'lint', run: 'node ok.cjs', required: true };
const failingLint: Command = { name: 'lint', run: 'node fail.cjs', required: true };

function project(commands: Command[], options: { receivers?: boolean; changes?: string[] } = {}) {
  const root = tempDir('sdlc-b182-');
  const sink = path.join(tempDir('sdlc-b182-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: sink });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  const ok = (args: string[]) => {
    const r = cli(args);
    expect(r.code, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
    return r;
  };
  ok(['init', '--tools', 'none', '--json']);
  for (const change of options.changes ?? ['demo']) ok(['new', change, '--json']);
  write(path.join(root, 'ok.cjs'), `console.log(process.argv.slice(2).join(' '));\nprocess.exit(0);\n`);
  write(path.join(root, 'fail.cjs'), 'process.exit(1);\n');
  write(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  const configFile = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(configFile));
  config.verify.commands = commands;
  if (options.receivers) {
    config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
    config.events = [{ server: 'chat', tool: 'report_event', on: ['verify.*'] }];
  }
  write(configFile, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'project']);
  const logFile = path.join(root, 'openspec/.sdlc/log.jsonl');
  const log = (change: string): Entry[] => (fs.existsSync(logFile) ? read(logFile) : '').split('\n')
    .filter(Boolean).map((line) => JSON.parse(line)).filter((e) => e.change === change);
  const append = (entry: Entry) => fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  const finished = (change: string) => log(change).filter((e) => /^verify\.(passed|failed)$/.test(e.event));
  const audit = (change: string) => {
    const r = ok(['audit', '--change', change, '--json']);
    return r.json().metrics;
  };
  const received = (): Entry[] => (fs.existsSync(sink)
    ? read(sink).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { root, env, cli, ok, log, append, finished, audit, received };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('B182.R every run leaves a start and a finish record', () => {
  it('R1 a passing run: one start and one finish with the same id, times, source and per-check durations', () => {
    const p = project([unit, lint]);
    p.ok(['verify', '--change', 'demo', '--json']);
    const started = p.log('demo').filter((e) => e.event === 'verify.started');
    const done = p.finished('demo');
    expect(started).toHaveLength(1);
    expect(done.map((e) => e.event)).toEqual(['verify.passed']);
    const run = done[0].run;
    expect(run.id).toMatch(/^[0-9a-f]{12}$/);
    expect(started[0].run.id).toBe(run.id);
    expect(run.fingerprint).toMatch(/^git-tree:[0-9a-f]+$/);
    expect(run.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Date.parse(run.finished_at)).toBeGreaterThanOrEqual(Date.parse(run.started_at));
    expect(run.duration_ms).toBeGreaterThanOrEqual(0);
    expect(run.trigger).toBe('first');
    expect(run.partial).toBe(false);
    expect(run.checks.map((c: Entry) => [c.name, c.exit_code])).toEqual([['unit', 0], ['lint', 0]]);
    for (const check of run.checks) expect(typeof check.duration_ms).toBe('number');
  }, SLOW);

  it('R2 a failing run is recorded the same way, with the failing exit code', () => {
    const p = project([unit, failingLint]);
    const r = p.cli(['verify', '--change', 'demo', '--json']);
    expect(r.code).toBe(1);
    const done = p.finished('demo');
    expect(done.map((e) => e.event)).toEqual(['verify.failed']);
    expect(done[0].run.checks.map((c: Entry) => [c.name, c.exit_code])).toEqual([['unit', 0], ['lint', 1]]);
  }, SLOW);

  it('R3 a run killed after it started stays visible as unfinished', async () => {
    const p = project([{ name: 'slow', run: 'node wait.cjs', required: true }]);
    const control = tempDir('sdlc-b182-control-');
    const marker = path.join(control, 'started');
    const release = path.join(control, 'release');
    write(path.join(p.root, 'wait.cjs'), [
      'const fs = require("node:fs");',
      `fs.writeFileSync(${JSON.stringify(marker)}, "x");`,
      'const end = Date.now() + 30000;',
      `const t = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)}) || Date.now() > end) {`,
      '  clearInterval(t); process.exit(0); } }, 100);', ''].join('\n'));
    const child = spawn(process.execPath, [BIN, 'verify', '--change', 'demo', '--json'],
      { cwd: p.root, env: p.env, stdio: 'ignore' });
    try {
      for (let i = 0; i < 300 && !fs.existsSync(marker); i++) await sleep(100);
      expect(fs.existsSync(marker), 'the check never started').toBe(true);
      const started = p.log('demo').filter((e) => e.event === 'verify.started');
      expect(started, 'the start entry is written before the first check').toHaveLength(1);
      expect(started[0].run.fingerprint).toMatch(/^git-tree:/);
    } finally {
      child.kill('SIGKILL');
      write(release, 'x');
      await new Promise((resolve) => (child.exitCode !== null ? resolve(null) : child.once('exit', resolve)));
    }
    expect(p.finished('demo')).toHaveLength(0);
    const summary = p.audit('demo').verifyLog;
    expect(summary).toMatchObject({ finished: 0, unfinished: 1 });
  }, SLOW);

  it('R4 negative: no command text and no output in either entry', () => {
    const p = project([unit]);
    p.ok(['verify', '--change', 'demo', '--json']);
    const text = JSON.stringify(p.log('demo'));
    expect(text).toContain('verify.started');
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('secret-path');
    expect(text).not.toContain('ok.cjs');
  }, SLOW);
});

describe('B182.S the start record stays in the project log', () => {
  it('S1 a receiver on verify.* gets one event per run and no verify.started', async () => {
    const p = project([lint], { receivers: true });
    p.ok(['verify', '--change', 'demo', '--json']);
    expect(p.log('demo').some((e) => e.event === 'verify.started')).toBe(true);
    for (let i = 0; i < 50 && p.received().length === 0; i++) await sleep(100);
    const events = p.received().map((call) => call.event?.event).filter(Boolean);
    expect(events).toEqual(['verify.passed']);
  }, SLOW);

  it('S2 the change history keeps one entry per run and audit counts two runs', () => {
    const p = project([lint]);
    p.ok(['verify', '--change', 'demo', '--json']);
    p.ok(['verify', '--change', 'demo', '--json']);
    const state = parse(read(path.join(p.root, 'openspec/changes/demo/.sdlc.yaml')));
    const history = state.history.filter((h: Entry) => h.event.startsWith('verify.'));
    expect(history.map((h: Entry) => h.event)).toEqual(['verify.passed', 'verify.passed']);
    expect(p.audit('demo').verifyRuns).toBe(2);
  }, SLOW);
});

describe('B182.T a run states why it ran', () => {
  it('T1 the same source twice: the second run is a repeat', () => {
    const p = project([lint]);
    p.ok(['verify', '--change', 'demo', '--json']);
    p.ok(['verify', '--change', 'demo', '--json']);
    expect(p.finished('demo').map((e) => e.run.trigger)).toEqual(['first', 'repeat']);
  }, SLOW);

  it.each([
    ['review.round', 'after_review'],
    ['gate.plan.rework', 'after_rework'],
    [undefined, 'changed'],
  ])('T2 an entry %s between two runs on different sources gives %s', (event, trigger) => {
    const p = project([lint]);
    p.ok(['verify', '--change', 'demo', '--json']);
    if (event) {
      p.append({ ts: new Date().toISOString(), event, change: 'demo', sdlc: '0.33.0', license: 'community' });
    }
    write(path.join(p.root, 'src/a.js'), 'export const a = 2;\n');
    p.ok(['verify', '--change', 'demo', '--json']);
    expect(p.finished('demo').map((e) => e.run.trigger)).toEqual(['first', trigger]);
  }, SLOW);

  it('T3 negative: runs of another change do not make a first run a repeat', () => {
    const p = project([lint], { changes: ['demo', 'other'] });
    p.ok(['verify', '--change', 'other', '--json']);
    p.ok(['verify', '--change', 'demo', '--json']);
    expect(p.finished('demo').map((e) => e.run.trigger)).toEqual(['first']);
  }, SLOW);
});

describe('B182.W a run in a change worktree belongs to that change', () => {
  it('W1 branch change/other picks other without --change, while demo is active too', () => {
    const p = project([lint], { changes: ['demo', 'other'] });
    git(p.root, ['checkout', '-q', '-b', 'change/other']);
    const r = p.ok(['verify', '--json']);
    expect(r.json().change).toBe('other');
    expect(p.finished('other')).toHaveLength(1);
    expect(p.finished('demo')).toHaveLength(0);
  }, SLOW);

  it('W2 negative: a branch that names no change keeps change_required', () => {
    const p = project([lint], { changes: ['demo', 'other'] });
    git(p.root, ['checkout', '-q', '-b', 'feature/x']);
    const r = p.cli(['verify', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('change_required');
    expect(p.finished('demo').length + p.finished('other').length).toBe(0);
  }, SLOW);

  it('W3 an explicit --change wins over the branch', () => {
    const p = project([lint], { changes: ['demo', 'other'] });
    git(p.root, ['checkout', '-q', '-b', 'change/other']);
    p.ok(['verify', '--change', 'demo', '--json']);
    expect(p.finished('demo')).toHaveLength(1);
    expect(p.finished('other')).toHaveLength(0);
  }, SLOW);
});

describe('B182.C the CI check keeps the provider duration', () => {
  const github = (runs: Entry[]) => ({ workflow_runs: runs });
  it.each([
    ['one completed run', 'list_workflow_runs', github([{ status: 'completed', conclusion: 'success',
      run_started_at: '2026-11-16T10:00:00Z', updated_at: '2026-11-16T10:12:30Z' }]), 750000],
    ['two parallel workflows: earliest start to latest update', 'list_workflow_runs', github([
      { status: 'completed', conclusion: 'success', run_started_at: '2026-11-16T10:00:00Z',
        updated_at: '2026-11-16T10:12:30Z' },
      { status: 'completed', conclusion: 'success', run_started_at: '2026-11-16T10:01:00Z',
        updated_at: '2026-11-16T10:15:00Z' }]), 900000],
    ['a GitLab pipeline', 'list_pipelines', [{ status: 'success', duration: 125 }], 125000],
  ])('C1 %s', async (_name, tool, result, expected) => {
    const { providerDurationMs } = await import('../src/mcp/ci-duration.js');
    expect(providerDurationMs(tool, result)).toBe(expected);
  });

  it.each([
    ['a GitLab list without duration', 'list_pipelines', [{ status: 'success' }]],
    ['a GitHub run still in progress', 'list_workflow_runs', { workflow_runs: [{ status: 'in_progress',
      run_started_at: '2026-11-16T10:00:00Z', updated_at: '2026-11-16T10:12:30Z' }] }],
    ['another tool', 'get_issue', { workflow_runs: [] }],
    ['no answer', 'list_workflow_runs', null],
  ])('C2 negative: %s gives no duration', async (_name, tool, result) => {
    const { providerDurationMs } = await import('../src/mcp/ci-duration.js');
    expect(providerDurationMs(tool, result)).toBeUndefined();
  });
});

describe('B182.M runs and minutes per change and per source', () => {
  type Ledger = { runs: Array<{ run: number; status: string; startedAt: string; durationMs?: number; source: string }> };
  const ledger = JSON.parse(read(path.join(REPO_ROOT, 'test/fixtures/e20-verify-runs.json'))) as Ledger;

  it('M1 the E20 ledger replays as 18 runs: 7 passed, 4 failed, 7 unfinished, two green triples', () => {
    const p = project([lint]);
    let n = 0;
    for (const r of ledger.runs) {
      const id = (n++).toString(16).padStart(12, '0');
      const fingerprint = `git-tree:${r.source}`;
      const base = { change: 'demo', sdlc: '0.33.0', license: 'community' };
      p.append({ ...base, ts: r.startedAt, event: 'verify.started', run: { id, started_at: r.startedAt, fingerprint } });
      if (r.status === 'unfinished') continue;
      const finishedAt = new Date(Date.parse(r.startedAt) + r.durationMs!).toISOString();
      p.append({ ...base, ts: finishedAt, event: `verify.${r.status}`, run: { id, started_at: r.startedAt,
        finished_at: finishedAt, duration_ms: r.durationMs, fingerprint, trigger: 'changed', partial: false,
        checks: [] } });
    }
    const summary = p.audit('demo').verifyLog;
    expect(summary).toMatchObject({ finished: 11, passed: 7, failed: 4, unfinished: 7, partial: 0 });
    const minutes = ledger.runs.reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / 60000;
    expect(summary.minutes).toBeCloseTo(minutes, 0);
    const triple = (run: number) => `git-tree:${ledger.runs.find((r) => r.run === run)!.source}`;
    const streaks = summary.bySource.filter((s: Entry) => s.longestPassedStreak >= 3);
    expect(streaks.map((s: Entry) => s.fingerprint).sort()).toEqual([triple(8), triple(20)].sort());
    expect(summary.bySource.every((s: Entry) => s.longestPassedStreak <= 3)).toBe(true);
  }, SLOW);

  it('M2 entries of 0.32.1 without a run object count as finished with unknown source and minutes', () => {
    const p = project([lint]);
    p.append({ ts: '2026-11-15T10:00:00.000Z', event: 'verify.passed', change: 'demo', by: 'Pat <pat@example.com>',
      detail: 'lint=0', sdlc: '0.32.1', license: 'community' });
    const summary = p.audit('demo').verifyLog;
    expect(summary).toMatchObject({ finished: 1, passed: 1, unfinished: 0, minutes: 0 });
    expect(summary.bySource.map((s: Entry) => s.fingerprint)).toEqual(['unknown']);
  }, SLOW);

  it('M3 a partial (--only) run is counted apart, never as a full run', () => {
    const p = project([unit, lint]);
    // A partial run never passes (src/core/verify.ts), so the command exits 1; the record is what matters here.
    p.cli(['verify', '--change', 'demo', '--only', 'lint', '--json']);
    expect(p.finished('demo').map((e) => e.run.partial)).toEqual([true]);
    expect(p.audit('demo').verifyLog).toMatchObject({ finished: 0, partial: 1 });
  }, SLOW);
});

describe('B182.M the report shows runs per change', () => {
  // Lead finding at acceptance (2026-11-16): the requirement names `sdlc audit` and `sdlc report`, but the summary
  // reached only the audit JSON; the report's change page had no runs at all.
  const section = (html: string, id: string) => {
    const start = html.indexOf(`<section id="change-${id}"`);
    expect(start, `no page for ${id}`).toBeGreaterThanOrEqual(0);
    return html.slice(start, html.indexOf('</section>', start));
  };

  it('M4 the change page carries the run summary of its own change only', () => {
    const p = project([lint], { changes: ['demo', 'other'] });
    p.ok(['verify', '--change', 'demo', '--json']);
    p.ok(['verify', '--change', 'demo', '--json']);
    const fingerprint = p.finished('demo')[0].run.fingerprint;
    const report = p.ok(['report', '--format', 'json']).json();
    const row = (id: string) => report.changes.find((change: Entry) => change.id === id);
    expect(row('demo').verifyRuns).toMatchObject({ finished: 2, passed: 2, failed: 0, unfinished: 0, partial: 0 });
    expect(row('demo').verifyRuns.bySource).toEqual([
      expect.objectContaining({ fingerprint, runs: 2, passed: 2, longestPassedStreak: 2 })]);
    expect(row('other').verifyRuns).toMatchObject({ finished: 0, unfinished: 0, partial: 0, bySource: [] });
    const html = p.ok(['report', '--format', 'html']).stdout;
    expect(section(html, 'demo')).toContain('Verify runs');
    expect(section(html, 'demo')).toContain(fingerprint);
    expect(section(html, 'other')).toContain('Verify runs');
    expect(section(html, 'other')).not.toContain(fingerprint);
  }, SLOW);
});

describe('B182 review round 1', () => {
  // Independent review (e17-r1, 2026-11-16) F4: --only naming every configured check runs everything and can pass,
  // so it is a full run; the log called it partial and audit left it out of the finished runs.
  it('R1-F4 --only naming every check is a full run', () => {
    const p = project([unit, lint]);
    p.ok(['verify', '--change', 'demo', '--only', 'unit,lint', '--json']);
    expect(p.finished('demo').map((e) => [e.event, e.run.partial])).toEqual([['verify.passed', false]]);
    expect(p.audit('demo').verifyLog).toMatchObject({ finished: 1, passed: 1, partial: 0 });
  }, SLOW);

  // F3: the same finish entry twice (a cherry-picked or re-applied log line) is one run, not two.
  it('R1-F3 a duplicated finish entry counts once', async () => {
    const { summarizeVerifyRuns } = await import('../src/core/verify-runs.js');
    const run = { id: 'abcdefabcdef', started_at: '2026-11-16T10:00:00.000Z', finished_at: '2026-11-16T10:30:00.000Z',
      duration_ms: 1800000, fingerprint: 'git-tree:aa', trigger: 'first' as const, partial: false, checks: [] };
    const base = { change: 'demo', sdlc: '0.33.0', license: 'community' };
    const start = { ...base, ts: run.started_at, event: 'verify.started', run: { id: run.id, started_at: run.started_at } };
    const finish = { ...base, ts: run.finished_at, event: 'verify.passed', run };
    const summary = summarizeVerifyRuns([start, finish, finish]);
    expect(summary).toMatchObject({ finished: 1, passed: 1, minutes: 30 });
    expect(summary.bySource).toEqual([expect.objectContaining({ runs: 1, longestPassedStreak: 1 })]);
  });
});
