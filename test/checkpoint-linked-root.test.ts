import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assertSnapshotContent } from '../src/core/approval-snapshot.js';
import { captureCheckpoint, recordCheckpoint } from '../src/core/checkpoint.js';
import { digestFiles } from '../src/core/digest.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * F2 (close-the-digest-integrity-review-findings): the checkpoint reader resolved tree paths from git's canonical top
 * level (`rev-parse --show-toplevel`) but checked containment against the project root as given. Through a junction
 * (Windows) or a directory symlink (POSIX) the two never agree, so every read gave no content and every approval
 * through a linked root was refused. Containment is now checked against git's top level plus the project prefix, an
 * absolute link target written through the given root is read as the same project path, and a path outside the
 * project still gives no content.
 *
 * The linked root is a real junction or directory symlink. The absolute-target case also needs a link stored in
 * git; Windows lacks the file-symlink privilege here, so that link is modelled as in test/checkpoint-links.test.ts:
 * the filesystem reports it as a link and the temporary index gets a genuine Git link blob.
 */

const { links } = vi.hoisted(() => ({ links: new Map<string, string>() }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual,
    lstatSync: (...args: Parameters<typeof actual.lstatSync>) => links.has(String(args[0]))
      ? { isSymbolicLink: () => true } : actual.lstatSync(...args),
    readlinkSync: (...args: Parameters<typeof actual.readlinkSync>) => links.get(String(args[0]))
      ?? actual.readlinkSync(...args),
  };
});
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>();
  return { ...actual, spawnSync: (...args: Parameters<typeof actual.spawnSync>) => {
    const result = actual.spawnSync(...args);
    const [command, words, options] = args as [string, string[], { cwd: string; env?: NodeJS.ProcessEnv }];
    if (command !== 'git' || !words.includes('add') || !options?.env?.GIT_INDEX_FILE || result.status !== 0) {
      return result;
    }
    for (const [absolute, target] of links) {
      const relative = path.relative(options.cwd, absolute).replace(/\\/g, '/');
      if (relative.startsWith('..')) continue;
      const listed = actual.spawnSync('git', ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relative],
        options);
      if (listed.status !== 0) continue;
      const blob = actual.spawnSync('git', ['hash-object', '-w', '--stdin'], { ...options, input: target,
        encoding: 'utf8' }).stdout.trim();
      const staged = actual.spawnSync('git', ['update-index', '--add', '--cacheinfo', '120000', blob, relative],
        options);
      if (staged.status !== 0) throw new Error('Could not stage the fixture symlink.');
    }
    return result;
  } };
});

const CHANGE_DIR = 'openspec/changes/demo';
const ARTIFACT = `${CHANGE_DIR}/intent.md`;
const TEXT = '  # Original\n\nBody.\n';

