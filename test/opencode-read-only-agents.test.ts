import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

// OpenSpec change read-only-agents-on-opencode-run-headless (E2E OpenCode 2026-11-14: P3).
// A read-only subagent on OpenCode had `bash: {"*": ask, ...}`: in a headless run every other command (echo, node)
// was rejected and the whole subagent task failed, so no review pass ran in a fresh context. Owner's choice: the
// same access as Claude Code's read-only agents - no edits, any shell command, no web fetch; writes through the
// shell meet the sdlc plugin's checks.

function frontMatter(root: string, name: string): string {
  const text = read(path.join(root, '.opencode/agents', `${name}.md`));
  return text.split('\n---')[0];
}

function project() {
  const root = tempDir('sdlc-p3-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'opencode', '--json']).code).toBe(0);
  return { root, cli };
}

const READ_ONLY = ['  edit: deny', '  bash: allow', '  webfetch: deny'];

describe('P3.C1 built-in read-only subagents run any shell command', () => {
  it.each(['sdlc-reviewer', 'sdlc-researcher', 'sdlc-health', 'sdlc-advocate'])('%s', (name) => {
    const head = frontMatter(project().root, name);
    for (const line of READ_ONLY) expect(head).toContain(line);
    expect(head).not.toContain('"*": ask');
  }, 180000);
});

describe('P3.C2 an accepted read-only role runs any shell command', () => {
  it('the reviewer role', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const accepted = p.cli(['team', 'accept', 'reviewer', '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    const head = frontMatter(p.root, 'sdlc-reviewer');
    for (const line of READ_ONLY) expect(head).toContain(line);
    expect(head).not.toContain('"*": ask');
  }, 180000);
});

describe('P3.C3 negative: other access stays as it is', () => {
  it('a writer still edits, the verifier still runs checks without edits', () => {
    const root = project().root;
    expect(frontMatter(root, 'sdlc-simplifier')).toContain('  edit: allow');
    const verifier = frontMatter(root, 'sdlc-verifier');
    for (const line of READ_ONLY) expect(verifier).toContain(line);
  }, 180000);
});
