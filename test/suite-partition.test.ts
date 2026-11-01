import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, tempDir, write } from './helpers.js';

function independentlyListed(root: string, folder = 'test'): string[] {
  return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${folder}/${entry.name}`;
    return entry.isDirectory() ? independentlyListed(root, relative)
      : relative.endsWith('.test.ts') ? [relative] : [];
  }).sort();
}

interface FixtureShard { root: string; index: number; files: string[]; reportFile: string; inventoryFile: string }

/** The scheduling seam supplies explicit report observations; production parsing still validates them. */
function fixtureReport(shard: FixtureShard, exitCode: number) {
  const total = shard.files.length;
  write(shard.reportFile, JSON.stringify({ success: exitCode === 0, numTotalTests: total,
    numPassedTests: exitCode === 0 ? total : 0, numFailedTests: exitCode === 0 ? 0 : total, numPendingTests: 0,
    testResults: shard.files.map((file) => ({ name: path.join(shard.root, file) })) }));
  write(shard.inventoryFile, JSON.stringify({ all: independentlyListed(shard.root), selected: shard.files }));
  return { exitCode };
}

describe('Exhaustive optional suite shards', () => {
  it('covers every actual repository test exactly once independently of file order', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const expected = independentlyListed(REPO_ROOT);
    const discovered = runner.discoverTestFiles(REPO_ROOT);
    expect(discovered).toEqual(expected);
    const groups = runner.partitionFiles([...discovered].reverse(), 7);
    expect(groups).toHaveLength(7);
    expect(groups.flat().sort()).toEqual(expected);
    expect(new Set(groups.flat()).size).toBe(expected.length);
    expect(groups).toEqual(runner.partitionFiles(discovered, 7));
    expect(() => runner.partitionFiles(discovered, 0)).toThrow();
    expect(() => runner.partitionFiles([...discovered, discovered[0]], 2)).toThrow();
  });

  it('runs every required shard and propagates an actual failed subprocess instead of returning success', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const root = tempDir('sdlc-shard-failure-');
    for (const name of ['a', 'b', 'c']) write(path.join(root, 'test', `${name}.test.ts`), 'fixture');
    const visited: number[] = [];
    const result = await runner.runShards({ root, count: 3, execute: (shard: FixtureShard) => {
      visited.push(shard.index);
      const child = spawnSync(process.execPath, ['-e', `process.exit(${shard.index === 2 ? 7 : 0})`], {
        timeout: 10000,
      });
      return fixtureReport(shard, child.status ?? 1);
    } });
    expect(visited).toEqual([1, 2, 3]);
    expect(result.exitCode).toBe(7);
    expect(result.shards.map((shard: { exitCode: number }) => shard.exitCode)).toEqual([0, 7, 0]);
    expect(result.shards.every((shard: { durationMs: number }) => shard.durationMs >= 0)).toBe(true);
  });

  it('refuses an incomplete, extra or duplicate actual-execution inventory', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const expected = ['test/a.test.ts', 'test/b.test.ts'];
    expect(() => runner.assertInventory(expected, ['test/a.test.ts'])).toThrow();
    expect(() => runner.assertInventory(expected, [...expected, 'test/c.test.ts'])).toThrow();
    expect(() => runner.assertInventory(expected, [...expected, 'test/b.test.ts'])).toThrow();
    expect(() => runner.assertInventory(expected, [...expected].reverse())).not.toThrow();
  });

  it('supports a separately configured shard without presenting its partial inventory as a full run', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const root = tempDir('sdlc-one-shard-');
    for (const name of ['a', 'b', 'c']) write(path.join(root, 'test', `${name}.test.ts`), 'fixture');
    const visited: number[] = [];
    const result = await runner.runShards({ root, count: 3, index: 2, execute: (shard: FixtureShard) => {
      visited.push(shard.index);
      return fixtureReport(shard, 0);
    } });
    expect(visited).toEqual([2]);
    expect(result.files).toEqual(['test/b.test.ts']);
    expect(result.discoveredFiles).toHaveLength(3);
    expect(result.complete).toBe(false);
  });

  it.each(['missing', 'malformed', 'partial'])('reports observed coverage after an actual %s report', async (kind) => {
    const runner = await import('../scripts/test-shards.mjs');
    const root = tempDir('sdlc-unobservable-shard-');
    for (const name of ['a', 'b']) {
      write(path.join(root, 'test', `${name}.test.ts`), `it('${name}', () => expect(1).toBe(1));`);
    }
    const configFile = path.join(root, 'vitest.config.mjs');
    const before = kind === 'missing' ? 'process.exit(9);\n' : kind === 'malformed'
      ? "import fs from 'node:fs';\n"
        + "process.once('exit', () => fs.writeFileSync(process.env.SDLC_TEST_REPORT, '{broken'));\n"
      : '';
    const include = kind === 'partial' ? ", include: ['test/a.test.ts']" : '';
    write(configFile, `${before}export default { test: { globals: true${include} } };`);
    const result = await runner.runShards({ root, count: 1, workers: 1, configFile, full: true });
    const reportFile = result.shards[0].reportFile;
    if (kind === 'missing') expect(fs.existsSync(reportFile)).toBe(false);
    else if (kind === 'malformed') expect(() => JSON.parse(fs.readFileSync(reportFile, 'utf8'))).toThrow();
    else {
      const actual = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      expect(actual.numPassedTests).toBe(1);
      expect(actual.testResults.map((entry: { name: string }) => path.basename(entry.name))).toEqual(['a.test.ts']);
    }
    const observed = kind === 'partial' ? ['test/a.test.ts'] : [];
    expect(result).toMatchObject({ exitCode: 1, complete: false, files: observed });
    expect(result.discoveredFiles).toEqual(['test/a.test.ts', 'test/b.test.ts']);
    expect(result.shards[0].error).toEqual(expect.any(String));
    const summary = JSON.parse(fs.readFileSync(path.join(result.output, 'summary.json'), 'utf8'));
    expect(summary).toMatchObject({ exitCode: 1, complete: false, files: observed });
  }, 20000);

  it('actual Vitest shards and full reporting retain every fixture and report a deliberate failing test', async () => {
    const runner = await import('../scripts/test-shards.mjs');
    const root = tempDir('sdlc-real-shards-');
    for (const name of ['a', 'b', 'c']) {
      const actual = name === 'b' ? 2 : 1;
      write(path.join(root, 'test', `${name}.test.ts`), `it('${name}', () => expect(1).toBe(${actual}));`);
    }
    const configFile = path.join(root, 'vitest.config.mjs');
    const sequencer = pathToFileURL(path.join(REPO_ROOT, 'scripts/test-shards.mjs')).href;
    write(configFile, `import Seq from ${JSON.stringify(sequencer)};
export default { test: { globals: true, sequence: { sequencer: Seq } } };`);
    for (const full of [false, true]) {
      const result = await runner.runShards({ root, count: 2, workers: 1, configFile, full });
      expect(result.exitCode).toBe(1);
      expect(result.complete).toBe(true);
      expect(result.shards.flatMap((shard: { files: string[] }) => shard.files).sort()).toEqual([
        'test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts',
      ]);
      expect(result.shards.reduce((sum: number, shard: { failed: number }) => sum + shard.failed, 0)).toBe(1);
      expect(result.shards.reduce((sum: number, shard: { passed: number }) => sum + shard.passed, 0)).toBe(2);
      expect(result.durationMs).toBeGreaterThan(0);
      const report = JSON.parse(fs.readFileSync(path.join(result.output, 'summary.json'), 'utf8'));
      expect(report.exitCode).toBe(1);
      expect(report.files).toHaveLength(3);
      expect(report.complete).toBe(true);
    }
  }, 60000);

  it('separates the real backlog gate case into bounded intent/spec, plan and verify/review phases', () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'test/e2e-backlog.test.ts'), 'utf8');
    for (const phase of [
      '3a. intent gate',
      '3b. spec gate',
      '3c. plan gate',
      '3d. verification gate',
      '3e. review evidence and checks',
      '3f. review approval gate',
    ]) {
      expect(text).toContain(phase);
    }
    expect(text).not.toContain("it('3. the change goes through every gate for real'");
  });

  it('reuses an immutable fixture snapshot and refuses Git, decisions, tokens, stores and linked sources', async () => {
    const fixtures = await import('./fixtures/project-template.js');
    const source = tempDir('sdlc-template-source-');
    write(path.join(source, 'package.json'), '{"name":"fixture"}');
    write(path.join(source, 'src/app.ts'), 'export const value = 1;');
    const template = fixtures.immutableProjectTemplate(source);
    const first = tempDir('sdlc-template-first-');
    const second = tempDir('sdlc-template-second-');
    template.copyTo(first);
    write(path.join(first, 'src/app.ts'), 'changed in a test');
    template.copyTo(second);
    expect(fs.readFileSync(path.join(second, 'src/app.ts'), 'utf8')).toBe('export const value = 1;');
    const forbiddenPaths = ['.git/config', '.sdlc.yaml', 'openspec/.sdlc/board.json',
      'openspec/roles.yaml', 'openspec/executors.yaml', '.env', 'token.json'];
    for (const forbidden of forbiddenPaths) {
      const unsafe = tempDir('sdlc-template-unsafe-');
      write(path.join(unsafe, forbidden), 'private state');
      expect(() => fixtures.immutableProjectTemplate(unsafe), forbidden).toThrow();
    }
    const linked = tempDir('sdlc-template-linked-');
    const outside = tempDir('sdlc-template-outside-');
    write(path.join(outside, 'private.txt'), 'outside the immutable fixture');
    fs.symlinkSync(outside, path.join(linked, 'source'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => fixtures.immutableProjectTemplate(linked)).toThrow();
    expect(template.files.sort()).toEqual(['package.json', 'src/app.ts']);
  });

  it('refuses linked destination folders before copying any immutable fixture file', async () => {
    const fixtures = await import('./fixtures/project-template.js');
    const source = tempDir('sdlc-template-link-source-');
    write(path.join(source, 'package.json'), '{}');
    write(path.join(source, 'src/app.ts'), 'immutable');
    const target = tempDir('sdlc-template-link-target-');
    const outside = tempDir('sdlc-template-link-outside-');
    fs.symlinkSync(outside, path.join(target, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => fixtures.immutableProjectTemplate(source).copyTo(target)).toThrow();
    expect(fs.existsSync(path.join(target, 'package.json'))).toBe(false);
    expect(fs.readdirSync(outside)).toEqual([]);
  });
});
