import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { SdlcError, toDiagnostic } from '../dist/core/errors.js';
import { pluginDiagnostic, pluginError } from '../dist/plugins/api.js';
import { callPluginTool } from '../dist/plugins/mcp.js';
import { pluginProject } from './fixtures/plugin-project.js';
import { BIN, humanEnv, tempDir } from './helpers.js';

const TOKEN = 'e19-diagnostic-http-token';
const running: ChildProcess[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(running.splice(0).map((child) => new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill();
  })));
});

async function namedProject(name: string, overrides: Record<string, unknown> = {}, loop = false) {
  const p = await pluginProject({ output: 42 }, overrides,
    loop ? { call: '(loop $forever (br $forever)) (i64.const 0)' } : {});
  p.raw.project = { name };
  fs.writeFileSync(p.file, stringify(p.raw));
  return p;
}

function serve(roots: string[]): Promise<string> {
  const child = spawn(process.execPath, [BIN, 'mcp', 'serve', '--http', '127.0.0.1:0',
    ...roots.flatMap((root) => ['--project', root])], {
    cwd: roots[0], env: humanEnv(tempDir('sdlc-plugin-diagnostics-home-'), { SDLC_MCP_TOKEN: TOKEN }),
  });
  running.push(child);
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`HTTP startup failed: ${stderr}`)); }, 15_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(stderr)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`HTTP exited ${code}: ${stderr}`)); });
  });
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: 'plugin-diagnostics-test', version: '0.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  }));
  return client;
}

function expectSafe(value: unknown, root: string): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain(root);
  expect(text).not.toContain(JSON.stringify(root).slice(1, -1));
  expect(text).not.toContain(root.replaceAll('\\', '/'));
  expect(text).not.toMatch(/ENOENT|EACCES|EPERM|lstat|node:fs/);
}

describe('Public plugin diagnostics', () => {
  it('preserves known errors while native failures are bounded and legacy diagnostics stay unchanged', () => {
    const native = new Error(`ENOENT: lstat C:\\private\\credentials\\${'x'.repeat(20_000)}`);
    const diagnostic = pluginDiagnostic(native);
    expect(diagnostic.code).toBe('plugin_unavailable');
    expect(JSON.stringify(diagnostic).length).toBeLessThan(1000);
    expectSafe(diagnostic, 'C:\\private');
    const known = new SdlcError('plugin_executor', 'Authenticated executor required', 'Use the project token');
    expect(pluginError(known)).toBe(known);
    expect(pluginDiagnostic(known)).toEqual(toDiagnostic(known));
    expect(toDiagnostic(native)).toMatchObject({ code: 'unexpected_error', message: native.message });
  });

  it('tools/list omits conflicting accepted descriptors and exposes additive diagnostics through HTTP SDK', async () => {
    const a = await namedProject('alpha');
    const b = await namedProject('beta', { operations: { read: { access: 'read', input: { type: 'integer' }, output: true } },
      commands: { read: 'read' }, tools: { read: 'read' } });
    const client = await connect(await serve([a.root, b.root]));
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).not.toContain('economy__read');
    expect(listed._meta).toEqual({ sdlc: { diagnostics: [{ code: 'plugin_tool_conflict', tool: 'economy__read',
      message: 'Served projects have incompatible descriptors for this plugin tool.' }] } });
    expectSafe(listed._meta, a.root);
    expectSafe(listed._meta, b.root);
    const direct = await client.callTool({ name: 'economy__read', arguments: { project: 'alpha', input: {} } });
    expect(direct.isError).toBe(true);
    expect(direct.structuredContent).toMatchObject({ status: [{ code: 'plugin_tool_conflict' }] });
    b.raw.plugins.economy.enabled = false;
    fs.writeFileSync(b.file, stringify(b.raw));
    const compatible = await client.listTools();
    expect(compatible.tools.map((tool) => tool.name)).toContain('economy__read');
    expect(compatible._meta).toBeUndefined();
  }, 40_000);

  it('missing accepted packages refuse through HTTP and direct MCP without native paths or guest effects', async () => {
    const p = await namedProject('alpha', {}, true);
    const client = await connect(await serve([p.root]));
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain('economy__read');
    const store = path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json');
    const before = fs.readFileSync(store, 'utf8');
    fs.renameSync(p.p.dir, `${p.p.dir}.removed`);
    const direct = await callPluginTool('economy__read', { input: {} }, [{ name: 'alpha', root: p.root }]);
    const remote = await client.callTool({ name: 'economy__read', arguments: { input: {} } });
    for (const result of [direct, remote]) {
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ status: [{ code: 'plugin_unavailable' }] });
      expectSafe(result, p.root);
      expect(JSON.stringify(result).length).toBeLessThan(1500);
    }
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).not.toContain('economy__read');
    expect(listed._meta).toMatchObject({ sdlc: { diagnostics: [{ code: 'plugin_unavailable' }] } });
    expectSafe(listed._meta, p.root);
    expect(fs.readFileSync(store, 'utf8')).toBe(before);
  }, 30_000);

  it('CLI management, direct commands, reports and plugin doctor checks share the native sanitizer', async () => {
    const p = await namedProject('alpha');
    fs.renameSync(p.p.dir, `${p.p.dir}.removed`);
    for (const args of [['economy', 'read', '--json'],
      ['plugins', 'accept', 'economy', '--expect-digest', p.snapshot.digest, '--json']]) {
      const result = p.cli(args);
      expect(result.code).not.toBe(0);
      expect(result.json()).toMatchObject({ status: [{ code: 'plugin_unavailable' }] });
      expectSafe(result.json(), p.root);
    }
    const reports = p.cli(['plugins', 'list', '--json']).json().plugins;
    expect(reports[0].problems).toMatchObject([{ code: 'plugin_unavailable' }]);
    expectSafe(reports, p.root);
    const checks = p.cli(['doctor', '--json']).json().checks
      .filter((check: { check: string }) => check.check.startsWith('plugin'));
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.some((check: { code: string }) => check.code === 'plugin_unavailable')).toBe(true);
    expectSafe(checks, p.root);
  }, 30_000);
});
