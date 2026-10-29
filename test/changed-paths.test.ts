import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { parseChangedPaths, readChangedPaths } from '../src/core/changed-paths.js';
import * as gitModule from '../src/core/git.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * B151 (review finding F9 of harness-runtime-prototype): the result check reads the changed paths of
 * `<base>..<branch>` with `git diff --name-status -z --no-renames --no-relative` and parses the NUL-separated
 * listing at the boundary. One record is a status (`A`, `D`, `M` or `T`) and one path; the path is taken exactly as
 * git stores it. Anything else fails closed as `{ ok: false }`, with no `files`, so no path counts as checked.
 * Red on the code before B151: the module `src/core/changed-paths.ts` does not exist, so the import fails.
 */

const NUL = '\0';

/** A listing of `[status, path]` records, each field followed by one NUL, as `git diff -z` prints it. */
function listing(records: Array<[string, string]>): string {
  return records.map(([status, file]) => `${status}${NUL}${file}${NUL}`).join('');
}

function expectFailure(text: string): void {
  const result = parseChangedPaths(text);
  expect(result, JSON.stringify(text)).toEqual({ ok: false });
  expect(result, JSON.stringify(text)).not.toHaveProperty('files');
}

describe('B151: parseChangedPaths', () => {
  it('reads one path per A, D, M and T record, exactly as given', () => {
    const text = listing([['A', 'a.js'], ['D', 'b.js'], ['M', 'c d.js'], ['T', 'e.js']]);
    expect(text).toBe(`A${NUL}a.js${NUL}D${NUL}b.js${NUL}M${NUL}c d.js${NUL}T${NUL}e.js${NUL}`);
    expect(parseChangedPaths(text)).toEqual({ ok: true, files: ['a.js', 'b.js', 'c d.js', 'e.js'] });
  });

  it('keeps a trailing space, a line break and a non-ASCII name', () => {
    const text = listing([['M', 'name '], ['A', 'two\nlines.ts'], ['M', 'config/tést.yaml']]);
    const result = parseChangedPaths(text);
    expect(result).toEqual({ ok: true, files: ['name ', 'two\nlines.ts', 'config/tést.yaml'] });
    expect(JSON.stringify(result)).not.toContain('\\303');
    expect(JSON.stringify(result)).not.toContain('\\"');
  });

  it('an empty listing is ok and empty', () => {
    expect(parseChangedPaths('')).toEqual({ ok: true, files: [] });
  });

  it('fails closed on a rename or copy status', () => {
    expectFailure(`R100${NUL}a${NUL}b${NUL}`);
    expectFailure(`C75${NUL}a${NUL}b${NUL}`);
  });

  it('fails closed on an unknown status', () => {
    expectFailure(`X${NUL}a${NUL}`);
    expectFailure(`MM${NUL}a${NUL}`);
    expectFailure(`U${NUL}a${NUL}`);
  });

  it('fails closed on a status without a path, an empty path or a missing final NUL', () => {
    expectFailure(`M${NUL}`);
    expectFailure(`M${NUL}${NUL}`);
    expectFailure(`M${NUL}a`);
    expectFailure(`M${NUL}a${NUL}D${NUL}`);
  });
});

/** A repository with `sub/` and one commit on top of main that changes a file inside and one outside `sub/`. */
function twoCommits() {
  const root = tempDir('sdlc-changed-paths-');
  initGitRepo(root);
  write(path.join(root, 'sub/in.txt'), 'in\n');
  write(path.join(root, 'out.txt'), 'out\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'base']);
  write(path.join(root, 'sub/in.txt'), 'in, changed\n');
  write(path.join(root, 'out.txt'), 'out, changed\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'work']);
  const sha = (rev: string) => spawnSync('git', ['rev-parse', rev], { cwd: root, encoding: 'utf-8', timeout: 30000 })
    .stdout.trim();
  return { root, base: sha('HEAD~1'), branch: sha('HEAD') };
}

describe('B151 review round 1: the listing pins the settings that change it', () => {
  it('the listing call names --no-renames, --no-relative and --ignore-submodules=none', () => {
    // F1: no other test proves the flags; removing one kept the suite green.
    const repo = twoCommits();
    const spy = vi.spyOn(gitModule, 'git');
    try {
      expect(readChangedPaths(repo.root, repo.base, repo.branch).ok).toBe(true);
      const listing = spy.mock.calls.find(([, args]) => args[0] === 'diff')?.[1] ?? [];
      expect(listing).toEqual(expect.arrayContaining(['--no-renames', '--no-relative', '--ignore-submodules=none']));
      expect(listing).toContain('-z');
    } finally {
      spy.mockRestore();
    }
  });

  it('a subdirectory with diff.relative=true still lists every changed path from the top level', () => {
    // F1: from the top level relative output equals normal output, so only a subdirectory proves --no-relative.
    const repo = twoCommits();
    git(repo.root, ['config', 'diff.relative', 'true']);
    const result = readChangedPaths(path.join(repo.root, 'sub'), repo.base, repo.branch);
    expect(result).toEqual({ ok: true, files: ['out.txt', 'sub/in.txt'] });
  });
});
