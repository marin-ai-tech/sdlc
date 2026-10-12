import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B97 (0.16.2): a registry server can serve only the CLI. `agents: false` on a server of `mcp.servers` keeps it out
 * of the agents' MCP configuration (.mcp.json, opencode.json, .cursor/mcp.json, .codex/config.toml): the CLI still
 * uses it for events, verify checks and `sdlc mcp check`. Turning `agents: false` on later removes the entry sdlc had
 * written; an entry a person wrote is never touched. `agents` must be true or false. Default: true, as before.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

function project(servers: Record<string, Record<string, unknown>>) {
  const root = tempDir('sdlc-mcp-cli-only-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude,cursor', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const setServers = (value: Record<string, Record<string, unknown>>) => {
    const config = parse(read(file));
    config.mcp = { servers: value };
    write(file, stringify(config));
  };
  setServers(servers);
  const names = (rel: string): string[] => {
    const json = JSON.parse(read(path.join(root, rel)));
    return Object.keys(json.mcpServers ?? {});
  };
  return { root, cli, setServers, names };
}

const stdio = (extra: Record<string, unknown> = {}) => ({ type: 'stdio', command: ['node', FAKE], ...extra });

describe('B97: a registry server for the CLI only', () => {
  it('agents: false keeps the server out of the agents\' configuration; others are laid out as before', () => {
    const p = project({ build: stdio({ stages: ['test'] }), notify: stdio({ agents: false }) });
    const update = p.cli(['update', '--json']);
    expect(update.code, update.stdout + update.stderr).toBe(0);
    for (const rel of ['.mcp.json', '.cursor/mcp.json']) {
      expect(p.names(rel)).toContain('build');
      expect(p.names(rel)).not.toContain('notify');
    }
  }, 180000);

  it('the CLI still uses it: mcp check lists it', () => {
    const p = project({ notify: stdio({ agents: false }) });
    const r = p.cli(['mcp', 'check', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().servers.map((server: { name: string }) => server.name)).toEqual(['notify']);
  }, 180000);

  it('turning agents: false on later removes the entry sdlc wrote, and keeps a person\'s own entry', () => {
    const p = project({ build: stdio(), notify: stdio() });
    expect(p.cli(['update', '--json']).code).toBe(0);
    expect(p.names('.mcp.json')).toEqual(expect.arrayContaining(['build', 'notify']));
    const mcpFile = path.join(p.root, '.mcp.json');
    const json = JSON.parse(read(mcpFile));
    json.mcpServers.own = { command: 'node', args: ['own.js'] };
    fs.writeFileSync(mcpFile, JSON.stringify(json, null, 2));
    p.setServers({ build: stdio({ agents: false }), notify: stdio() });
    expect(p.cli(['update', '--json']).code).toBe(0);
    expect(p.names('.mcp.json')).not.toContain('build');
    expect(p.names('.mcp.json')).toEqual(expect.arrayContaining(['notify', 'own']));
  }, 180000);

  it('negative: agents must be true or false', () => {
    const p = project({ notify: stdio({ agents: 'no' }) });
    const r = p.cli(['status', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 120000);
});
