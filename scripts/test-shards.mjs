import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { BaseSequencer } from 'vitest/node';

const SCRIPT = fileURLToPath(import.meta.url);
const VITEST = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
// Default limits; `--limit <seconds>` replaces them. They sit under scripts/sandbox/test.sh (test/time-limits.test.ts).
export const SHARD_LIMIT_SECONDS = 30 * 60;
export const FULL_LIMIT_SECONDS = 45 * 60;
const MAX_LIMIT_SECONDS = 7200;
const TIMED_OUT = 124;
const SKIP_ALLOWLIST = 'test/skip-allowlist.json';

// Mirrors the configured recursive .test.ts include; actual Vitest inventory is checked too.
export function discoverTestFiles(root, folder = 'test') {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${folder}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Linked test inventory entry: ${relative}`);
    if (entry.isDirectory()) return discoverTestFiles(root, relative);
    return entry.isFile() && relative.endsWith('.test.ts') ? [relative] : [];
  }).sort();
}

export function partitionFiles(files, count) {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('Shard count must be 1..64.');
  if (new Set(files).size !== files.length) throw new Error('Duplicate test inventory entry.');
  const groups = Array.from({ length: count }, () => []);
  [...files].sort().forEach((file, index) => groups[index % count].push(file));
  return groups;
}

export function assertInventory(expected, actual) {
  if (!Array.isArray(actual) || new Set(actual).size !== actual.length) throw new Error('Duplicate/invalid inventory.');
  const left = [...expected].sort();
  const right = [...actual].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error('Executed test inventory differs from discovery.');
  }
}

/**
 * Files whose tests may all skip in one shard (B266), each with the reason. A missing file allows none; a malformed
 * one throws, so the shard fails instead of passing.
 */
export function readSkipAllowlist(root) {
  const file = path.join(root, SKIP_ALLOWLIST);
  if (!fs.existsSync(file)) return new Set();
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'))?.files;
  } catch (error) {
    throw new Error(`${SKIP_ALLOWLIST}: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error(`${SKIP_ALLOWLIST}: "files" must be a list.`);
  const valid = entries.every((entry) => typeof entry?.file === 'string'
    && typeof entry?.reason === 'string' && entry.reason.trim() !== '');
  if (!valid) throw new Error(`${SKIP_ALLOWLIST}: every entry needs a "file" and a "reason".`);
  return new Set(entries.map((entry) => entry.file));
}

const UNSTABLE_LIST = 'test/unstable.json';

/**
 * Known unstable test files (B282): the tracked mirror of `verify.unstable`, each with the item that fixes it. The
 * shards leave them out and `--unstable` runs exactly them. A missing file allows none; a malformed entry throws.
 */
