import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/** After an AI-ready worktree build the main copy has no sdlc: the output leads with the worktree, not with hints
 * that read as if sdlc were installed here. */
describe('init output after an AI-ready worktree build', () => {
  it('leads with the worktree; start hints, if any, come after it and point into the worktree', () => {
    const root = tempDir('sdlc-wt-hints-');
    initGitRepo(root);
    write(path.join(root, 'ARCHITECTURE.md'), '# Architecture\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'existing']);
    const target = path.join(tempDir('sdlc-wt-hints-target-'), 'ai-ready');
    const r = runCli(['init', '--tools', 'opencode', '--layout', 'worktree', '--worktree', target], root,
      humanEnv(tempDir('sdlc-home-')));
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const out = r.stdout;
    const built = out.indexOf('AI-ready project built in a new worktree');
    expect(built, out).toBeGreaterThanOrEqual(0);
    for (const hint of ['Start a change', '/sdlc-intent', '/sdlc-adopt']) {
      const at = out.indexOf(hint);
      if (at >= 0) expect(at, `${hint} comes after the worktree block`).toBeGreaterThan(built);
    }
    expect(out.slice(0, built)).not.toMatch(/sdlc-intent|sdlc-adopt|Start a change/);
  }, 180000);
});
