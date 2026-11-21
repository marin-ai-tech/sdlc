import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REPO_ROOT, tempDir, write } from './helpers.js';

/**
 * B282 (E25), this repository's runner: test/unstable.json (the tracked mirror of verify.unstable, owner 2026-11-19)
 * lists unstable test files; scripts/test-shards.mjs leaves them out of the shards and runs exactly them with
 * `--unstable`; a listed file that is missing or a malformed entry fails; the server run has a stage for them.
 */

const SCRIPT = path.join(REPO_ROOT, 'scripts/test-shards.mjs');

function fixture(unstable?: unknown) {
  const root = tempDir('sdlc-unstable-runner-');
  for (const name of ['a', 'b', 'c', 'd']) {
    write(path.join(root, 'test', `${name}.test.ts`), `it('${name}', () => expect(1).toBe(1));`);
  }
  if (unstable !== undefined) write(path.join(root, 'test/unstable.json'), JSON.stringify(unstable));
  const configFile = path.join(root, 'vitest.config.mjs');
  const sequencer = pathToFileURL(SCRIPT).href;
  write(configFile, `import Seq from ${JSON.stringify(sequencer)};
export default { test: { globals: true, sequence: { sequencer: Seq } } };`);
  return { root, configFile };
}

const entry = (file: string) => ({ file, item: 'B251', since: '2026-11-19' });
const ran = (result: { shards: Array<{ files: string[] }> }) => result.shards.flatMap((shard) => shard.files).sort();

describe('B282: the shards leave the unstable files out and --unstable runs them', () => {
  it('R1: the shards run every file except the listed one, and the run counts as complete', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const f = fixture([entry('test/c.test.ts')]);
    const result = await runner.runShards({ root: f.root, count: 2, workers: 1, configFile: f.configFile });
    expect(result.exitCode).toBe(0);
    expect(ran(result)).toEqual(['test/a.test.ts', 'test/b.test.ts', 'test/d.test.ts']);
    expect(result.complete).toBe(true);
  }, 60000);

  it('R2: --unstable runs exactly the listed files', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const f = fixture([entry('test/c.test.ts')]);
    const result = await runner.runShards({ root: f.root, workers: 1, configFile: f.configFile, unstable: true });
    expect(result.exitCode).toBe(0);
    expect(ran(result)).toEqual(['test/c.test.ts']);
    expect(result.complete).toBe(true);
  }, 60000);

  it('R3: a listed file that does not exist fails naming it', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const f = fixture([entry('test/gone.test.ts')]);
    await expect(runner.runShards({ root: f.root, count: 2, workers: 1, configFile: f.configFile }))
      .rejects.toThrow(/test\/gone\.test\.ts/);
  });

  it('R4: an entry without its item fails naming test/unstable.json', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const f = fixture([{ file: 'test/c.test.ts', since: '2026-11-19' }]);
    await expect(runner.runShards({ root: f.root, workers: 1, configFile: f.configFile, unstable: true }))
      .rejects.toThrow(/test\/unstable\.json/);
  });

  it('R8 (review): --unstable fails when a listed file ran no test, even when the skip allowlist names it', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const f = fixture([entry('test/c.test.ts'), entry('test/d.test.ts')]);
    write(path.join(f.root, 'test/c.test.ts'), "it.skip('c', () => expect(1).toBe(1));");
    write(path.join(f.root, 'test/skip-allowlist.json'),
      JSON.stringify({ files: [{ file: 'test/c.test.ts', reason: 'fixture' }] }));
    const result = await runner.runShards({ root: f.root, workers: 1, configFile: f.configFile, unstable: true });
    expect(result.exitCode).not.toBe(0);
    expect(JSON.stringify(result.shards.map((shard: { error?: string }) => shard.error))).toContain('test/c.test.ts');
  }, 60000);

  it('R9 (review): --list shows the shards without the listed unstable files', () => {
    const f = fixture([entry('test/c.test.ts')]);
    const r = spawnSync(process.execPath, [SCRIPT, '--list', '--shards', '2'], { cwd: f.root, encoding: 'utf8',
      timeout: 60000 });
    expect(r.status, r.stderr).toBe(0);
    const groups = JSON.parse(r.stdout) as string[][];
    expect(groups.flat().sort()).toEqual(['test/a.test.ts', 'test/b.test.ts', 'test/d.test.ts']);
  });

  it('negative R5: --unstable with an empty list says so and passes without running a file', () => {
    const f = fixture([]);
    const r = spawnSync(process.execPath, [SCRIPT, '--unstable'], { cwd: f.root, encoding: 'utf8', timeout: 60000 });
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(0);
    expect(`${r.stdout}${r.stderr}`).toMatch(/no unstable tests are listed/);
  });
});

describe('B282: this repository lists its unstable tests and runs them on the server', () => {
  it('R6: test/unstable.json parses, names existing tests with their items, and mirrors the local verify.unstable', () => {
    const listed = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'test/unstable.json'), 'utf8')) as
      Array<{ file: string; item: string; since: string }>;
    expect(listed.length).toBeGreaterThan(0);
    for (const item of listed) {
      expect(fs.existsSync(path.join(REPO_ROOT, item.file)), item.file).toBe(true);
      expect(item.item).toMatch(/^B\d+$/);
      expect(item.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const local = path.join(REPO_ROOT, 'openspec/sdlc.yaml');
    if (fs.existsSync(local)) expect(parse(fs.readFileSync(local, 'utf8')).verify?.unstable ?? []).toEqual(listed);
  });

  it('R7: the server run has a stage that runs the unstable files', () => {
    expect(fs.readFileSync(path.join(REPO_ROOT, 'scripts/sandbox/run.sh'), 'utf8'))
      .toMatch(/step unstable node scripts\/test-shards\.mjs --unstable/);
  });
});
