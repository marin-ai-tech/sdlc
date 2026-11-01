import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { BaseSequencer } from 'vitest/node';

const SCRIPT = fileURLToPath(import.meta.url);
const VITEST = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
const SHARD_LIMIT_MS = 30 * 60 * 1000;
const FULL_LIMIT_MS = 45 * 60 * 1000;

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
    const all = specifications.map((specification) => relativeFile(root, specification.moduleId)).sort();
    const selected = partitionFiles(all, shard.count)[shard.index - 1];
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
      SDLC_TEST_SHARD: shard.full ? '' : '1' },
    timeout: shard.full ? FULL_LIMIT_MS : SHARD_LIMIT_MS,
    killSignal: 'SIGKILL',
    stdio: 'inherit',
  });
  return { exitCode: child.status ?? 1, ...(child.error ? { error: child.error.message } : {}) };
}

function inspectResult(shard, expected, executed) {
  const result = { ...executed, files: [], complete: false };
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
  const files = discoverTestFiles(root);
  if (!files.length) throw new Error('No repository test files discovered.');
  const groups = options.full ? [files] : partitionFiles(files, options.count);
  if (options.index !== undefined && (!Number.isInteger(options.index)
    || options.index < 1 || options.index > groups.length)) throw new Error('Shard index outside configured count.');
  const output = options.output ?? outputDirectory(root);
  const configFile = options.configFile ?? path.join(root, 'vitest.config.ts');
  const shards = [];
  const started = performance.now();
  for (const [offset, selected] of groups.entries()) {
    if (options.index !== undefined && options.index !== offset + 1) continue;
    if (!selected.length) continue;
    const index = offset + 1;
    const shard = { root, index, count: groups.length, full: options.full, files: selected,
      workers: options.workers ?? 2, configFile,
      reportFile: path.join(output, `shard-${index}.json`),
      inventoryFile: path.join(output, `inventory-${index}.json`) };
    shards.push(await runOne(shard, files, options.execute));
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
    shard: { type: 'string' },
  } });
  const root = process.cwd();
  const selection = selectedShard(values.shard, values.shards);
  const count = selection.count;
  const workers = Number(values.workers);
  if (!Number.isInteger(workers) || workers < 1 || workers > 64) throw new Error('Workers must be 1..64.');
  if (values.list) {
    console.log(JSON.stringify(partitionFiles(discoverTestFiles(root), count), null, 2));
    return;
  }
  const result = await runShards({ root, ...selection, workers, full: values.full });
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
