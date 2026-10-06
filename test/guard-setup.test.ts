import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { humanEnv, read, runCli, tempDir } from './helpers.js';

/**
 * B41, the CLI side: inside an agent session `sdlc init` and `sdlc update` still write the guard's files (they
 * restore what the project configured), but they refuse what would weaken the guard: a lower enforcement mode, fewer
 * tools, no hooks, another CLI prefix in the hooks. `sdlc uninstall` is a person's decision.
 */

const AGENT = { CLAUDECODE: '1' };

function project() {
  const root = tempDir('sdlc-guard-setup-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude,opencode', '--mode', 'block', '--json']).code).toBe(0);
  const config = () => parse(read(path.join(root, 'openspec/sdlc.yaml')));
  const exists = (file: string) => fs.existsSync(path.join(root, file));
  return { root, cli, config, exists };
}

function refused(r: ReturnType<typeof runCli>): void {
  expect(r.code, r.stdout + r.stderr).not.toBe(0);
  expect(r.stdout + r.stderr).toContain('agent_cannot_weaken_guard');
}

describe('setup commands run by an agent', () => {
  it('refuse a lower enforcement mode', () => {
    const p = project();
    refused(p.cli(['init', '--mode', 'off', '--json'], AGENT));
    refused(p.cli(['init', '--mode', 'warn', '--json'], AGENT));
    expect(p.config().enforcement.mode).toBe('block');
  }, 120000);

  it('refuse dropping a tool or the hooks', () => {
    const p = project();
    refused(p.cli(['init', '--tools', 'none', '--json'], AGENT));
    refused(p.cli(['update', '--tools', 'claude', '--json'], AGENT));
    refused(p.cli(['init', '--no-hooks', '--json'], AGENT));
    expect(p.config().tools).toEqual(['claude', 'opencode']);
    expect(p.exists('.opencode/plugins/sdlc.js')).toBe(true);
    expect(read(path.join(p.root, '.claude/settings.json'))).toContain('hook pre-tool');
  }, 120000);

  it('refuse another CLI prefix, which the hooks would call instead of sdlc', () => {
    const p = project();
    refused(p.cli(['init', '--cli', 'true', '--json'], AGENT));
    expect(p.config().cli).toBe('sdlc');
  }, 120000);

  it('refuse uninstall, which is a person\'s decision', () => {
    const p = project();
    const r = p.cli(['uninstall', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('agent_cannot_approve');
    expect(p.exists('.opencode/plugins/sdlc.js')).toBe(true);
  }, 120000);

  it('negative: restoring and strengthening stay open to the agent; a person may weaken', () => {
    const p = project();
    fs.rmSync(path.join(p.root, '.opencode/plugins/sdlc.js'));
    expect(p.cli(['update', '--json'], AGENT).code).toBe(0);
    expect(p.exists('.opencode/plugins/sdlc.js')).toBe(true);
    expect(p.cli(['init', '--json'], AGENT).code).toBe(0);
    expect(p.cli(['init', '--mode', 'block', '--tools', 'claude,opencode', '--json'], AGENT).code).toBe(0);
    expect(p.cli(['init', '--mode', 'warn', '--json']).code).toBe(0);
    expect(p.config().enforcement.mode).toBe('warn');
    expect(p.cli(['init', '--mode', 'block', '--json'], AGENT).code).toBe(0);
    expect(p.config().enforcement.mode).toBe('block');
    expect(p.cli(['uninstall', '--json']).code).toBe(0);
  }, 180000);
});

describe('the hook', () => {
  it('denies an agent shell running sdlc uninstall', () => {
    const p = project();
    const input = JSON.stringify({ cwd: p.root, tool_name: 'Bash', tool_input: { command: 'sdlc uninstall --force' } });
    const r = runCli(['hook', 'pre-tool'], p.root, humanEnv(tempDir('sdlc-home-')), input);
    expect(r.stdout).toContain('"permissionDecision":"deny"');
    expect(r.stdout).toContain('separation-of-duties');
  }, 120000);
});
