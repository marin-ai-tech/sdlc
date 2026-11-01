import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

function resources(): Record<string, number> {
  const disk = fs.statfsSync(os.tmpdir());
  return { cpus: os.availableParallelism(), freeMemoryBytes: os.freemem(), freeDiskBytes: disk.bavail * disk.bsize };
}

function reportResources(started: number, before: Record<string, number>): void {
  const file = process.env.SDLC_TEST_REPORT;
  if (!file) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.resources.json`, JSON.stringify({ durationMs: performance.now() - started,
    platform: process.platform, node: process.version, before, after: resources() }, null, 2));
}

/**
 * One temporary root per test run (0.15.1). Every `tempDir()` of the tests is created inside it, and it is removed
 * when the run ends — before, each run left hundreds of `sdlc-*` folders in the system's temp directory, and a day
 * of runs filled the disk. Test workers inherit SDLC_TEST_TMP from this process.
 */
export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-run-'));
  const started = performance.now();
  const before = resources();
  process.env.SDLC_TEST_TMP = root;
  return () => {
    const parent = path.resolve(os.tmpdir());
    if (path.dirname(root) !== parent || !path.basename(root).startsWith('sdlc-run-')) {
      throw new Error('Refusing to remove an unowned test temporary root.');
    }
    try {
      reportResources(started, before);
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    }
  };
}
