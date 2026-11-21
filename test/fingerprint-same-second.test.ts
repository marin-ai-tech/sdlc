import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { worktreeFingerprint } from '../src/core/git.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * B326 (change fingerprint-same-second). worktreeFingerprint seeds a temporary index with a copy of the git index.
 * On Linux the copy gets a new modification time, so git no longer treats entries written in the same second as the
 * index as racy and trusts their cached stat: a same-size edit in that second kept the old blob, and the fingerprint
 * did not change (server suite on 07237ce5, review-rounds R1). The fingerprint must name the bytes on disk.
 */

const TRIES = 30;
const SLOW = 180000;

function committed(content: string): { root: string; file: string } {
  const root = tempDir('sdlc-b326-');
  initGitRepo(root);
  const file = path.join(root, 'src/a.js');
  write(file, content);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  return { root, file };
}

function sleep(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

describe('B326: the source fingerprint names the bytes on disk', () => {
  it('S1 a same-size edit right after the index write changes the fingerprint, every time', () => {
    const stale: number[] = [];
    for (let attempt = 0; attempt < TRIES; attempt += 1) {
      const { root, file } = committed('export const a = 1;\n');
      const before = worktreeFingerprint(root);
      fs.writeFileSync(file, 'export const a = 2;\n');
      if (worktreeFingerprint(root) === before) stale.push(attempt);
    }
    expect(stale, `stale fingerprints in ${stale.length} of ${TRIES} tries`).toEqual([]);
  }, SLOW);

  it('S2 an edit with the old modification time restored and ctime not trusted still changes it', () => {
    const { root, file } = committed('export const a = 1;\n');
    git(root, ['config', 'core.trustctime', 'false']);
    const stat = fs.statSync(file);
    sleep(1100);
    write(path.join(root, 'other.txt'), 'other\n');
    git(root, ['add', 'other.txt']);
    const before = worktreeFingerprint(root);
    fs.writeFileSync(file, 'export const a = 2;\n');
    fs.utimesSync(file, stat.atime, stat.mtime);
    expect(worktreeFingerprint(root)).not.toBe(before);
  }, SLOW);

  it.each(['--assume-unchanged', '--skip-worktree'])('S4 an edit of a file flagged %s changes it', (flag) => {
    const { root, file } = committed('export const a = 1;\n');
    const before = worktreeFingerprint(root);
    git(root, ['update-index', flag, 'src/a.js']);
    fs.writeFileSync(file, 'export const a = 22;\n');
    expect(worktreeFingerprint(root)).not.toBe(before);
  }, SLOW);

  // Review round 1 (Codex c-20261118-105808-189a): findings 2, 3 and the skip-worktree remark of finding 1.
  function restoredEdit(file: string, stat: fs.Stats): void {
    fs.writeFileSync(file, 'export const a = 2;\n');
    fs.utimesSync(file, stat.atime, stat.mtime);
    expect(fs.statSync(file).size).toBe(stat.size);
  }

  it('S5 a flag on one file does not stop the content check of another, restored-time edit', () => {
    const { root, file } = committed('export const a = 1;\n');
    write(path.join(root, 'src/b.js'), 'export const b = 1;\n');
    git(root, ['add', '-A']);
    git(root, ['config', 'core.trustctime', 'false']);
    git(root, ['update-index', '--assume-unchanged', 'src/b.js']);
    const stat = fs.statSync(file);
    sleep(1100);
    write(path.join(root, 'other.txt'), 'other\n');
    git(root, ['add', 'other.txt']);
    const before = worktreeFingerprint(root);
    restoredEdit(file, stat);
    expect(worktreeFingerprint(root)).not.toBe(before);
  }, SLOW);

  it('S6 a file staged with a modification time of 0 is still read after a restored-time edit', () => {
    const { root, file } = committed('export const a = 1;\n');
    git(root, ['config', 'core.trustctime', 'false']);
    fs.utimesSync(file, 0, 0);
    git(root, ['add', '-A']);
    const stat = fs.statSync(file);
    sleep(1100);
    write(path.join(root, 'other.txt'), 'other\n');
    git(root, ['add', 'other.txt']);
    const before = worktreeFingerprint(root);
    restoredEdit(file, stat);
    expect(worktreeFingerprint(root)).not.toBe(before);
  }, SLOW);

  it('S7 a skip-worktree file with a same-size, restored-time edit changes it', () => {
    const { root, file } = committed('export const a = 1;\n');
    git(root, ['config', 'core.trustctime', 'false']);
    const stat = fs.statSync(file);
    sleep(1100);
    write(path.join(root, 'other.txt'), 'other\n');
    git(root, ['add', 'other.txt']);
    const before = worktreeFingerprint(root);
    git(root, ['update-index', '--skip-worktree', 'src/a.js']);
    restoredEdit(file, stat);
    expect(worktreeFingerprint(root)).not.toBe(before);
  }, SLOW);

  it('S8 negative: a skip-worktree file absent from disk (sparse checkout) stays in the tree', () => {
    const { root, file } = committed('export const a = 1;\n');
    const before = worktreeFingerprint(root);
    git(root, ['update-index', '--skip-worktree', 'src/a.js']);
    fs.rmSync(file);
    expect(worktreeFingerprint(root)).toBe(before);
    const listed = spawnSync('git', ['ls-files', '-v'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
    expect(listed).toBe('S src/a.js');
  }, SLOW);

  it('S9 a deleted tracked file changes the fingerprint and never makes it unavailable', () => {
    const { root, file } = committed('export const a = 1;\n');
    write(path.join(root, 'src/b.js'), 'export const b = 1;\n');
    git(root, ['add', '-A']);
    const before = worktreeFingerprint(root);
    fs.rmSync(file);
    const after = worktreeFingerprint(root);
    expect(after).toMatch(/^git-tree:[0-9a-f]+$/);
    expect(after).not.toBe(before);
  }, SLOW);

  it('S3 negative: an unchanged tree keeps its fingerprint, and a touched file with the same bytes does too', () => {
    const { root, file } = committed('export const a = 1;\n');
    const before = worktreeFingerprint(root);
    expect(before).toMatch(/^git-tree:[0-9a-f]+$/);
    expect(worktreeFingerprint(root)).toBe(before);
    fs.writeFileSync(file, 'export const a = 1;\n');
    expect(worktreeFingerprint(root)).toBe(before);
  }, SLOW);
});