export function readUnstable(root) {
  const file = path.join(root, UNSTABLE_LIST);
  if (!fs.existsSync(file)) return [];
  let entries;
  try {
    entries = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${UNSTABLE_LIST}: ${error.message}`);
  }
  if (!Array.isArray(entries)) throw new Error(`${UNSTABLE_LIST}: the list must be an array.`);
  for (const entry of entries) {
    const valid = typeof entry?.file === 'string' && /^B\d+$/.test(entry?.item ?? '')
      && /^\d{4}-\d{2}-\d{2}$/.test(entry?.since ?? '');
    if (!valid) throw new Error(`${UNSTABLE_LIST}: every entry needs "file", "item" (B<n>) and "since".`);
  }
  return entries.map((entry) => entry.file);
}

/** The files a run selects from: the listed unstable files for `--unstable`, every other file otherwise. */
function runSet(root, files, unstable) {
  const listed = readUnstable(root);
  const missing = listed.filter((file) => !files.includes(file));
  if (missing.length > 0) throw new Error(`${UNSTABLE_LIST} lists a test file that does not exist: ${missing.join(', ')}`);
  return unstable ? listed : files.filter((file) => !listed.includes(file));
}

/**
 * A green shard means tests ran: no executed test fails it unless every file of the shard may skip. The allowlist is
 * read for every shard, so a malformed one never passes unnoticed. Vitest counts it.todo in numTotalTests but not in
 * numPendingTests, so only passed and failed tests count as run.
 */
function assertTestsRan(shard, report) {
  const allowed = readSkipAllowlist(shard.root);
  if (report.numPassedTests + report.numFailedTests > 0) return;
  if (report.numTotalTests > 0 && shard.files.every((file) => allowed.has(file))) return;
  const skipped = report.numPendingTests + (report.numTodoTests ?? 0);
  throw new Error(`Shard ${shard.index}/${shard.count} ran no test (${skipped} skipped or todo).`);
}

/** The unstable stage is a required check: every listed file must run a test, whatever the skip allowlist says. */
function assertEachFileRan(shard, report) {
  if (!shard.unstable) return;
  const idle = report.testResults.filter((result) => !(result.assertionResults ?? [])
    .some((test) => test.status === 'passed' || test.status === 'failed'));
  if (idle.length === 0) return;
  const files = idle.map((result) => relativeFile(shard.root, result.name)).join(', ');
  throw new Error(`An unstable test file ran no test: ${files}`);
}

function emptyShard(index, count) {
  return { index, plannedFiles: [], files: [], complete: false, durationMs: 0, exitCode: 1,
    error: `Shard ${index}/${count} selected no test file.` };
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function relativeFile(root, file) {
  return path.relative(root, file).replace(/\\/g, '/');
}

/** The runner and Vitest use the same exact partition, rather than substring CLI file filters. */
export default class ExactShardSequencer extends BaseSequencer {
  async shard(specifications) {
    const { root, shard } = this.ctx.config;
    const every = specifications.map((specification) => relativeFile(root, specification.moduleId)).sort();
    const unstable = process.env.SDLC_TEST_SELECTION === 'unstable';
    const all = unstable ? every : runSet(root, every, false);
    const selected = unstable ? runSet(root, every, true) : partitionFiles(all, shard.count)[shard.index - 1];
    if (process.env.SDLC_TEST_INVENTORY) writeJson(process.env.SDLC_TEST_INVENTORY, { all, selected });
    const chosen = new Set(selected);
    return specifications.filter((specification) => chosen.has(relativeFile(root, specification.moduleId)));
  }
}

function outputDirectory(root) {
  const parent = path.join(root, '.sdlc-tmp', 'test-results');
  fs.mkdirSync(parent, { recursive: true });
  return fs.mkdtempSync(path.join(parent, 'run-'));
}

function reportFiles(root, report) {
  return report.testResults.map((result) => relativeFile(root, result.name));
}

function executeShard(shard) {
  const args = [VITEST, 'run', '--root', shard.root, '--maxWorkers', String(shard.workers)];
  if (!shard.full) args.push('--shard', `${shard.index}/${shard.count}`);
  if (shard.configFile) args.push('--config', shard.configFile);
  args.push('--reporter=default', '--reporter=json', `--outputFile.json=${shard.reportFile}`);
  const child = spawnSync(process.execPath, args, {
    cwd: shard.root,
    env: { ...process.env, SDLC_TEST_REPORT: shard.reportFile, SDLC_TEST_INVENTORY: shard.inventoryFile,
      SDLC_TEST_SHARD: shard.full ? '' : '1', SDLC_TEST_SELECTION: shard.unstable ? 'unstable' : 'stable' },
    timeout: shard.limitSeconds * 1000,
    killSignal: 'SIGKILL',
    stdio: 'inherit',
  });
  if (child.error?.code === 'ETIMEDOUT') {
    const error = `stopped by test-shards at its own limit of ${shard.limitSeconds} s (--limit)`;
    return { exitCode: TIMED_OUT, error, timedOut: true };
  }
  return { exitCode: child.status ?? 1, ...(child.error ? { error: child.error.message } : {}) };
}

/** The limit a run uses: `--limit`, else the default for a full run or a shard. */
export function limitSeconds(value, full) {
  if (value === undefined) return full ? FULL_LIMIT_SECONDS : SHARD_LIMIT_SECONDS;
  const seconds = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_LIMIT_SECONDS) {
    throw new Error(`--limit must be a whole number of seconds from 1 to ${MAX_LIMIT_SECONDS}`);
  }
  return seconds;
}

function inspectResult(shard, expected, executed) {
  const result = { ...executed, files: [], complete: false };
  // A run stopped at the limit wrote no full report; its own reason stays.
  if (executed.timedOut) return result;
  try {
    const report = JSON.parse(fs.readFileSync(shard.reportFile, 'utf8'));
    for (const key of ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']) {
      if (!Number.isInteger(report[key]) || report[key] < 0) throw new Error(`Incomplete test report: ${key}`);
    }
    result.files = reportFiles(shard.root, report);
    Object.assign(result, { tests: report.numTotalTests, passed: report.numPassedTests,
      failed: report.numFailedTests, skipped: report.numPendingTests });
    assertInventory(shard.files, result.files);
    if (!shard.full) {
      const inventory = JSON.parse(fs.readFileSync(shard.inventoryFile, 'utf8'));
      assertInventory(expected, inventory.all);
      assertInventory(shard.files, inventory.selected);
    }
    assertTestsRan(shard, report);
    assertEachFileRan(shard, report);
    if (report.success === false && result.exitCode === 0) result.exitCode = 1;
    result.complete = true;
  } catch (error) {
    Object.assign(result, failedResult(error));
  }
  return result;
}

function failedResult(error) {
  return { exitCode: 1, error: error instanceof Error ? error.message : String(error) };
}

async function runOne(shard, expected, execute) {
  const started = performance.now();
  let result;
  try {
    const executed = await (execute ?? executeShard)(shard);
    if (!Number.isInteger(executed.exitCode) || executed.exitCode < 0) throw new Error('Invalid subprocess exit.');
    result = inspectResult(shard, expected, executed);
  } catch (error) {
    result = { files: [], complete: false, ...failedResult(error) };
  }
  return { index: shard.index, plannedFiles: shard.files, durationMs: performance.now() - started,
    reportFile: shard.reportFile, ...result };
}

export async function runShards(options) {
  const root = path.resolve(options.root);
  const discovered = discoverTestFiles(root);
  if (!discovered.length) throw new Error('No repository test files discovered.');
  // A full run takes every file; shards take the stable ones; --unstable takes the listed ones (B282).
  const files = options.full ? discovered : runSet(root, discovered, options.unstable);
  const groups = options.full ? [files] : options.unstable ? [files] : partitionFiles(files, options.count);
  if (options.index !== undefined && (!Number.isInteger(options.index)
    || options.index < 1 || options.index > groups.length)) throw new Error('Shard index outside configured count.');
  const output = options.output ?? outputDirectory(root);
  const configFile = options.configFile ?? path.join(root, 'vitest.config.ts');
  const shards = [];
  const started = performance.now();
  for (const [offset, selected] of groups.entries()) {
    if (options.index !== undefined && options.index !== offset + 1) continue;
    const index = offset + 1;
    if (!selected.length) {
      shards.push(emptyShard(index, groups.length));
      continue;
    }
    const shard = { root, index, count: groups.length, full: options.full, files: selected,
      workers: options.workers ?? 2, configFile, unstable: !!options.unstable,
      limitSeconds: options.limitSeconds ?? limitSeconds(undefined, options.full),
      reportFile: path.join(output, `shard-${index}.json`),
      inventoryFile: path.join(output, `inventory-${index}.json`) };
    // Vitest lists every file under --unstable and only the stable ones in the shards.
    shards.push(await runOne(shard, options.unstable ? discovered : files, options.execute));
  }
  const exitCode = shards.find((shard) => shard.exitCode !== 0)?.exitCode ?? 0;
  const executedFiles = shards.flatMap((shard) => shard.files).sort();
  const complete = shards.every((shard) => shard.complete) && executedFiles.length === files.length
    && files.every((file, index) => file === executedFiles[index]);
  const result = { exitCode, files: executedFiles, discoveredFiles: files, complete,
    shards, durationMs: performance.now() - started };
  writeJson(path.join(output, 'summary.json'), result);
  return { ...result, output };
}

async function main() {
  const { values } = parseArgs({ options: {
    shards: { type: 'string', default: '4' }, workers: { type: 'string', default: '2' },
    list: { type: 'boolean' }, full: { type: 'boolean' },
    shard: { type: 'string' }, unstable: { type: 'boolean' }, limit: { type: 'string' },
  } });
  const limit = limitSeconds(values.limit, values.full);
  const root = process.cwd();
  if (values.unstable && values.full) throw new Error('Use --unstable or --full, not both.');
  if (values.unstable && readUnstable(root).length === 0) {
    console.log(`test-shards: no unstable tests are listed in ${UNSTABLE_LIST}`);
    return;
  }
  const selection = selectedShard(values.shard, values.shards);
  const count = selection.count;
  const workers = Number(values.workers);
  if (!Number.isInteger(workers) || workers < 1 || workers > 64) throw new Error('Workers must be 1..64.');
  if (values.list) {
    console.log(JSON.stringify(partitionFiles(runSet(root, discoverTestFiles(root), false), count), null, 2));
    return;
  }
  console.log(`test-shards: limit ${limit} s per run`);
  const result = await runShards({ root, ...selection, workers, full: values.full, unstable: values.unstable,
    limitSeconds: limit });
  for (const shard of result.shards) {
    if (shard.error) console.error(`Shard ${shard.index}: ${shard.error}`);
  }
  console.log(`Test results: ${result.output}; ${Math.round(result.durationMs)} ms; exit ${result.exitCode}`);
  process.exitCode = result.exitCode;
}

function selectedShard(value, fallback) {
  if (value === undefined) return { count: Number(fallback) };
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(value)) throw new Error('Use --shard index/count.');
  const [index, count] = value.split('/').map(Number);
  return { index, count };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
