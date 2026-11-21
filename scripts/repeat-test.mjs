// Runs one test file the given number of times in a row and stops at the first failure.
// Use: node scripts/repeat-test.mjs <count> <test file> [workers]. Exit 0 only when every run passed.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VITEST = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const [countText, file, workersText = '2'] = process.argv.slice(2);
const count = Number(countText);
const workers = Number(workersText);
if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('Count must be 1..500.');
if (!file || !/^test\/[\w./-]+\.test\.ts$/.test(file)) throw new Error('Give one test file under test/.');
if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw new Error('Workers must be 1..8.');

for (let run = 1; run <= count; run += 1) {
  const started = Date.now();
  const child = spawnSync(process.execPath, [VITEST, 'run', file, '--maxWorkers', String(workers)], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 600_000, killSignal: 'SIGKILL',
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (child.status !== 0) {
    process.stdout.write(`${child.stdout ?? ''}${child.stderr ?? ''}`.split('\n').slice(-60).join('\n'));
    console.log(`repeat-test: run ${run} of ${count} failed (exit ${child.status ?? child.signal}, ${seconds} s)`);
    process.exit(1);
  }
  console.log(`repeat-test: run ${run} of ${count} passed (${seconds} s)`);
}
console.log(`repeat-test: ${count} of ${count} runs passed`);