/** A real repository and a junction (Windows) or directory symlink (POSIX) to `sub` inside it. */
function linkedProject(sub = '') {
  const top = tempDir('sdlc-linked-root-');
  initGitRepo(top);
  const real = path.join(top, sub);
  fs.mkdirSync(real, { recursive: true });
  const link = path.join(tempDir('sdlc-linked-root-link-'), 'project');
  fs.symlinkSync(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  return { top, real, link };
}

function refs(cwd: string): string {
  return spawnSync('git', ['for-each-ref', 'refs/sdlc'], { cwd, encoding: 'utf8', timeout: 30000 }).stdout;
}

/** Captures through `root`, then proves the evaluated text against the snapshot and records the checkpoint. */
function proveThrough(root: string, evaluate: () => void = () => undefined): boolean {
  const dir = path.join(root, CHANGE_DIR);
  const capture = new Map();
  const digest = digestFiles(dir, ['intent.md'], undefined, capture);
  evaluate();
  return recordCheckpoint(root, 'demo', 'intent', (snapshot) => {
    assertSnapshotContent(root, dir, 'intent', snapshot, capture.get(digest), 'tasks.md');
  }, [ARTIFACT]);
}

describe('F2: the checkpoint reader through a linked project root', () => {
  beforeEach(() => links.clear());

  it('reads the snapshot through a linked project root', () => {
    const p = linkedProject();
    write(path.join(p.real, ARTIFACT), TEXT);
    const snapshot = captureCheckpoint(p.link, [ARTIFACT]);
    expect(snapshot, 'no snapshot through the link').toBeDefined();
    expect(snapshot!.read(ARTIFACT)).toBe(TEXT);
    expect(proveThrough(p.link)).toBe(true);
    expect(refs(p.real)).toContain('refs/sdlc/demo/intent');
  });

  it('reads the snapshot through a linked project folder inside a larger repository', () => {
    const p = linkedProject('app');
    write(path.join(p.real, ARTIFACT), TEXT);
    const snapshot = captureCheckpoint(p.link, [ARTIFACT]);
    expect(snapshot, 'no snapshot through the link').toBeDefined();
    expect(snapshot!.prefix).toBe('app/');
    expect(snapshot!.read(ARTIFACT)).toBe(TEXT);
    expect(proveThrough(p.link)).toBe(true);
    const saved = spawnSync('git', ['cat-file', 'blob', `refs/sdlc/demo/intent:app/${ARTIFACT}`],
      { cwd: p.top, encoding: 'utf8', timeout: 30000 });
    expect(saved.stdout).toBe(TEXT);
  });

  it('reads an absolute link target written through the linked root', () => {
    const p = linkedProject();
    write(path.join(p.real, CHANGE_DIR, 'body.md'), TEXT);
    write(path.join(p.real, ARTIFACT), TEXT);
    const target = path.join(p.link, CHANGE_DIR, 'body.md');
    // The walk of covered paths sees the link through the given root; the temporary index sees the real path.
    links.set(path.join(p.link, ARTIFACT), target);
    links.set(path.join(p.real, ARTIFACT), target);
    const snapshot = captureCheckpoint(p.link, [ARTIFACT]);
    expect(snapshot, 'no snapshot through the link').toBeDefined();
    const stored = spawnSync('git', ['cat-file', '-p', `${snapshot!.tree}:${ARTIFACT}`],
      { cwd: p.real, encoding: 'utf8', timeout: 30000 });
    expect(stored.stdout, 'the fixture link was not stored as a link').toBe(target);
    expect(snapshot!.read(ARTIFACT)).toBe(TEXT);
  });

  it('gives no content for a path outside the project through a linked root', () => {
    const p = linkedProject('app');
    write(path.join(p.top, 'secret.md'), 'Outside the project.\n');
    write(path.join(p.real, 'notes.md'), 'Inside the project.\n');
    git(p.top, ['add', '-A']);
    git(p.top, ['commit', '-q', '-m', 'files']);
    const snapshot = captureCheckpoint(p.link);
    expect(snapshot, 'no snapshot through the link').toBeDefined();
    for (const outside of ['../secret.md', 'sub/../../secret.md']) {
      expect(snapshot!.read(outside), outside).toBeUndefined();
    }
    // A link stored in the project that points at the repository file outside the project gives no content either.
    write(path.join(p.real, ARTIFACT), 'Placeholder for the modelled link\n');
    links.set(path.join(p.real, ARTIFACT), path.join(p.top, 'secret.md'));
    const linked = captureCheckpoint(p.link);
    expect(linked, 'no snapshot through the link').toBeDefined();
    expect(linked!.read(ARTIFACT)).toBeUndefined();
  });

  it('refuses an artifact changed after evaluation through a linked root', () => {
    const p = linkedProject();
    write(path.join(p.real, ARTIFACT), TEXT);
    const edit = () => write(path.join(p.real, ARTIFACT), '# Replacement\n');
    expect(() => proveThrough(p.link, edit)).toThrow(/changed/);
    expect(refs(p.real)).toBe('');
  });
});
