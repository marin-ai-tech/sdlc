import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * The second half of the 0.9.0 integration: sdlc calls other MCP servers.
 * - B10: the team's registry (`mcp.servers` in openspec/sdlc.yaml) is laid out into `.mcp.json` (Claude Code) and
 *   `opencode.json` (OpenCode); secrets only as `${VAR}` references, a literal secret is a configuration error.
 * - B11: `sdlc mcp check` connects to each server and lists its tools; it flags servers that can write files.
 * - B12: `verify.mcp` checks are called by the CLI itself during `sdlc verify`; the result must match `expect`.
 *   Inside an agent session the result goes back in the command's answer; outside one it is also kept for the agent
 *   in the inbox (`sdlc inbox`), which the next agent session sees.
 * Sample secrets are assembled at run time.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const GITHUB = ['gh', 'p_', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('');
const AGENT = { CLAUDECODE: '1' };

const SERVERS = {
  build: { type: 'stdio', command: ['node', FAKE], env: { CI_TOKEN: '${CI_TOKEN}' }, stages: ['build', 'test'] },
  jira: {
    type: 'http', url: 'https://mcp.corp.example/jira', headers: { Authorization: 'Bearer ${JIRA_TOKEN}' },
    stages: ['plan', 'deploy'],
  },
};
const CI_GREEN = {
  name: 'ci-green', server: 'build', tool: 'pipeline_status', args: { ref: '${HEAD}' }, expect: { status: 'success' },
};

function project(options: { servers?: Record<string, unknown>; checks?: unknown[] } = {}) {
  const root = tempDir('sdlc-mcp-client-');
  const env = humanEnv(tempDir('sdlc-home-'), { CI_TOKEN: 'ci-123' });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude,opencode', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: options.servers ?? SERVERS };
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  if (options.checks) config.verify.mcp = options.checks;
  write(file, stringify(config));
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-export/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
  const json = (rel: string) => JSON.parse(read(path.join(root, rel)));
  return { root, cli, json, file };
}

describe('B10: the MCP registry in the tools\' configuration', () => {
  it('lays out every server for Claude Code and OpenCode, with references kept as references', () => {
    const p = project();
    expect(p.cli(['update', '--json']).code).toBe(0);
    const claude = p.json('.mcp.json').mcpServers;
    expect(claude.build).toEqual({ type: 'stdio', command: 'node', args: [FAKE], env: { CI_TOKEN: '${CI_TOKEN}' } });
    expect(claude.jira).toEqual({
      type: 'http', url: 'https://mcp.corp.example/jira', headers: { Authorization: 'Bearer ${JIRA_TOKEN}' },
    });
    const opencode = p.json('opencode.json').mcp;
    expect(opencode.build).toEqual({
      type: 'local', command: ['node', FAKE], environment: { CI_TOKEN: '{env:CI_TOKEN}' }, enabled: true,
    });
    expect(opencode.jira).toEqual({
      type: 'remote', url: 'https://mcp.corp.example/jira', headers: { Authorization: 'Bearer {env:JIRA_TOKEN}' },
      enabled: true,
    });
  }, 120000);

  it('removes a server dropped from the registry, and keeps servers sdlc did not write', () => {
    const p = project();
    expect(p.cli(['update', '--json']).code).toBe(0);
    const claude = p.json('.mcp.json');
    claude.mcpServers.mine = { type: 'stdio', command: 'my-server' };
    write(path.join(p.root, '.mcp.json'), JSON.stringify(claude, null, 2));
    const config = parse(read(p.file));
    delete config.mcp.servers.jira;
    write(p.file, stringify(config));
    expect(p.cli(['update', '--json']).code).toBe(0);
    expect(Object.keys(p.json('.mcp.json').mcpServers).sort()).toEqual(['build', 'mine']);
    expect(Object.keys(p.json('opencode.json').mcp).sort()).toEqual(['build']);
  }, 120000);

  it('refuses a literal secret in the registry and writes nothing', () => {
    const servers = { jira: { ...SERVERS.jira, headers: { Authorization: `Bearer ${GITHUB}` } } };
    const p = project({ servers });
    const r = p.cli(['update', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('mcp_secret_literal');
    expect(r.stdout + r.stderr).not.toContain(GITHUB);
    expect(fs.existsSync(path.join(p.root, '.mcp.json'))).toBe(false);
  }, 120000);
});

describe('B11: sdlc mcp check', () => {
  it('lists the tools of the servers it reaches and marks the others unavailable', () => {
    const p = project();
    const r = p.cli(['mcp', 'check', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const byName = Object.fromEntries(r.json().servers.map((s: { name: string }) => [s.name, s]));
    expect(byName.build).toMatchObject({ available: true, tools: ['pipeline_status'], warnings: [] });
    expect(byName.jira.available).toBe(false);
    expect(byName.jira.error).toBeTruthy();
  }, 120000);

  it('warns about a server that can write files', () => {
    const p = project({ servers: { build: SERVERS.build } });
    const r = p.cli(['mcp', 'check', '--json'], { FAKE_FILES: '1' });
    const build = r.json().servers[0];
    expect(build.tools).toEqual(['pipeline_status', 'write_file']);
    expect(build.warnings).toEqual([expect.stringMatching(/write_file/)]);
  }, 120000);
});

describe('B12: verify.mcp checks called by the CLI', () => {
  it('passes when the answer matches expect, with ${HEAD} and the server\'s env expanded', () => {
    const p = project({ servers: { build: SERVERS.build }, checks: [CI_GREEN] });
    const r = p.cli(['verify', '--change', 'add-export', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const out = r.json();
    expect(out.status).toBe('passed');
    const head = gitHead(p.root);
    expect(out.mcp).toEqual([expect.objectContaining({
      name: 'ci-green', server: 'build', tool: 'pipeline_status', ok: true,
      result: { status: 'success', ref: head, token: 'present' },
    })]);
  }, 120000);

  it('fails the verification on a mismatch or an unreachable server, with the reason', () => {
    const p = project({ servers: { build: SERVERS.build }, checks: [CI_GREEN] });
    const red = p.cli(['verify', '--change', 'add-export', '--json'], { ...AGENT, FAKE_STATUS: 'failed' });
    expect(red.json().status).toBe('failed');
    expect(red.json().mcp[0]).toMatchObject({ name: 'ci-green', ok: false });
    expect(red.json().mcp[0].reason).toMatch(/status/);
    const down = p.cli(['verify', '--change', 'add-export', '--json'], { ...AGENT, FAKE_EXIT: '1' });
    expect(down.json().status).toBe('failed');
    expect(down.json().mcp[0].ok).toBe(false);
    const gate = p.cli(['status', '--change', 'add-export', '--json']).json().change.gates
      .find((g: { id: string }) => g.id === 'verify');
    expect(gate.status).not.toBe('passed');
  }, 180000);
});

describe('the inbox: results for the agent from outside its session', () => {
  it('keeps a person\'s run for the agent; the next session sees it until the agent marks it done', () => {
    const p = project({ servers: { build: SERVERS.build }, checks: [CI_GREEN] });
    expect(p.cli(['verify', '--change', 'add-export', '--json'], { FAKE_STATUS: 'failed' }).code).not.toBe(0);
    const list = p.cli(['inbox', 'list', '--json'], AGENT).json();
    expect(list.items).toEqual([expect.objectContaining({
      change: 'add-export', check: 'ci-green', server: 'build', ok: false, done: false,
    })]);
    const id = list.items[0].id;
    const session = () => runCli(['hook', 'session-start'], p.root, humanEnv(tempDir('sdlc-home-')),
      JSON.stringify({ cwd: p.root, source: 'startup' })).stdout;
    expect(session()).toContain('ci-green');
    expect(p.cli(['inbox', 'done', id, '--json'], AGENT).code).toBe(0);
    expect(p.cli(['inbox', 'list', '--json'], AGENT).json().items.filter((i: { done: boolean }) => !i.done))
      .toEqual([]);
    expect(session()).not.toContain('ci-green');
  }, 180000);

  it('negative: an agent\'s own run gets the result in its answer and adds nothing to the inbox', () => {
    const p = project({ servers: { build: SERVERS.build }, checks: [CI_GREEN] });
    expect(p.cli(['verify', '--change', 'add-export', '--json'], AGENT).json().mcp[0].ok).toBe(true);
    expect(p.cli(['inbox', 'list', '--json'], AGENT).json().items).toEqual([]);
  }, 120000);
});

function gitHead(root: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).trim();
}
