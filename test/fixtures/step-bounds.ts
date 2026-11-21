import * as fs from 'node:fs';

/**
 * B253: the time bounds of the CLI and tool steps in the harness tests, in one place, and a record of how long each
 * step took. With SDLC_TEST_REPORT set (scripts/test-shards.mjs sets it), every timed step is written to
 * `<report>.step-phases.<file>.json`, so the medians the bounds rest on can be measured again on any host.
 */

/**
 * Medians and slowest tests measured on 2026-11-19 with SDLC_TEST_REPORT set, 2 workers: the server sandbox (Linux,
 * commit 8f118a63) and this Windows host (quiet, and once under load from other executors). Rule (design.md of
 * time-limits-keep-a-margin): a step bound is at least four times the largest median, rounded up to 5 s; a test
 * timeout is at least twice the slowest test of its file, rounded up to 30 s; neither is ever lowered.
 */
export const MEASURED = {
  sdlcStep: { label: 'sdlc approve', serverMs: 2071, windowsQuietMs: 11093, windowsLoadedMs: 11789, previousMs: 20_000 },
  toolStep: { label: 'git clone', serverMs: 33, windowsQuietMs: 209, windowsLoadedMs: 226, previousMs: 15_000 },
  runCli: { label: 'sdlc doctor', serverMs: 3084, windowsQuietMs: 5497, windowsLoadedMs: 5680, previousMs: 120_000 },
  slowestTestMs: {
    'audit-harness-runtime': { windowsQuietMs: 112_667, previousMs: 120_000 },
    'plugin-harness-report': { windowsQuietMs: 104_100, previousMs: 120_000 },
    'harness-bundle': { windowsQuietMs: 81_415, previousMs: 180_000 },
    'harness-bundle-paths': { windowsQuietMs: 55_507, previousMs: 120_000 },
  },
} as const;

/** An `sdlc` command spawned directly by plugin-harness-report.test.ts. */
export const SDLC_STEP_MS = 50_000;
/** A tool (git, node) run inside a local harness sandbox. */
export const TOOL_STEP_MS = 15_000;
/** `runCli` in test/helpers.ts. */
export const RUN_CLI_MS = 120_000;

/** Timeouts of the harness tests themselves, by file. */
export const TEST_MS = {
  'audit-harness-runtime': 240_000,
  'plugin-harness-report': 240_000,
  'harness-bundle': 180_000,
  'harness-bundle-paths': 120_000,
} as const;

export interface StepPhase {
  label: string;
  elapsedMs: number;
  boundMs: number;
  status: number | null;
}

const phases = new Map<string, StepPhase[]>();

function save(file: string, list: StepPhase[]): void {
  const report = process.env.SDLC_TEST_REPORT;
  if (!report) return;
  fs.writeFileSync(`${report}.step-phases.${file}.json`, `${JSON.stringify(list, null, 2)}\n`);
}

/** Runs one step, records how long it took against its bound, and returns its result unchanged. */
export function timedStep<T>(file: string, label: string, boundMs: number, step: () => T,
  status: (result: T) => number | null): T {
  const started = performance.now();
  const result = step();
  const list = phases.get(file) ?? [];
  list.push({ label, elapsedMs: Math.round(performance.now() - started), boundMs, status: status(result) });
  phases.set(file, list);
  save(file, list);
  return result;
}
