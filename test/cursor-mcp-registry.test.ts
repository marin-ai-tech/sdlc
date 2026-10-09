import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.13.1 (B81): `sdlc update` lays the team's MCP registry (`mcp.servers`) out for Cursor too, in `.cursor/mcp.json`:
 * stdio `{ command, args, env }`, http `{ url, headers }`, secrets as Cursor's `${env:VAR}`. A server a person added by
 * hand stays; a project without Cursor gets no `.cursor/mcp.json`.
 */

const SERVERS = {
  build: { type: 'stdio', command: ['npx', '-y', 'corp-build-mcp'], env: { CI_TOKEN: '${CI_TOKEN}' }, stages: ['build'] },
  jira: { type: 'http', url: 'https://mcp.corp.example/jira', headers: { Authorization: 'Bearer ${JIRA_TOKEN}' },
    stages: ['plan'] },
};

function project(tools: string) {
  const root = tempDir('sdlc-cursor-mcp-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--mcp', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { ...(config.mcp ?? {}), servers: SERVERS };
  write(file, stringify(config));
  const update = () => {
    const r = cli(['update', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  };
  return { root, update, mcp: path.join(root, '.cursor/mcp.json') };
}

describe('B81: the team MCP registry in Cursor', () => {
  it('sdlc update writes the stdio and http servers into .cursor/mcp.json, next to sdlc', () => {
    const p = project('cursor');
    p.update();
    const servers = JSON.parse(read(p.mcp)).mcpServers;
    expect(servers.sdlc).toBeDefined();
    expect(servers.build).toEqual({ command: 'npx', args: ['-y', 'corp-build-mcp'], env: { CI_TOKEN: '${env:CI_TOKEN}' } });
    expect(servers.jira).toEqual({ url: 'https://mcp.corp.example/jira',
      headers: { Authorization: 'Bearer ${env:JIRA_TOKEN}' } });
  }, 180000);

  it('negative: a server added by hand stays; a project without Cursor gets no .cursor/mcp.json', () => {
    const p = project('cursor');
    const mine = JSON.parse(read(p.mcp));
    mine.mcpServers.local = { command: 'my-tool', args: [] };
    write(p.mcp, JSON.stringify(mine, null, 2));
    p.update();
    expect(JSON.parse(read(p.mcp)).mcpServers.local).toEqual({ command: 'my-tool', args: [] });
    const claude = project('claude');
    claude.update();
    expect(fs.existsSync(claude.mcp)).toBe(false);
  }, 240000);
});
