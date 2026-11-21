import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REPO_ROOT, tempDir, write } from './helpers.js';
import * as bounds from './fixtures/step-bounds.js';

/**
 * B253 (E25): time limits keep a margin and cannot disagree silently. scripts/test-shards.mjs takes its limit as
 * `--limit <seconds>`, prints it, and names its own stop; the limits of the shard runner, the server wrapper
 * (scripts/sandbox/test.sh) and this repository's verify settings form one chain.
 */

const SCRIPT = path.join(REPO_ROOT, 'scripts/test-shards.mjs');

function testSh(name: string): number {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'scripts/sandbox/test.sh'), 'utf8');
  const match = new RegExp(`^${name}=(\\d+)$`, 'm').exec(text);
  if (!match) throw new Error(`${name} not found in scripts/sandbox/test.sh`);
  return Number(match[1]);
}

/** A project with one test that waits `ms`, readable by vitest without packages (globals, plain config). */
function waitingProject(ms: number): string {
  const root = tempDir('sdlc-limits-');
  write(path.join(root, 'vitest.config.ts'), 'export default { test: { globals: true } };\n');
  write(path.join(root, 'test/wait.test.ts'),
    `it('waits', async () => { await new Promise((r) => setTimeout(r, ${ms})); }, ${ms + 60000});\n`);
  return root;
}

function shards(root: string, args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: root, encoding: 'utf8', timeout: 240000,
    killSignal: 'SIGKILL' });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
}

describe('B253: test-shards takes, prints and names its limit', () => {
  it.each([['0'], ['abc'], ['7201']])('L1: --limit %s is refused', (value) => {
    const r = shards(waitingProject(0), ['--full', '--limit', value]);
    expect(r.code).not.toBe(0);
    expect(r.text).toMatch(/--limit must be a whole number of seconds from 1 to 7200/);
    expect(r.text).not.toMatch(/Test results:/);
  }, 60000);

  it('L2: a run stopped at the limit says test-shards stopped it at its own limit, with exit 124', async () => {
    const r = shards(waitingProject(60000), ['--full', '--limit', '5']);
    expect(r.text).toMatch(/limit 5 s/);
    expect(r.text).toMatch(/stopped by test-shards at its own limit of 5 s/);
    expect(r.code).toBe(124);
  }, 240000);

  it('negative L3: a run within the limit passes and prints the limit it used', () => {
    const r = shards(waitingProject(10), ['--full', '--limit', '120']);
    expect(r.code, r.text).toBe(0);
    expect(r.text).toMatch(/limit 120 s/);
    expect(r.text).not.toMatch(/stopped by test-shards/);
  }, 240000);
});

describe('B253: the harness bounds keep their margin over the measured durations', () => {
  const roundUp = (ms: number, step: number) => Math.ceil(ms / step) * step;

  it('L6: each step bound is at least four times the largest median, and never lower than before', () => {
    const pairs = [
      [bounds.MEASURED.sdlcStep, bounds.SDLC_STEP_MS],
      [bounds.MEASURED.toolStep, bounds.TOOL_STEP_MS],
      [bounds.MEASURED.runCli, bounds.RUN_CLI_MS],
    ] as const;
    for (const [measured, bound] of pairs) {
      const largest = Math.max(measured.serverMs, measured.windowsQuietMs, measured.windowsLoadedMs);
      expect(bound, measured.label).toBeGreaterThanOrEqual(roundUp(4 * largest, 5000));
      expect(bound, measured.label).toBeGreaterThanOrEqual(measured.previousMs);
    }
  });

  it('L7: each test timeout is at least twice the slowest test of its file, and never lower than before', () => {
    for (const [file, measured] of Object.entries(bounds.MEASURED.slowestTestMs)) {
      const timeout = bounds.TEST_MS[file as keyof typeof bounds.TEST_MS];
      expect(timeout, file).toBeGreaterThanOrEqual(roundUp(2 * measured.windowsQuietMs, 30000));
      expect(timeout, file).toBeGreaterThanOrEqual(measured.previousMs);
    }
  });
});

describe('B253: the limits form one chain', () => {
  it('L4: one shard stops at its own limit before the server wrapper stops a command or the suite', async () => {
    const limits = await import(SCRIPT) as { SHARD_LIMIT_SECONDS: number; FULL_LIMIT_SECONDS: number };
    expect(limits.SHARD_LIMIT_SECONDS).toBeLessThan(testSh('COMMAND_LIMIT_SECONDS'));
    expect(testSh('COMMAND_LIMIT_SECONDS')).toBeLessThan(testSh('TOTAL_LIMIT_SECONDS'));
    expect(limits.SHARD_LIMIT_SECONDS).toBeLessThan(testSh('SUITE_LIMIT_SECONDS'));
    // The suite on the server runs shards, never --full, so the full-run limit applies only to local runs.
    const runSh = fs.readFileSync(path.join(REPO_ROOT, 'scripts/sandbox/run.sh'), 'utf8');
    expect(runSh).toMatch(/test-shards\.mjs --shard/);
    expect(runSh).not.toMatch(/test-shards\.mjs[^\n]*--full/);
  });

  // openspec/ is local to this repository's main checkout: elsewhere the case is reported as skipped, not passed.
  const localConfig = path.join(REPO_ROOT, 'openspec/sdlc.yaml');
  it.skipIf(!fs.existsSync(localConfig))('L5: every local verify command running test-shards has a timeout above '
    + 'the limit that applies to it', async () => {
    const file = localConfig;
    const limits = await import(SCRIPT) as { SHARD_LIMIT_SECONDS: number; FULL_LIMIT_SECONDS: number };
    const verify = parse(fs.readFileSync(file, 'utf8')).verify as {
      commands: Array<string | { run: string; timeout_seconds?: number }>; timeout_seconds?: number };
    const total = testSh('TOTAL_LIMIT_SECONDS');
    for (const entry of verify.commands) {
      const run = typeof entry === 'string' ? entry : entry.run;
      if (!run.includes('test-shards.mjs')) continue;
      const timeout = (typeof entry === 'string' ? undefined : entry.timeout_seconds) ?? verify.timeout_seconds ?? 900;
      const fallback = run.includes('--full') ? limits.FULL_LIMIT_SECONDS : limits.SHARD_LIMIT_SECONDS;
      const own = Number(/--limit (\d+)/.exec(run)?.[1] ?? fallback);
      const applies = run.includes('remote-test.mjs') ? total : own;
      expect(timeout, run).toBeGreaterThan(applies);
    }
  });
});
