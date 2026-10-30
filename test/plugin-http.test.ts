import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { callTool } from '../dist/mcp/call-tool.js';
import { READ_TOOLS, WRITE_TOOLS } from '../dist/mcp/tools.js';
import { capturePackage } from '../dist/plugins/package.js';
import { invoke } from '../dist/plugins/runtime.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { guest } from './fixtures/plugin-modules.js';
import { FILES } from './farewell-fixture.js';
import { BIN, git, humanEnv, tempDir, write } from './helpers.js';

const TOKEN = 'e19-server-token-0123456789';
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

function serve(roots: string[]): Promise<string> {
  const child = spawn(process.execPath, [BIN, 'mcp', 'serve', '--http', '127.0.0.1:0',
    ...roots.flatMap((root) => ['--project', root])], {
    cwd: roots[0], env: humanEnv(tempDir('sdlc-plugin-http-home-'), { SDLC_MCP_TOKEN: TOKEN }),
  });
  running.push(child);
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Plugin HTTP server did not start: ${stderr}`));
    }, 15_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(stderr)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${stderr}`)); });
  });
}

async function connect(url: string, token: string): Promise<Client> {
  const client = new Client({ name: 'e19-plugin-http-test', version: '0.0.0' });
  clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  }));
  return client;
}

function code(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.structuredContent as { status: Array<{ code: string }> }).status[0].code;
}

async function namedProject(name: string, overrides: Record<string, unknown> = {}) {
  const p = await pluginProject({ output: { answer: 42 } }, overrides);
  p.raw.project = { name };
  fs.writeFileSync(p.file, stringify(p.raw));
  return p;
}

function approveFixturePlan(p: Awaited<ReturnType<typeof namedProject>>): void {
  expect(p.cli(['new', 'add-farewell', '--schema', 'spec-driven', '--track', 'lite', '--json']).code).toBe(0);
  for (const [name, source] of Object.entries(FILES)) {
    if (name === 'review.md') continue;
    write(path.join(p.root, 'openspec/changes/add-farewell', name),
      name === 'tasks.md' ? source.replaceAll('[x]', '[ ]') : source);
  }
  git(p.root, ['add', '-A']);
  git(p.root, ['commit', '-q', '-m', 'Fixture plan and plugin']);
  const approval = p.cli(['approve', 'plan', '--change', 'add-farewell', '--json']);
  expect(approval.code, approval.stdout + approval.stderr).toBe(0);
}

async function originGuard(): Promise<Buffer> {
  const pass = { output: { decision: 'pass' } };
  const denied = Buffer.from(JSON.stringify({ output: { decision: 'deny', code: 'mcp_actor' } }));
  const bytes = [...denied].map((value) => `\\${value.toString(16).padStart(2, '0')}`).join('');
  const scanner = `(func $is_mcp (param $ptr i32) (param $len i32) (result i32) (local $i i32)
    (block $end (loop $scan
      (br_if $end (i32.ge_u (i32.add (local.get $i) (i32.const 4)) (local.get $len)))
      (if (i32.and
        (i32.eq (i32.load (i32.add (local.get $ptr) (local.get $i))) (i32.const 0x70636d22))
        (i32.eq (i32.load8_u offset=4 (i32.add (local.get $ptr) (local.get $i))) (i32.const 34)))
        (then (return (i32.const 1))))
      (local.set $i (i32.add (local.get $i) (i32.const 1))) (br $scan))) (i32.const 0))`;
  const packed = (at: number, size: number) => (BigInt(at) << 32n) | BigInt(size);
  return guest(pass, { table: `(data (i32.const 512) "${bytes}")\n${scanner}`,
    call: `(if (result i64) (call $is_mcp (local.get 0) (local.get 1))
      (then (i64.const ${packed(512, denied.length)}))
      (else (i64.const ${packed(128, Buffer.byteLength(JSON.stringify(pass)))})))` });
}

