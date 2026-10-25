import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSnapshotContent } from '../src/core/approval-snapshot.js';
import { captureCheckpoint, recordCheckpoint } from '../src/core/checkpoint.js';
import { digestFiles, withoutCheckboxState } from '../src/core/digest.js';
import { tempDir, initGitRepo, write } from './helpers.js';

describe('B126 D3: checkpoint content proof', () => {
  it('accepts task checkbox normalization in each planning gate with a custom artifact mapping', () => {
    const root = tempDir('sdlc-checkpoint-custom-gate-');
    initGitRepo(root);
    const dir = path.join(root, 'openspec/changes/demo');
    write(path.join(dir, 'work.md'), '# Work\n\n- [x] 1.1 Completed task\n');
    const capture = new Map();
    const digest = digestFiles(dir, ['work.md'], (_relative, text) => withoutCheckboxState(text), capture);
    const snapshot = captureCheckpoint(root)!;
    for (const gate of ['intent', 'spec', 'plan']) {
      expect(() => assertSnapshotContent(root, dir, gate, snapshot, capture.get(digest), 'work.md'))
        .not.toThrow();
    }
    expect(() => assertSnapshotContent(root, dir, 'review', snapshot, capture.get(digest), 'work.md'))
      .toThrow(/changed/);
  });

  it('can prove an explicitly covered artifact even when process files are git-ignored', () => {
    const root = tempDir('sdlc-checkpoint-ignored-');
    initGitRepo(root);
    write(path.join(root, '.gitignore'), 'openspec/\n');
    const dir = path.join(root, 'openspec/changes/demo');
    write(path.join(dir, 'intent.md'), '# Original\n');
    const capture = new Map();
    const digest = digestFiles(dir, ['intent.md'], undefined, capture);
    expect(recordCheckpoint(root, 'demo', 'intent', (snapshot) => {
      assertSnapshotContent(root, dir, 'intent', snapshot, capture.get(digest), 'tasks.md');
    }, ['openspec/changes/demo/intent.md'])).toBe(true);
    const saved = spawnSync('git', ['show', 'refs/sdlc/demo/intent:openspec/changes/demo/intent.md'],
      { cwd: root, encoding: 'utf8' });
    expect(saved.stdout).toBe('# Original\n');
    const index = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
    expect(index.stdout).toBe('');
  });

  it('rejects an immutable tree whose artifact differs from the evaluated text, without moving a ref', () => {
    const root = tempDir('sdlc-checkpoint-proof-');
    initGitRepo(root);
    const dir = path.join(root, 'openspec/changes/demo');
    write(path.join(dir, 'intent.md'), '  # Original\n');
    const capture = new Map();
    const digest = digestFiles(dir, ['intent.md'], undefined, capture);
    write(path.join(dir, 'intent.md'), '# Replacement\n');
    expect(() => recordCheckpoint(root, 'demo', 'intent', (snapshot) => {
      assertSnapshotContent(root, dir, 'intent', snapshot, capture.get(digest), 'tasks.md');
    })).toThrow(/changed/);
    const refs = spawnSync('git', ['for-each-ref', 'refs/sdlc'], { cwd: root, encoding: 'utf8' });
    expect(refs.stdout).toBe('');
  });

  it('the snapshot reader preserves leading whitespace and cannot observe later writes', () => {
    const root = tempDir('sdlc-checkpoint-frozen-');
    initGitRepo(root);
    write(path.join(root, 'a.md'), '  Original\n');
    const snapshot = captureCheckpoint(root)!;
    write(path.join(root, 'a.md'), 'Replacement\n');
    expect(snapshot.read('a.md')).toBe('  Original\n');
  });
});
