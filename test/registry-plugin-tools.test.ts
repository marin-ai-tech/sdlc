import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// OpenSpec change skillforge-plugin-is-the-team-registry (B315). SkillForge serves the role tools only while its
// sdlc-registry plugin is on. A registry that answers without list_roles and get_role is refused with exit 1 and a
// hint about the plugin, and nothing is written; a registry that does not answer keeps the fallback to the built-ins.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const FAKE_HTTP = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-http-registry.mjs');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const BODY = '# Role: team analyst\n\nWrite requirements the corporate way.\n{{artifacts}}\n{{project}}\n';
const ELICIT = [{ path: 'SKILL.md', content: '---\nname: requirements-elicitation\ndescription: Ask\n---\nAsk.\n' }];
const ROLES = [
  'version: 1', 'signing: off', 'people:', '  pat: { name: Pat Owner, emails: [pat@example.com] }',
  'roles:', '  product-owner: [pat]', '  engineer: [pat]', '  code-owner: [pat]', '  maintainer: [pat]', '',
].join('\n');
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function registryData(extra: Record<string, unknown> = {}) {
  const files = ELICIT.map((f) => `${f.path}\n${f.content}\n`).join('');
  return {
    roles: [{
      id: 'analyst', version: '1.0.0', title: 'Team analyst', stages: ['plan', 'design'],
      tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false,
      skills: ['requirements-elicitation'], body: BODY, checksum: sha(BODY),
    }],
    skills: [{
      id: 'requirements-elicitation', version: '1.0.0', title: 'Elicitation', files: ELICIT, checksum: sha(files),
    }],
    ...extra,
  };
}

function project(servers: Record<string, unknown>, extraEnv: NodeJS.ProcessEnv = {}, data = registryData()) {
  const root = tempDir('sdlc-b315-');
  const file = path.join(tempDir('sdlc-b315-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file, ...extraEnv });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude,opencode,codex', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers };
  config.team = { registry: Object.keys(servers)[0] };
  write(sdlc, stringify(config));
  const at = (rel: string) => path.join(root, rel);
  const serve = (next: unknown) => fs.writeFileSync(file, JSON.stringify(next));
  return { root, cli, at, serve, sdlc };
}

const stdio = { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } };
const teamJson = 'openspec/.sdlc/team.json';
const snapshot = (at: (rel: string) => string) => (fs.existsSync(at(teamJson)) ? read(at(teamJson)) : null);

describe('B315.C1 the plugin is off', () => {
  it('team sync exits 1, names the missing tools, the server and the plugin, and writes nothing', () => {
    const p = project(stdio, {}, registryData({ noRoleTools: true }));
    const before = snapshot(p.at);
    const r = p.cli(['team', 'sync']);
    const out = r.stdout + r.stderr;
    expect(r.code, out).toBe(1);
    expect(out).toMatch(/list_roles/);
    expect(out).toMatch(/get_role/);
    expect(out).toMatch(/\broles\b/);
    expect(out).toMatch(/sdlc-registry/);
    expect(out).toMatch(/\/admin\/plugins/);
    expect(snapshot(p.at)).toBe(before);
    expect(fs.existsSync(p.at('docs/agents/drafts'))).toBe(false);
  }, 180000);

  it('team accept and team check are refused the same way; accept writes no role', () => {
    const p = project(stdio);
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const before = snapshot(p.at);
    p.serve(registryData({ noRoleTools: true }));
    const accept = p.cli(['team', 'accept', 'analyst']);
    expect(accept.code, accept.stdout + accept.stderr).toBe(1);
    expect(accept.stdout + accept.stderr).toMatch(/sdlc-registry/);
    expect(fs.existsSync(p.at('docs/agents/analyst.md'))).toBe(false);
    expect(snapshot(p.at)).toBe(before);
    const check = p.cli(['team', 'check', '--json']);
    expect(check.code, check.stdout + check.stderr).toBe(1);
    expect(check.stdout).toMatch(/sdlc-registry/);
  }, 240000);
});

describe('B315 review F5: a server with no tool list at all is not a registry either', () => {
  it('team sync exits 1 and writes nothing when tools/list answers method not found', () => {
    const p = project(stdio, {}, registryData({ noToolsHandler: true }));
    const r = p.cli(['team', 'sync']);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout + r.stderr).toMatch(/list_roles, get_role/);
    expect(fs.existsSync(p.at('docs/agents/drafts'))).toBe(false);
  }, 180000);

  it('the JSON answer carries the refusal code', () => {
    const p = project(stdio, {}, registryData({ noRoleTools: true }));
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('registry_tools_missing');
  }, 180000);
});