describe('Plugin tools over the real HTTP transport', () => {
  it('person-started stdio exposes reads and refuses both hidden person and executor calls', async () => {
    const p = await namedProject('alpha');
    const client = new Client({ name: 'e19-plugin-stdio-test', version: '0.0.0' });
    clients.push(client);
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [BIN, 'mcp', 'serve'],
      cwd: p.root, env: humanEnv(tempDir('sdlc-plugin-stdio-home-')) as Record<string, string>, stderr: 'pipe' }));
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('economy__read');
    expect(names).not.toContain('economy__configure');
    expect(names).not.toContain('economy__record');
    expect((await client.callTool({ name: 'economy__read', arguments: { input: {} } })).isError).toBeFalsy();
    for (const name of ['economy__configure', 'economy__record']) {
      expect(code(await client.callTool({ name, arguments: { input: {}, request: pluginRequest() } })))
        .toBe('plugin_access');
    }
    const store = JSON.parse(fs.readFileSync(path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store.revision).toBe(0);
  }, 30_000);

  it('project tokens authorize typed plugin calls; person tools stay hidden on a person-started server', async () => {
    const a = await namedProject('alpha');
    const b = await namedProject('beta');
    const issued = a.cli(['task', 'executors', 'token', 'mesh', '--json']);
    expect(issued.code, issued.stdout + issued.stderr).toBe(0);
    const url = await serve([a.root, b.root]);
    const ordinary = await connect(url, TOKEN);
    const executor = await connect(url, issued.json().token);
    const reads = (await ordinary.listTools()).tools;
    expect(reads.map((tool) => tool.name)).toContain('economy__read');
    expect(reads.map((tool) => tool.name)).not.toContain('economy__record');
    expect(reads.map((tool) => tool.name)).not.toContain('economy__configure');
    const tools = (await executor.listTools()).tools;
    expect(tools.map((tool) => tool.name)).toContain('economy__record');
    expect(tools.map((tool) => tool.name)).not.toContain('economy__configure');
    const schema = tools.find((tool) => tool.name === 'economy__record')!.inputSchema;
    const validate = new Ajv2020({ strict: true }).compile(schema);
    expect(validate({ input: { typed: [true, 2, null] }, request: pluginRequest() })).toBe(true);
    expect(validate({ input: {}, request: 17 })).toBe(false);
    const read = await ordinary.callTool({ name: 'economy__read', arguments: { project: 'beta', input: [true, 2] } });
    expect(read.isError).toBeFalsy();
    expect(read.structuredContent).toMatchObject({ plugin: 'economy', output: { answer: 42 } });
    expect(code(await ordinary.callTool({ name: 'economy__record',
      arguments: { project: 'alpha', input: {}, request: pluginRequest() } }))).toBe('plugin_access');
    expect(code(await executor.callTool({ name: 'economy__configure',
      arguments: { input: {}, request: pluginRequest() } }))).toBe('plugin_access');
    expect(code(await executor.callTool({ name: 'economy__record',
      arguments: { project: 'beta', input: {}, request: pluginRequest() } }))).toBe('plugin_executor');
    for (const key of ['project', 'executor', 'origin', 'request']) {
      expect(code(await executor.callTool({ name: 'economy__record',
        arguments: { input: { [key]: 'forged' }, request: pluginRequest() } }))).toBe('plugin_input');
    }
    const request = pluginRequest();
    const written = await executor.callTool({ name: 'economy__record', arguments: { input: {}, request } });
    expect(written.isError).toBeFalsy();
    expect(written.structuredContent).toMatchObject({ plugin: 'economy', request });
    const store = JSON.parse(fs.readFileSync(path.join(a.root, 'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store.revision).toBe(1);
    expect(store.receipts).toHaveLength(1);
    expect(a.cli(['plugins', 'revoke', 'economy', '--json']).code).toBe(0);
    expect((await executor.callTool({ name: 'economy__record', arguments: { input: {}, request: pluginRequest() } })).isError)
      .toBe(true);
    expect((await executor.listTools()).tools.map((tool) => tool.name)).not.toContain('economy__record');
  }, 60_000);

  it('incompatible project schemas omit the flattened tool and refuse hidden direct calls', async () => {
    const a = await namedProject('alpha');
    const b = await namedProject('beta', { operations: { read: { access: 'read', input: { type: 'integer' }, output: true } },
      commands: { read: 'read' }, tools: { read: 'read' } });
    const client = await connect(await serve([a.root, b.root]), TOKEN);
    expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain('economy__read');
    expect(code(await client.callTool({ name: 'economy__read', arguments: { project: 'alpha', input: {} } })))
      .toBe('plugin_tool_conflict');
  }, 45_000);

  it('task export carries schema-checked extensions through HTTP and the actual CLI', async () => {
    const p = await namedProject('alpha', { schemas: { config: true, state: true, facts: { type: 'object' },
      taskExt: { type: 'object', properties: { units: { type: 'integer', minimum: 1 } },
        required: ['units'], additionalProperties: false } } });
    approveFixturePlan(p);
    const issued = p.cli(['task', 'executors', 'token', 'mesh', '--json']);
    expect(issued.code, issued.stdout + issued.stderr).toBe(0);
    const url = await serve([p.root]);
    const client = await connect(url, issued.json().token);
    const ext = { economy: { units: 2 } };
    const exported = await client.callTool({ name: 'task_export',
      arguments: { change: 'add-farewell', task: '1.1', ext } });
    expect(exported.isError, JSON.stringify(exported.content)).toBeFalsy();
    const items = (exported.structuredContent as { items: Array<Record<string, unknown>> }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: 'add-farewell#1.1', executor: 'mesh', ext });
    const ordinary = await connect(url, TOKEN);
    const selected = await ordinary.callTool({ name: 'task_export',
      arguments: { change: 'add-farewell', task: '1.2', executor: 'mesh', ext } });
    expect(selected.isError, JSON.stringify(selected.content)).toBeFalsy();
    expect((selected.structuredContent as { items: Array<Record<string, unknown>> }).items[0].executor).toBe('mesh');
    expect(code(await ordinary.callTool({ name: 'economy__record',
      arguments: { input: {}, request: pluginRequest() } }))).toBe('plugin_access');
    expect(code(await client.callTool({ name: 'task_export',
      arguments: { change: 'add-farewell', executor: 'other', ext } }))).toBe('invalid_arguments');
    for (const value of [{ economy: { units: '2' } }, { missing: {} }]) {
      expect((await client.callTool({ name: 'task_export',
        arguments: { change: 'add-farewell', ext: value } })).isError).toBe(true);
    }
  }, 60_000);

  it('core HTTP claim hooks retain MCP origin even when a person starts the server', async () => {
    const p = await pluginProject({ output: { decision: 'pass' } }, { hooks: { claim: 'read' } }, {}, false);
    fs.writeFileSync(path.join(p.p.dir, 'plugin.wasm'), await originGuard());
    const snapshot = capturePackage(p.root, p.p.source);
    for (const origin of ['cli', 'mcp']) {
      const verdict = await invoke(snapshot, { operation: 'read', input: {}, config: {}, state: {}, hook: true,
        context: { actor: { origin } } });
      expect(verdict?.output).toMatchObject({ decision: origin === 'mcp' ? 'deny' : 'pass' });
    }
    p.raw.project = { name: 'alpha' };
    p.raw.plugins.economy.digest = snapshot.digest;
    fs.writeFileSync(p.file, stringify(p.raw));
    const accepted = p.cli(['plugins', 'accept', 'economy', '--expect-digest', p.raw.plugins.economy.digest, '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    approveFixturePlan(p);
    const issued = p.cli(['task', 'executors', 'token', 'mesh', '--json']);
    expect(issued.code).toBe(0);
    const human = p.cli(['board', 'claim', '--change', 'add-farewell', '--task', '1.1',
      '--executor', 'mesh', '--agent', 'human-fixture', '--json']);
    expect(human.code, human.stdout + human.stderr).toBe(0);
    const client = await connect(await serve([p.root]), issued.json().token);
    const claimed = await client.callTool({ name: 'board_claim',
      arguments: { change: 'add-farewell', task: '1.2', agent: 'mcp-fixture' } });
    expect(claimed.isError, JSON.stringify(claimed.content)).toBe(true);
    expect(code(claimed)).toBe('plugin_refused');
    const board = JSON.parse(fs.readFileSync(path.join(p.root, 'openspec/.sdlc/board.json'), 'utf8'));
    expect(board.claims.map((claim: { item: string }) => claim.item)).toEqual(['add-farewell#1.1']);
  }, 60_000);
});

describe('Structured extensions keep the core scalar argument boundary', () => {
  it('only export, claim and bid publish extensions and pass canonical JSON as a single CLI argument', async () => {
    expect([...READ_TOOLS, ...WRITE_TOOLS].filter((tool) => tool.extensions).map((tool) => tool.name).sort())
      .toEqual(['board_bid', 'board_claim', 'task_export']);
    for (const [name, args] of [
      ['task_export', { change: 'change', task: '1.1' }],
      ['board_claim', { change: 'change', task: '1.1', agent: 'worker' }],
      ['board_bid', { change: 'change', task: '1.1', agent: 'worker', minutes: 3 }],
    ] as const) {
      let actual: string[] = [];
      const ext = { economy: { z: ['--flag', true], a: 3 } };
      const result = await callTool(name, { ...args, ext }, 'project', async (argv) => {
        actual = argv;
        return { code: 0, stdout: '{"ok":true}', stderr: '' };
      }, 'mesh');
      expect(result.isError).toBeUndefined();
      expect(actual.slice(actual.indexOf('--ext-json'), actual.indexOf('--ext-json') + 2))
        .toEqual(['--ext-json', '{"economy":{"a":3,"z":["--flag",true]}}']);
      expect(actual.filter((word) => word === '--ext-json')).toHaveLength(1);
    }
  });

  it('malformed extensions and structured scalar fields never invoke the CLI runner', async () => {
    const run = async () => { throw new Error('invalid input reached the CLI runner'); };
    for (const ext of [null, [], 'json', { origin: {} }, { economy: { n: Infinity } }]) {
      expect((await callTool('task_export', { ext }, 'project', run)).isError).toBe(true);
    }
    for (const input of [{ ext: {} }, { change: {} }, { change: ['change'] }, { change: '--option' }]) {
      expect((await callTool('status', input, 'project', run)).isError).toBe(true);
    }
    expect((await callTool('board_bid', { change: 'c', task: '1.1', agent: {}, minutes: 1, ext: {} },
      'project', run, 'mesh')).isError).toBe(true);
    expect((await callTool('task_export', { executor: 'other', ext: {} }, 'project', run, 'mesh')).isError).toBe(true);
  });
});
