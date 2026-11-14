import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

// OpenSpec change test-paths-say-when-they-lock (E2E OpenCode 2026-11-14: P1). Every role agent listed "Test paths:"
// with no meaning; an agent read it as "agents may never edit tests" and carried that into a design. Tests lock
// only while a change has `sdlc tests lock` on (a bug fix). Where sdlc lists the paths, it says so.

function project() {
  const root = tempDir('sdlc-p1-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'opencode', '--json']).code).toBe(0);
  return { root, cli };
}

describe('P1 the test paths say when they lock', () => {
  it('P1.C1 the "This project" block of a role agent says they lock only after sdlc tests lock', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    const body = read(path.join(p.root, '.opencode/agents/sdlc-developer.md'));
    const line = body.split('\n').find((l) => l.startsWith('- Test paths')) ?? '';
    expect(line).toMatch(/tests lock/);
    expect(line).toMatch(/bug fix/i);
    // Negative: the line must not say the paths are always closed to agents.
    expect(line).not.toMatch(/always|never edit/i);
  }, 180000);

  it('P1.C2 the generated sdlc.yaml explains enforcement.test_paths', () => {
    const p = project();
    const yaml = read(path.join(p.root, 'openspec/sdlc.yaml'));
    const head = yaml.split('\nversion:')[0];
    expect(head).toMatch(/test_paths/);
    expect(head).toMatch(/tests lock/);
  }, 180000);
});
