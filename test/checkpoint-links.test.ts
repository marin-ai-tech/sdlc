import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureCheckpoint } from '../src/core/checkpoint.js';
import { assertSnapshotContent } from '../src/core/approval-snapshot.js';
import { digestFiles } from '../src/core/digest.js';
import { spawnSync } from 'node:child_process';
import { initGitRepo, tempDir, write } from './helpers.js';

// Windows lacks the file-symlink privilege here. Model that OS boundary, but create/read genuine Git link blobs.
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
      if (actual.spawnSync('git', ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relative], options)
        .status !== 0) continue;
      const blob = actual.spawnSync('git', ['hash-object', '-w', '--stdin'], { ...options, input: target,
        encoding: 'utf8' }).stdout.trim();
      const staged = actual.spawnSync('git', ['update-index', '--add', '--cacheinfo', '120000', blob, relative], options);
      if (staged.status !== 0) throw new Error('Could not stage the fixture symlink.');
    }
    return result;
  } };
});

describe('B126: immutable linked artifact content', () => {
  beforeEach(() => links.clear());

  it.each(['ordinary', 'ignored', 'absolute', 'chain'])('proves a linked artifact: %s', (kind) => {
    const root = tempDir('sdlc-checkpoint-link-');
    initGitRepo(root);
    const dir = path.join(root, 'openspec/changes/demo');
    write(path.join(dir, 'body.md'), '  # Original linked body\n');
    write(path.join(dir, 'intent.md'), '  # Original linked body\n');
    if (kind !== 'ordinary') write(path.join(root, '.gitignore'), 'body.md\nhop.md\n');
    const target = kind === 'absolute' ? path.join(dir, 'body.md') : kind === 'chain' ? 'hop.md' : 'body.md';
    if (kind === 'chain') {
      write(path.join(dir, 'hop.md'), '  # Original linked body\n');
      links.set(path.join(dir, 'hop.md'), 'body.md');
    }
    links.set(path.join(dir, 'intent.md'), target);
    const capture = new Map();
    const digest = digestFiles(dir, ['intent.md'], undefined, capture);
    const snapshot = captureCheckpoint(root, ['openspec/changes/demo/intent.md'])!;
    expect(snapshot).toBeDefined();
    const rawLink = spawnSync('git', ['show', `${snapshot.tree}:openspec/changes/demo/intent.md`],
      { cwd: root, encoding: 'utf8' });
    expect(rawLink.stdout).toBe(target);
    expect(() => assertSnapshotContent(root, dir, 'intent', snapshot, capture.get(digest), 'tasks.md'))
      .not.toThrow();
    write(path.join(dir, 'body.md'), '# Changed after capture\n');
    expect(snapshot.read('openspec/changes/demo/intent.md')).toBe('  # Original linked body\n');
    const changed = captureCheckpoint(root, ['openspec/changes/demo/intent.md'])!;
    expect(() => assertSnapshotContent(root, dir, 'intent', changed, capture.get(digest), 'tasks.md'))
      .toThrow(/changed/);
    expect(spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).stdout).toBe('');
  });

  it.each(['cycle', 'escape', 'missing'])('refuses %s link dependencies and never reads live targets', (kind) => {
    const root = tempDir('sdlc-checkpoint-link-refuse-');
    initGitRepo(root);
    write(path.join(root, 'intent.md'), 'Placeholder for the modeled link\n');
    links.set(path.join(root, 'intent.md'), kind === 'cycle' ? 'intent.md'
      : kind === 'escape' ? '../outside.md' : 'missing.md');
    expect(captureCheckpoint(root, ['intent.md'])).toBeUndefined();
    // Without an explicit coverage list a raw checkpoint may retain a broken link, but it cannot prove content.
    const raw = captureCheckpoint(root)!;
    expect(raw.read('intent.md')).toBeUndefined();
    expect(raw.read('../outside.md')).toBeUndefined();
  });
});
