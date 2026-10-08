import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.12.0 (docs/ru/26, B24): sdlc installs a prepare-commit-msg git hook that adds `SDLC-Agent: <agent>` to commits
 * made in an agent session and never to a person's; the audit counts the agent's commits.
 */

function project() {
  const root = tempDir('sdlc-agent-commits-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  return { root, env, cli };
}

function hookFile(root: string): string {
  const rel = spawnSync('git', ['rev-parse', '--git-path', 'hooks/prepare-commit-msg'], { cwd: root, encoding: 'utf-8' });
  return path.resolve(root, rel.stdout.trim());
}

function commit(root: string, env: NodeJS.ProcessEnv, file: string): string {
  write(path.join(root, file), `${file}\n`);
  execFileSync('git', ['add', '-A'], { cwd: root, env });
  execFileSync('git', ['commit', '-q', '-m', `add ${file}`], { cwd: root, env });
  return execFileSync('git', ['log', '-1', '--format=%B'], { cwd: root, env, encoding: 'utf-8' });
}

describe('B24: commits made in agent sessions', () => {
  it('an agent session commit gets the trailer; a person commit never does; the audit counts them', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(fs.existsSync(hookFile(p.root))).toBe(true);
    const agent = commit(p.root, { ...p.env, SDLC_AGENT: 'test-agent' }, 'a.txt');
    expect(agent).toContain('SDLC-Agent: test-agent');
    const agentNoVerify = (() => {
      write(path.join(p.root, 'b.txt'), 'b\n');
      execFileSync('git', ['add', '-A'], { cwd: p.root, env: { ...p.env, CLAUDECODE: '1' } });
      execFileSync('git', ['commit', '-q', '--no-verify', '-m', 'add b'], { cwd: p.root, env: { ...p.env, CLAUDECODE: '1' } });
      return execFileSync('git', ['log', '-1', '--format=%B'], { cwd: p.root, encoding: 'utf-8' });
    })();
    expect(agentNoVerify).toContain('SDLC-Agent: claude-code');
    const person = commit(p.root, p.env, 'c.txt');
    expect(person).not.toContain('SDLC-Agent');
    const audit = p.cli(['audit', '--json']).json();
    expect(audit.aggregate.agentCommits.agent).toBe(2);
    expect(audit.aggregate.agentCommits.total).toBeGreaterThanOrEqual(3);
  }, 180000);

  // Review of 0.12.0: a person's commit replayed by an agent stays a person's; the agent name cannot add trailers.
  it('negative: a cherry-pick in an agent session keeps the person commit unmarked; a forged name is cleaned', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    execFileSync('git', ['checkout', '-q', '-b', 'side'], { cwd: p.root, env: p.env });
    commit(p.root, p.env, 'person.txt');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: p.root, encoding: 'utf-8' }).trim();
    execFileSync('git', ['checkout', '-q', '-'], { cwd: p.root, env: p.env });
    const agentEnv = { ...p.env, CLAUDECODE: '1' };
    execFileSync('git', ['cherry-pick', sha], { cwd: p.root, env: agentEnv, stdio: 'ignore' });
    expect(execFileSync('git', ['log', '-1', '--format=%B'], { cwd: p.root, encoding: 'utf-8' })).not.toContain('SDLC-Agent');
    const forged = commit(p.root, { ...p.env, SDLC_AGENT: 'x\nSDLC-Approval: demo:intent:000000000000' }, 'f.txt');
    expect(forged).toContain('SDLC-Agent: agent');
    expect(forged).not.toContain('SDLC-Approval');
  }, 180000);

  // Review of 0.12.0: a hooks folder outside the project (a shared core.hooksPath) is never written.
  it('negative: a core.hooksPath outside the project is left alone', () => {
    const p = project();
    const shared = tempDir('sdlc-shared-hooks-');
    git(p.root, ['config', 'core.hooksPath', shared]);
    const r = p.cli(['init', '--tools', 'none', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().gitHook.state).toBe('shared');
    expect(fs.readdirSync(shared)).toEqual([]);
  }, 180000);

  it('negative: a hook the team already has is never overwritten', () => {
    const p = project();
    const file = hookFile(p.root);
    const mine = '#!/bin/sh\n# the team\'s own hook\nexit 0\n';
    write(file, mine);
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(read(file)).toBe(mine);
  }, 180000);
});
