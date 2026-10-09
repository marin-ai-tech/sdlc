import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentCommits } from '../src/core/agent-commits.js';
import { CHAIN_LINE, HOOK_MARKER, renderGitHook } from '../src/integrations/git-hook.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.12.0 (B24): who owns the prepare-commit-msg hook. sdlc writes, rewrites and removes only its own (the marker
 * line), follows core.hooksPath, does nothing outside a git repository, and a failure to install never fails init.
 */

function project(options: { git?: boolean } = {}) {
  const root = tempDir('sdlc-git-hook-');
  const env = humanEnv(tempDir('sdlc-home-'));
  if (options.git !== false) {
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  }
  const cli = (args: string[]) => runCli(args, root, env);
  return { root, env, cli };
}

function commit(root: string, env: NodeJS.ProcessEnv, message: string): string {
  const file = `f-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
  write(path.join(root, file), 'x\n');
  execFileSync('git', ['add', '-A'], { cwd: root, env });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: root, env });
  return execFileSync('git', ['log', '-1', '--format=%B'], { cwd: root, env, encoding: 'utf-8' });
}

const FOREIGN = '#!/bin/sh\n# the team\'s own hook\nexit 0\n';

describe('B24: the prepare-commit-msg hook', () => {
  it('follows core.hooksPath; update rewrites only a changed sdlc hook; uninstall removes it', () => {
    const p = project();
    git(p.root, ['config', 'core.hooksPath', '.githooks']);
    const init = p.cli(['init', '--tools', 'none', '--json']);
    expect(init.code, init.stderr).toBe(0);
    const hook = path.join(p.root, '.githooks', 'prepare-commit-msg');
    expect(init.json().gitHook).toEqual({ state: 'installed', path: '.githooks/prepare-commit-msg' });
    expect(read(hook)).toBe(renderGitHook());
    expect(fs.existsSync(path.join(p.root, '.git', 'hooks', 'prepare-commit-msg'))).toBe(false);
    expect(commit(p.root, { ...p.env, SDLC_AGENT: 'bot' }, 'by the bot')).toContain('SDLC-Agent: bot');
    expect(p.cli(['update', '--json']).json().gitHook.state).toBe('unchanged');
    write(hook, `#!/bin/sh\n${HOOK_MARKER}\nexit 0\n`);
    expect(p.cli(['update', '--json']).json().gitHook.state).toBe('updated');
    expect(read(hook)).toBe(renderGitHook());
    const removed = p.cli(['uninstall', '--json']);
    expect(removed.code, removed.stderr).toBe(0);
    expect(removed.json().gitHook.state).toBe('removed');
    expect(fs.existsSync(hook)).toBe(false);
  }, 240000);

  it('negative: a hook of the project\'s own survives init, update and uninstall; doctor says how to chain', () => {
    const p = project();
    const hook = path.join(p.root, '.git', 'hooks', 'prepare-commit-msg');
    write(hook, FOREIGN);
    const init = p.cli(['init', '--tools', 'none']);
    expect(init.code, init.stderr).toBe(0);
    expect(init.stderr).toMatch(/not sdlc's hook/);
    expect(p.cli(['update', '--json']).json().gitHook.state).toBe('kept');
    expect(read(hook)).toBe(FOREIGN);
    expect(read(`${hook}.sdlc`)).toBe(renderGitHook());
    expect(commit(p.root, { ...p.env, CLAUDECODE: '1' }, 'not chained yet')).not.toContain('SDLC-Agent');
    const warned = p.cli(['doctor', '--json']).json().checks.find((c: { check: string }) => c.check === 'git hook');
    expect(warned).toMatchObject({ status: 'warn' });
    expect(warned.fix).toContain(CHAIN_LINE);
    write(hook, `#!/bin/sh\n# the team's own hook\n${CHAIN_LINE}\nexit 0\n`);
    // A team's own hook is executable, or git never runs it (Linux ignores a hook without the bit).
    fs.chmodSync(hook, 0o755);
    expect(commit(p.root, { ...p.env, CLAUDECODE: '1' }, 'chained')).toContain('SDLC-Agent: claude-code');
    const chained = p.cli(['doctor', '--json']).json().checks.find((c: { check: string }) => c.check === 'git hook');
    expect(chained).toMatchObject({ status: 'ok' });
    expect(p.cli(['uninstall', '--json']).json().gitHook.state).toBe('kept');
    expect(read(hook)).toContain('# the team\'s own hook');
    expect(fs.existsSync(`${hook}.sdlc`)).toBe(false);
  }, 240000);

  it('outside a git repository init writes no hook and no .git; a failed install only warns', () => {
    const outside = project({ git: false });
    const init = outside.cli(['init', '--tools', 'none', '--json']);
    expect(init.code, init.stderr).toBe(0);
    expect(init.json().gitHook).toEqual({ state: 'absent' });
    expect(fs.existsSync(path.join(outside.root, '.git'))).toBe(false);
    const broken = project();
    write(path.join(broken.root, 'not-a-dir'), 'a file\n');
    git(broken.root, ['config', 'core.hooksPath', 'not-a-dir/hooks']);
    const failed = broken.cli(['init', '--tools', 'none']);
    expect(failed.code, failed.stderr).toBe(0);
    expect(failed.stderr).toMatch(/git hook prepare-commit-msg:/);
    expect(fs.existsSync(path.join(broken.root, 'openspec', 'sdlc.yaml'))).toBe(true);
  }, 240000);

  it('a message that names its agent keeps it; the counts follow --since and the dashboard shows the share', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const own = commit(p.root, { ...p.env, CLAUDECODE: '1' }, 'pairing\n\nSDLC-Agent: pair-session');
    expect(own.match(/SDLC-Agent:/g)).toHaveLength(1);
    expect(commit(p.root, p.env, 'by a person')).not.toContain('SDLC-Agent');
    expect(agentCommits(p.root)).toEqual({ total: 3, agent: 1 });
    expect(agentCommits(p.root, '2999-01-01')).toEqual({ total: 0, agent: 0 });
    expect(agentCommits(tempDir('sdlc-no-git-'))).toEqual({ total: 0, agent: 0 });
    const audit = p.cli(['audit']);
    expect(audit.stdout).toMatch(/agent commits: 1 of 3/);
    const report = p.cli(['report', '--json']).json();
    expect(report.metrics.agentCommits).toEqual({ total: 3, agent: 1 });
    const html = path.join(p.root, 'dashboard.html');
    expect(p.cli(['dashboard', '--out', html]).code).toBe(0);
    expect(read(html)).toMatch(/Agent commits<\/span><strong>33% \(1\/3\)/);
  }, 240000);
});
