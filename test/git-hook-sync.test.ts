import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentEnvironment } from '../src/core/agent-env.js';
import { AGENT_MARKERS } from '../src/core/policy-markers.js';
import { installGitHook, renderGitHook } from '../src/integrations/git-hook.js';
import { humanEnv, initGitRepo, REPO_ROOT, tempDir, write } from './helpers.js';

/**
 * B24: the prepare-commit-msg hook is sh and cannot call agentEnvironment(), so it repeats the markers of
 * src/core/agent-env.ts. These tests keep the two lists the same: the same variables in the same order, and the same
 * agent named for every marker and every precedence case.
 */

/** Names captured by `pattern` in the order they first appear in `text`. */
function firstSeen(text: string, pattern: RegExp): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(pattern)) {
    if (!names.includes(match[1])) names.push(match[1]);
  }
  return names;
}

function commit(root: string, env: NodeJS.ProcessEnv, file: string): string {
  write(path.join(root, file), `${file}\n`);
  execFileSync('git', ['add', '-A'], { cwd: root, env });
  execFileSync('git', ['commit', '-q', '-m', `add ${file}`], { cwd: root, env });
  return execFileSync('git', ['log', '-1', '--format=%B'], { cwd: root, env, encoding: 'utf-8' });
}

const CASES: Array<Record<string, string>> = [
  { SDLC_AGENT: 'my-agent' },
  { CLAUDECODE: '1' },
  { OPENCODE: '1' },
  { AGENT: '1' },
  { SDLC_AGENT: 'first', CLAUDECODE: '1', OPENCODE: '1', AGENT: '1' },
  { CLAUDECODE: '1', OPENCODE: '1', AGENT: '1' },
  { OPENCODE: '1', AGENT: '1' },
  { SDLC_AGENT: '', CLAUDECODE: '0', OPENCODE: 'yes', AGENT: '2' },
  {},
];

describe('B24: the git hook and agent-env.ts check the same markers', () => {
  it('the same variables in the same order', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'core', 'agent-env.ts'), 'utf-8');
    const fromSource = firstSeen(source, /\benv\.([A-Z_]+)/g);
    const fromHook = firstSeen(renderGitHook(), /\$\{([A-Z_]+):-\}/g);
    // 0.13.0 adds cursor: CURSOR_AGENT is checked last (B80).
    expect(fromSource).toEqual(['SDLC_AGENT', 'CLAUDECODE', 'OPENCODE', 'AGENT', 'CURSOR_AGENT']);
    expect(fromHook).toEqual(fromSource);
  });

  // Review of 0.13.0: the agent-marker rule must know every marker agent-env.ts reads, or clearing one passes.
  it('the agent-marker rule covers the same markers', () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, 'src', 'core', 'agent-env.ts'), 'utf-8');
    const fromSource = firstSeen(source, /\benv\.([A-Z_]+)/g);
    expect([...AGENT_MARKERS].sort()).toEqual([...fromSource].sort());
  });

  it('the hook names the agent agentEnvironment() names, and none where it names none', () => {
    const root = tempDir('sdlc-hook-sync-');
    initGitRepo(root);
    expect(installGitHook(root).state).toBe('installed');
    const person = humanEnv(tempDir('sdlc-home-'));
    for (const [index, markers] of CASES.entries()) {
      const message = commit(root, { ...person, ...markers }, `f${index}.txt`);
      const trailer = /^SDLC-Agent: (.*)$/m.exec(message)?.[1];
      expect(trailer, JSON.stringify(markers)).toBe(agentEnvironment(markers));
    }
  }, 120000);

  it('negative: the script has LF line endings and no byte-order mark', () => {
    const script = renderGitHook();
    expect(script.startsWith('#!/bin/sh\n')).toBe(true);
    expect(script).not.toContain('\r');
    expect(script.charCodeAt(0)).not.toBe(0xfeff);
  });
});
