// The server's Linux containers never run the Windows side of a test, so `sdlc verify` runs those files on this host.
// test/sandbox-remote-test.test.ts fails when a test file mentions a platform and is on none of the lists below.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const REFUSED = 2;

export const WINDOWS_ONLY_FILES = [
  'test/audit-verify-process-tree.test.ts',
  'test/candidate-path-short.test.ts',
  'test/local-ignore-project.test.ts',
  'test/e2e-0236-mixed-tools.test.ts',
  'test/verify-startup.test.ts',
  'test/workflow-decision-hints.test.ts',
  'test/writer-contention.test.ts',
];

/** Run on every platform, with a Windows side (junctions, icacls, .cmd lookup) Linux never takes. */
export const WINDOWS_BRANCH_FILES = [
  'test/answer-file.test.ts',
  'test/approval-real-git.test.ts',
  'test/audit-digest-integrity.test.ts',
  'test/audit-gate-read.test.ts',
  'test/audit-harness-runtime.test.ts',
  'test/b146-review-fixes.test.ts',
  'test/checkpoint-linked-root.test.ts',
  'test/claude-hook-failure.test.ts',
  'test/dependency-probe.test.ts',
  'test/digest-inputs.test.ts',
  'test/harness-credential-preflight.test.ts',
  'test/init-deps.test.ts',
  'test/plugin-directory.test.ts',
  'test/plugin-recovery-instance.test.ts',
  'test/plugin-storage-guards.test.ts',
  'test/release.test.ts',
  'test/shared-views-errors.test.ts',
  'test/state-copy-boundaries.test.ts',
  'test/stop-check-errors.test.ts',
  'test/suite-partition.test.ts',
  'test/verify-process-tree.test.ts',
  'test/writer-ownership.test.ts',
];

/** Mention a platform and need no run here: they simulate it, skip on Windows, or only name it. */
export const NOT_RUN_HERE_FILES = [
  'test/check-startup.test.ts',
  'test/plugin-directory-durability.test.ts',
  'test/policy-posix-paths.test.ts',
  'test/process-tree-windows.test.ts',
  'test/sandbox-remote-test.test.ts',
  'test/sandbox-server-script.test.ts',
  'test/state-copy-typed.test.ts',
  'test/verify-cleanup-note.test.ts',
];

export function runWindowsOnly({ platform, run, log }) {
  if (platform !== 'win32') {
    log(`Refused: on ${platform} every Windows-only case skips, and the check would pass with nothing tested.`);
    return REFUSED;
  }
  const compiled = run(['npm', 'run', 'compile']);
  if (compiled !== 0) return compiled;
  return run(['node', 'node_modules/vitest/vitest.mjs', 'run', ...WINDOWS_ONLY_FILES, ...WINDOWS_BRANCH_FILES]);
}

/** The commands are the fixed ones above; npm is a .cmd on Windows, which needs a shell. */
function realRun(args) {
  return spawnSync(args.join(' '), { shell: true, stdio: 'inherit' }).status ?? 1;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runWindowsOnly({
    platform: process.platform,
    run: realRun,
    log: (message) => console.error(message),
  });
}
