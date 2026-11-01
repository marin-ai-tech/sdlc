import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { acquireWriterLock } from '../dist/core/writer-lock.js';
import { updateBoard } from '../dist/core/board-store.js';
import { immutableBoardProject } from './fixtures/immutable-board-project.js';
import { git, initGitRepo, read, tempDir, write } from './helpers.js';
import { decisionProject } from './e20-decision-fixture.js';

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (relative: string) => {
    const dir = path.join(root, relative);
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = path.join(relative, item.name);
      if (item.isDirectory()) visit(name);
      else files[name] = fs.readFileSync(path.join(root, name)).toString('base64');
    }
  };
  visit('');
  return files;
}

function fixture() {
  const seeds: Array<{ root: string; bytes: Record<string, string> }> = [];
  const build = () => {
    const root = tempDir('sdlc-small-real-board-seed-');
    initGitRepo(root);
    git(root, ['checkout', '-qb', 'main']);
    write(path.join(root, 'src/value.txt'), 'original\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'real immutable fixture seed']);
    seeds.push({ root, bytes: snapshot(root) });
    return root;
  };
  return { seeds, copies: immutableBoardProject(build, 'sdlc-independent-board-copy-') };
}

describe('Immutable real-Git board fixture acceptance', () => {
  it('refuses real CLI-created approvals instead of copying their authority', () => {
    const p = decisionProject();
    const approved = p.cli(['approve', 'intent', '--change', 'demo', '--json']);
    expect(approved.code, approved.stdout + approved.stderr).toBe(0);
    const copies = immutableBoardProject(() => p.root, 'sdlc-refused-approved-seed-');
    expect(() => copies.create()).toThrow(/authority|decision|approval/i);
  }, 120000);

  it.each([
    'openspec/.sdlc/mcp-auth.json',
    'openspec/.sdlc/plugins/state/demo/store.json',
    'openspec/changes/demo/verification.md',
    'openspec/changes/demo/.sdlc.yaml',
  ])('refuses private authority or execution results in scaffolding: %s', file => {
    const actual = fixture().copies.create();
    write(path.join(actual, file), 'not reusable scaffolding');
    const copies = immutableBoardProject(() => actual, 'sdlc-refused-private-seed-');
    expect(() => copies.create()).toThrow(/authority|decision|result/i);
  });

  it('refuses checkpoint refs even without a copied lifecycle record', () => {
    const actual = fixture().copies.create();
    git(actual, ['update-ref', 'refs/sdlc/checkpoints/demo/intent', 'HEAD']);
    const copies = immutableBoardProject(() => actual, 'sdlc-refused-checkpoint-seed-');
    expect(() => copies.create()).toThrow(/authority|decision|checkpoint/i);
  });

  it('refuses checkpoint authority after Git packs its refs', () => {
    const source = fixture().copies.create();
    git(source, ['update-ref', 'refs/sdlc/demo/intent', 'HEAD']);
    git(source, ['pack-refs', '--all', '--prune']);
    const copies = immutableBoardProject(() => source, 'sdlc-copy-packed-authority-');
    expect(() => copies.create()).toThrow(/packed decision\/checkpoint authority/i);
  });

  it('refuses a credential-bearing Git configuration', () => {
    const source = fixture().copies.create();
    git(source, ['config', 'http.https://example.test/.extraheader', 'Authorization: fixture-secret']);
    const copies = immutableBoardProject(() => source, 'sdlc-copy-credentials-');
    expect(() => copies.create()).toThrow(/credential.*authority/i);
  });

  it('builds the real seed once for two project copies', () => {
    const p = fixture();
    const first = p.copies.create();
    const second = p.copies.create();
    expect(first).not.toBe(second);
    expect(p.copies.measurements().seedBuilds).toBe(p.seeds.length);
    expect(p.seeds).toHaveLength(1);
    expect(p.copies.measurements().cloneMs).toHaveLength(2);
  });

  it('keeps working files, Git refs and seed bytes independent after a real commit', () => {
    const p = fixture();
    const first = p.copies.create();
    const second = p.copies.create();
    write(path.join(first, 'src/value.txt'), 'first only\n');
    git(first, ['add', '-A']);
    git(first, ['commit', '-qm', 'first copy mutation']);
    git(first, ['update-ref', 'refs/heads/first-only', 'HEAD']);
    expect(read(path.join(second, 'src/value.txt'))).toBe('original\n');
    expect(fs.existsSync(path.join(second, '.git/refs/heads/first-only'))).toBe(false);
    for (const seed of p.seeds) expect(snapshot(seed.root)).toEqual(seed.bytes);
  });

  it('always makes a physical copy, including the first working tree and Git metadata', () => {
    const p = fixture();
    const first = p.copies.create();
    expect(first).not.toBe(p.seeds[0].root);
    expect(fs.lstatSync(path.join(first, '.git')).isDirectory()).toBe(true);
    expect(fs.existsSync(path.join(first, '.git/objects/info/alternates'))).toBe(false);
    for (const file of ['src/value.txt', '.git/HEAD', '.git/refs/heads/main']) {
      const original = fs.statSync(path.join(p.seeds[0].root, file), { bigint: true });
      const copy = fs.statSync(path.join(first, file), { bigint: true });
      expect([copy.dev, copy.ino], file).not.toEqual([original.dev, original.ino]);
    }
  });

  it('refuses Git directory indirection before copying it', () => {
    const actual = fixture().copies.create();
    const indirect = tempDir('sdlc-indirect-board-seed-');
    fs.symlinkSync(path.join(actual, '.git'), path.join(indirect, '.git'), 'junction');
    const copies = immutableBoardProject(() => indirect, 'sdlc-refused-board-copy-');
    expect(() => copies.create()).toThrow(/physical|indirection/i);
  });

  it('refuses an external Git object alternate', () => {
    const actual = fixture().copies.create();
    const other = fixture().copies.create();
    write(path.join(actual, '.git/objects/info/alternates'), `${path.join(other, '.git/objects')}\n`);
    const copies = immutableBoardProject(() => actual, 'sdlc-refused-board-copy-');
    expect(() => copies.create()).toThrow(/alternates|indirection/i);
  });

  it('refuses a live writer without changing its real ownership bytes', () => {
    const actual = fixture().copies.create();
    const lock = path.join(actual, 'openspec/.sdlc/board.lock');
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    const lease = acquireWriterLock(lock, 1000);
    try {
      const copies = immutableBoardProject(() => actual, 'sdlc-refused-board-copy-');
      expect(() => copies.create()).toThrow(/lock|quiescent/i);
      expect(read(lock)).toBe(lease.owner);
    } finally { lease.release(); }
  });

  it('refuses board state published by the real harness writer', () => {
    const actual = fixture().copies.create();
    updateBoard(actual, () => {});
    const copies = immutableBoardProject(() => actual, 'sdlc-refused-board-copy-');
    expect(() => copies.create()).toThrow(/board state|quiescent/i);
  });
});
