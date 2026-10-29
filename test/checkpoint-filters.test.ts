import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertSnapshotContent } from '../src/core/approval-snapshot.js';
import { captureCheckpoint, recordCheckpoint } from '../src/core/checkpoint.js';
import { digestFiles } from '../src/core/digest.js';
import { git, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F3 (close-the-digest-integrity-review-findings): the checkpoint reader returned the raw blob (`git cat-file blob`)
 * while the evaluation hashed the worktree text. With a git filter such as `ident` the two differ for unchanged
 * content (`$Id$` stored, `$Id: <oid> $` checked out), so the approval was refused. The comparison now accepts the
 * stored blob or the blob as git checks it out through the path's filters, and nothing else: a real edit, or a
 * keyword the worktree text forged, still refuses. Real git throughout; the repository sets `core.autocrlf=false`
 * so the snapshot blob is the committed one (a CRLF checkout stores another object with another `$Id`).
 */

const ARTIFACT = 'openspec/changes/demo/intent.md';
const TEXT = '# Intent\n\nRevision: $Id$\n\nBody.\n';
const EXPANDED = /\$Id: [0-9a-f]{40,64} \$/;

function project() {
  const root = tempDir('sdlc-checkpoint-ident-');
  initGitRepo(root);
  git(root, ['config', 'core.autocrlf', 'false']);
  write(path.join(root, '.gitattributes'), `${ARTIFACT} ident\n`);
  write(path.join(root, ARTIFACT), TEXT);
  const file = path.join(root, ARTIFACT);
  const dir = path.dirname(file);
  /** Commits the artifact and lets git check it out again, which expands the keyword in the worktree. */
  const checkout = () => {
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'artifact']);
    fs.rmSync(file);
    git(root, ['checkout', '--', ARTIFACT]);
    expect(read(file), 'git did not expand the keyword').toMatch(EXPANDED);
  };
  const evaluate = () => {
    const capture = new Map();
    const digest = digestFiles(dir, ['intent.md'], undefined, capture);
    return capture.get(digest);
  };
  return { root, file, dir, checkout, evaluate };
}

function refs(cwd: string): string {
  return spawnSync('git', ['for-each-ref', 'refs/sdlc'], { cwd, encoding: 'utf8', timeout: 30000 }).stdout;
}

describe('F3: checkpoint comparison with a git filter', () => {
  it('accepts an ident artifact checked out by git', () => {
    const p = project();
    p.checkout();
    const evaluated = p.evaluate();
    const snapshot = captureCheckpoint(p.root, [ARTIFACT])!;
    expect(snapshot).toBeDefined();
    expect(() => assertSnapshotContent(p.root, p.dir, 'intent', snapshot, evaluated, 'tasks.md')).not.toThrow();
    const recorded = recordCheckpoint(p.root, 'demo', 'intent', (captured) => {
      assertSnapshotContent(p.root, p.dir, 'intent', captured, evaluated, 'tasks.md');
    }, [ARTIFACT]);
    expect(recorded).toBe(true);
    // The checkpoint keeps the stored blob, the keyword as git keeps it.
    const saved = spawnSync('git', ['cat-file', 'blob', `refs/sdlc/demo/intent:${ARTIFACT}`],
      { cwd: p.root, encoding: 'utf8', timeout: 30000 });
    expect(saved.stdout).toBe(TEXT);
  });

  it('refuses an ident artifact edited after evaluation', () => {
    const p = project();
    p.checkout();
    const evaluated = p.evaluate();
    write(p.file, read(p.file).replace('Body.', 'Edited body.'));
    expect(() => recordCheckpoint(p.root, 'demo', 'intent', (captured) => {
      assertSnapshotContent(p.root, p.dir, 'intent', captured, evaluated, 'tasks.md');
    }, [ARTIFACT])).toThrow(/changed/);
    expect(refs(p.root)).toBe('');
  });

  it('refuses an ident keyword that the worktree text forged', () => {
    const p = project();
    p.checkout();
    // Git stores the same blob for any expanded keyword, but checks out only the real one.
    write(p.file, read(p.file).replace(EXPANDED, `$Id: ${'0'.repeat(40)} $`));
    const evaluated = p.evaluate();
    const snapshot = captureCheckpoint(p.root, [ARTIFACT])!;
    expect(snapshot).toBeDefined();
    expect(() => assertSnapshotContent(p.root, p.dir, 'intent', snapshot, evaluated, 'tasks.md'))
      .toThrow(/changed/);
  });

  it('accepts a new ident artifact whose worktree text still has the unexpanded keyword', () => {
    const p = project();
    expect(read(p.file)).toBe(TEXT);
    const evaluated = p.evaluate();
    const recorded = recordCheckpoint(p.root, 'demo', 'intent', (captured) => {
      assertSnapshotContent(p.root, p.dir, 'intent', captured, evaluated, 'tasks.md');
    }, [ARTIFACT]);
    expect(recorded).toBe(true);
    expect(refs(p.root)).toContain('refs/sdlc/demo/intent');
  });
});
