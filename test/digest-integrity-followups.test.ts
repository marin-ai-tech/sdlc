import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { listActiveChanges } from '../src/core/changes.js';
import { evaluateChange } from '../src/core/lifecycle.js';
import { provenanceComment, type HarnessStamp } from '../src/core/license.js';
import { projectPaths } from '../src/core/project.js';
import { stampArtifacts, tryStampArtifacts } from '../src/core/stamp.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B126 plan follow-ups (close-the-digest-integrity-review-findings), existing requirements with no test of their own:
 * - without a repository there is no worktree fingerprint, so review and release have no digest;
 * - stamping rechecks the approval's digest before each file it rewrites and stops at the first drift.
 */

const STAMP: HarnessStamp = { tool: 'sdlc', version: '0.27.0', license: 'community' };

function project(withGit: boolean) {
  const root = tempDir('sdlc-followups-');
  const env = humanEnv(tempDir('sdlc-home-'));
  if (withGit) {
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  }
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  const file = path.join(root, 'openspec', 'sdlc.yaml');
  write(file, read(file).replace(/release:\n {4}required: false/, 'release:\n    required: true'));
  expect(runCli(['new', 'demo', '--json'], root, env).code).toBe(0);
  write(path.join(root, 'openspec', 'changes', 'demo', 'review.md'), '# Review\n\nNo findings.\n');
  const paths = projectPaths(root);
  const config = loadConfig(paths.sdlcConfig);
  const ref = listActiveChanges(paths).find((item) => item.id === 'demo')!;
  return { root, config, ref };
}

function codeDigests(withGit: boolean): Record<string, string | undefined> {
  const p = project(withGit);
  expect(p.config.gates.release.required).toBe(true);
  const view = evaluateChange(p.root, p.ref, p.config);
  const digestOf = (id: string) => {
    const gate = view.gates.find((item) => item.id === id);
    expect(gate, id).toBeDefined();
    return gate!.digest;
  };
  return { review: digestOf('review'), release: digestOf('release') };
}

describe('B126 follow-up: no code digest without git', () => {
  it('review and release have no digest in a project without git', () => {
    expect(codeDigests(false)).toEqual({ review: undefined, release: undefined });
  }, 120000);

  it('negative: the same project in a git repository has both digests', () => {
    const digests = codeDigests(true);
    expect(digests.review).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digests.release).toMatch(/^sha256:[0-9a-f]{64}$/);
  }, 120000);
});

describe('B126 follow-up: stamping rechecks the digest', () => {
  function changeDir(): string {
    const dir = tempDir('sdlc-stamp-recheck-');
    for (const name of ['a.md', 'b.md', 'c.md']) write(path.join(dir, name), `# ${name}\n\nBody.\n`);
    return dir;
  }

  it('rechecks the digest before each stamp write and stops at the first drift', () => {
    const dir = changeDir();
    const before = Object.fromEntries(['a.md', 'b.md', 'c.md'].map((name) => [name, read(path.join(dir, name))]));
    const events: string[] = [];
    const recheck = () => {
      events.push(`check:${['a.md', 'b.md', 'c.md'].filter((n) => read(path.join(dir, n)) !== before[n]).length}`);
      if (events.length === 2) throw new Error('digest_changed');
    };
    const result = tryStampArtifacts(dir, ['c.md', 'a.md', 'b.md'], STAMP, recheck);
    expect(result.error).toMatch(/digest_changed/);
    // The first check ran before any write; the second ran after exactly one write and refused.
    expect(events).toEqual(['check:0', 'check:1']);
    expect(read(path.join(dir, 'a.md'))).toContain(provenanceComment(STAMP));
    // Negative: nothing after the drift is stamped.
    expect(read(path.join(dir, 'b.md'))).toBe(before['b.md']);
    expect(read(path.join(dir, 'c.md'))).toBe(before['c.md']);
  });

  it('negative: files already stamped are not rewritten and need no recheck', () => {
    const dir = changeDir();
    let checks = 0;
    expect(stampArtifacts(dir, ['a.md', 'b.md', 'c.md'], STAMP, () => { checks += 1; }))
      .toEqual(['a.md', 'b.md', 'c.md']);
    expect(checks).toBe(3);
    expect(stampArtifacts(dir, ['a.md', 'b.md', 'c.md'], STAMP, () => { checks += 1; })).toEqual([]);
    expect(checks).toBe(3);
  });
});
