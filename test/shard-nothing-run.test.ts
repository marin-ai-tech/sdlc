import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, tempDir, write } from './helpers.js';

/**
 * B266 (E25, change empty-shard-fails): scripts/test-shards.mjs skipped a shard that selected no file and passed a
 * shard whose tests all skipped, so a green shard did not mean that tests ran. Now a shard with no file or no
 * executed test fails and names the reason; a shard whose tests all skip passes only when every one of its files is
 * on test/skip-allowlist.json; a shard with some skips still passes.
 */

interface FixtureShard { root: string; index: number; count: number; files: string[]; reportFile: string;
  inventoryFile: string }
interface Counts { total: number; passed: number; pending: number; todo?: number }
interface ShardResult { index: number; exitCode: number; error?: string }

function listed(root: string): string[] {
  return fs.readdirSync(path.join(root, 'test')).filter((name) => name.endsWith('.test.ts'))
    .map((name) => `test/${name}`).sort();
}

function report(shard: FixtureShard, counts: Counts) {
  write(shard.reportFile, JSON.stringify({ success: true, numTotalTests: counts.total,
    numPassedTests: counts.passed, numFailedTests: 0, numPendingTests: counts.pending, numTodoTests: counts.todo ?? 0,
    testResults: shard.files.map((file) => ({ name: path.join(shard.root, file) })) }));
  write(shard.inventoryFile, JSON.stringify({ all: listed(shard.root), selected: shard.files }));
  return { exitCode: 0 };
}

function fixture(names: string[], allowlist?: unknown): string {
  const root = tempDir('sdlc-shard-empty-');
  for (const name of names) write(path.join(root, 'test', `${name}.test.ts`), 'fixture');
  if (allowlist !== undefined) write(path.join(root, 'test', 'skip-allowlist.json'), JSON.stringify(allowlist));
  return root;
}

async function runner() {
  return import('../scripts/test-shards.mjs');
}

describe('B266: a shard with nothing run is not a pass', () => {
  it('E1 a requested shard that selects no file fails and names the shard', async () => {
    const root = fixture(['a', 'b']);
    const result = await (await runner()).runShards({ root, count: 4, index: 3,
      execute: (shard: FixtureShard) => report(shard, { total: 1, passed: 1, pending: 0 }) });
    expect(result.exitCode).not.toBe(0);
    const shard = result.shards.find((item: ShardResult) => item.index === 3);
    expect(shard?.error).toMatch(/3\/4/);
    expect(shard?.error).toMatch(/selected no test file/);
  });

  it('E2 a run of every shard fails when one group is empty', async () => {
    const root = fixture(['a', 'b']);
    const visited: number[] = [];
    const result = await (await runner()).runShards({ root, count: 3, execute: (shard: FixtureShard) => {
      visited.push(shard.index);
      return report(shard, { total: 1, passed: 1, pending: 0 });
    } });
    expect(visited).toEqual([1, 2]);
    expect(result.exitCode).not.toBe(0);
    expect(result.shards.map((item: ShardResult) => item.index)).toEqual([1, 2, 3]);
  });

  it('E3 a shard whose tests all skip fails', async () => {
    const root = fixture(['a', 'b']);
    const result = await (await runner()).runShards({ root, count: 1, index: 1,
      execute: (shard: FixtureShard) => report(shard, { total: 4, passed: 0, pending: 4 }) });
    expect(result.exitCode).not.toBe(0);
    expect(result.shards[0].error).toMatch(/ran no test/);
    expect(result.shards[0].error).toMatch(/4 skipped/);
  });

  it('E4 a shard that reports no test at all fails', async () => {
    const root = fixture(['a']);
    const result = await (await runner()).runShards({ root, count: 1, index: 1,
      execute: (shard: FixtureShard) => report(shard, { total: 0, passed: 0, pending: 0 }) });
    expect(result.exitCode).not.toBe(0);
    expect(result.shards[0].error).toMatch(/ran no test/);
  });

  it('E5 negative: a shard with some skips still passes', async () => {
    const root = fixture(['a', 'b']);
    const result = await (await runner()).runShards({ root, count: 1, index: 1,
      execute: (shard: FixtureShard) => report(shard, { total: 3, passed: 2, pending: 1 }) });
    expect(result.exitCode).toBe(0);
    expect(result.shards[0].error).toBeUndefined();
  });

  it('E6 an all-skipped shard passes only when every file is on the allowlist', async () => {
    const skipAll = (shard: FixtureShard) => report(shard, { total: 2, passed: 0, pending: 2 });
    const all = fixture(['a', 'b'], { files: [{ file: 'test/a.test.ts', reason: 'x' },
      { file: 'test/b.test.ts', reason: 'y' }] });
    expect((await (await runner()).runShards({ root: all, count: 1, index: 1, execute: skipAll })).exitCode).toBe(0);
    const one = fixture(['a', 'b'], { files: [{ file: 'test/a.test.ts', reason: 'x' }] });
    expect((await (await runner()).runShards({ root: one, count: 1, index: 1, execute: skipAll })).exitCode)
      .not.toBe(0);
  });

  it('E7 an allowlist that is not a list of files with reasons fails the shard instead of allowing it', async () => {
    const skipAll = (shard: FixtureShard) => report(shard, { total: 2, passed: 0, pending: 2 });
    for (const bad of [{ files: 'test/a.test.ts' }, { files: [{ file: 'test/a.test.ts' }] }, ['test/a.test.ts']]) {
      const root = fixture(['a'], bad);
      const result = await (await runner()).runShards({ root, count: 1, index: 1, execute: skipAll });
      expect(result.exitCode, JSON.stringify(bad)).not.toBe(0);
    }
  });

  // Review round 1: Vitest counts it.todo in numTotalTests but not in numPendingTests (probed on 4.1.11).
  it('E10 a shard whose only tests are todo fails', async () => {
    const root = fixture(['a']);
    const result = await (await runner()).runShards({ root, count: 1, index: 1,
      execute: (shard: FixtureShard) => report(shard, { total: 1, passed: 0, pending: 0, todo: 1 }) });
    expect(result.exitCode).not.toBe(0);
    expect(result.shards[0].error).toMatch(/ran no test/);
  });

  it('E11 a malformed allowlist fails a shard whose tests ran as well', async () => {
    const root = fixture(['a'], { files: 'test/a.test.ts' });
    const result = await (await runner()).runShards({ root, count: 1, index: 1,
      execute: (shard: FixtureShard) => report(shard, { total: 1, passed: 1, pending: 0 }) });
    expect(result.exitCode).not.toBe(0);
    expect(result.shards[0].error).toMatch(/skip-allowlist\.json/);
  });

  it('E8 the command line prints the reason of an empty shard and exits non-zero', () => {
    const root = fixture(['a', 'b']);
    const child = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/test-shards.mjs'), '--shard', '3/4'], {
      cwd: root, encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL',
    });
    expect(child.status).not.toBe(0);
    expect(`${child.stdout}${child.stderr}`).toMatch(/3\/4.*selected no test file/);
  });

  it('E9 the repository allowlist exists, is valid, and names only real test files', () => {
    const file = path.join(REPO_ROOT, 'test', 'skip-allowlist.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as { files: Array<{ file: string; reason: string }> };
    expect(Array.isArray(parsed.files)).toBe(true);
    for (const entry of parsed.files) {
      expect(fs.existsSync(path.join(REPO_ROOT, entry.file)), entry.file).toBe(true);
      expect(entry.reason.trim().length, entry.file).toBeGreaterThan(0);
    }
  });
});
