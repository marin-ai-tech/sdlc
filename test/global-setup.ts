import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/**
 * One temporary root per test run (0.15.1). Every `tempDir()` of the tests is created inside it, and it is removed
 * when the run ends — before, each run left hundreds of `sdlc-*` folders in the system's temp directory, and a day
 * of runs filled the disk. Test workers inherit SDLC_TEST_TMP from this process.
 */
export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-run-'));
  process.env.SDLC_TEST_TMP = root;
  return () => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  };
}