describe('B315.C2 negative: an unreachable server keeps the fallback', () => {
  it('team sync exits 0, says the registry did not answer, and does not mention the plugin', () => {
    const missing = path.join(tempDir('sdlc-b315-none-'), 'absent.mjs').replace(/\\/g, '/');
    const p = project({ roles: { type: 'stdio', command: ['node', missing], stages: [] } });
    const r = p.cli(['team', 'sync']);
    const out = r.stdout + r.stderr;
    expect(r.code, out).toBe(0);
    expect(out).toMatch(/did not answer/);
    expect(out).not.toMatch(/sdlc-registry/);
    expect(fs.existsSync(p.at('docs/agents/drafts/analyst.md'))).toBe(true);
  }, 180000);
});

let running: ChildProcess | undefined;
afterEach(() => {
  running?.kill();
  running = undefined;
});

async function httpRegistry(): Promise<{ port: number; log: string; data: string }> {
  const dir = tempDir('sdlc-b315-http-');
  const portFile = path.join(dir, 'port');
  const log = path.join(dir, 'calls.jsonl');
  const data = path.join(dir, 'registry.json');
  fs.writeFileSync(data, JSON.stringify(registryData()));
  fs.writeFileSync(log, '');
  const env = { ...process.env, FAKE_REGISTRY_FILE: data, FAKE_HTTP_LOG: log, FAKE_HTTP_PORT_FILE: portFile };
  running = spawn(process.execPath, [FAKE_HTTP], { env, stdio: 'ignore' });
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i += 1) await new Promise((r) => setTimeout(r, 50));
  return { port: Number(read(portFile)), log, data };
}

interface Call { path: string; tool: string; auth: string | null }
const calls = (log: string): Call[] => read(log).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('B315.C3 and C4 the two-server setup of SkillForge', () => {
  it('roles come from skillforge, events go to skillforge-events only, no agent config names either', async () => {
    const http = await httpRegistry();
    const base = `http://127.0.0.1:${http.port}`;
    const servers = {
      skillforge: {
        type: 'http', url: `${base}/registry`, stages: [],
        headers: { Authorization: 'Bearer ${SF_MCP_TOKEN}' },
      },
      'skillforge-events': {
        type: 'http', url: `${base}/events`, stages: [],
        headers: { Authorization: 'Bearer ${SF_EVENTS_TOKEN}' },
      },
    };
    const p = project(servers, { SF_MCP_TOKEN: 'registry-token-b315', SF_EVENTS_TOKEN: 'events-token-b315' });
    const config = parse(read(p.sdlc));
    config.events = [{ server: 'skillforge-events', tool: 'report_outcome', on: ['gate.*', 'verify.*'] }];
    write(p.sdlc, stringify(config));
    expect(p.cli(['update', '--json']).code).toBe(0);

    const sync = p.cli(['team', 'sync', '--json']);
    expect(sync.code, sync.stdout + sync.stderr).toBe(0);
    expect(sync.json().registry).toMatchObject({ server: 'skillforge', reachable: true, roles: ['analyst'] });
    expect(p.cli(['team', 'accept', 'analyst', '--json']).code).toBe(0);
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.at('openspec/changes/add-x/intent.md'), INTENT);
    const approve = p.cli(['approve', 'intent', '--change', 'add-x']);
    expect(approve.code, approve.stdout + approve.stderr).toBe(0);
    p.cli(['verify', '--change', 'add-x']);

    const all = calls(http.log);
    const registry = all.filter((c) => c.path === '/registry');
    const events = all.filter((c) => c.path === '/events');
    expect(registry.map((c) => c.tool)).toContain('list_roles');
    expect(registry.every((c) => c.auth === 'Bearer registry-token-b315')).toBe(true);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((c) => c.tool === 'report_outcome' && c.auth === 'Bearer events-token-b315')).toBe(true);
    expect(registry.map((c) => c.tool)).not.toContain('report_outcome');
    // C4: nothing reports usage.
    expect(all.map((c) => c.tool)).not.toContain('record_usage');
    for (const rel of ['.mcp.json', 'opencode.json', '.codex/config.toml']) {
      const text = fs.existsSync(p.at(rel)) ? read(p.at(rel)) : '';
      expect(text, rel).not.toMatch(/skillforge/);
    }
  }, 300000);
});
