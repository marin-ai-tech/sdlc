import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B117 (epic E16): a representative reaches the board over `sdlc mcp serve --http` with the token a person issued
 * it (B118). For an executor token the server lists the board tools `board_list`, `board_claim`, `board_heartbeat`,
 * `board_release` and `board_submit`; the executor is taken from the token, never from the arguments - a tool has
 * no `executor` argument and refuses one. With the server token (no executor) only `board_list` is there, and a
 * write tool called anyway is refused with `executor_token_required`. Placement (`board dispatch`) and reopening
 * stay with people and the lead agent: no MCP tool offers them.
 */

const SERVER_TOKEN = 'server-token-0123456789';
const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const REGISTRY = {
  executors: {
    'rep-a': { type: 'representative', max_risk: 'medium' },
    junior: { type: 'representative', max_risk: 'low' },
  },
};
const WRITE_TOOLS = ['board_claim', 'board_heartbeat', 'board_release', 'board_submit'];
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

interface Entry {
  event: string;
  task?: string;
  executor?: string;
  agent?: string;
}

function project() {
  const root = tempDir('sdlc-board-mcp-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_MCP_TOKEN: SERVER_TOKEN });
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  const approve = (gate: string) => expect(cli(['approve', gate, '--change', 'add-farewell', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--risk', 'medium', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  approve('intent');
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  approve('spec');
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), OPEN_TASKS);
  write(path.join(root, 'openspec/executors.yaml'), stringify(REGISTRY));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planning and executor registry']);
  approve('plan');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'plan approved']);
  const tokenOf = (id: string) => {
    const r = cli(['task', 'executors', 'token', id, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json<{ token: string }>().token;
  };
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  return { root, env, cli, tokenOf, log };
}

function serve(root: string, env: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn(process.execPath, [BIN, 'mcp', 'serve', '--http', '127.0.0.1:0'], { cwd: root, env });
  running.push(child);
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`no URL in 60 s: ${stderr}`)), 60000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(stderr)?.[0];
      if (!url) return;
      clearTimeout(timer);
      resolve(url);
    });
    child.on('exit', (exit) => {
      clearTimeout(timer);
      reject(new Error(`exited ${exit}: ${stderr}`));
    });
  });
}

async function connect(url: string, token: string): Promise<Client> {
  const headers = { Authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: 'sdlc-board-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

type CallResult = Awaited<ReturnType<Client['callTool']>>;

function answer<T>(result: CallResult): T {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content.find((part) => part.type === 'text')?.text ?? 'null') as T;
}

const errorCode = (result: CallResult) => answer<{ status: { code: string }[] }>(result).status[0].code;

describe('B117: the board over MCP knows the executor by its token', () => {
  it('an executor token lists the board tools; none takes an executor argument; no placement tool', async () => {
    const p = project();
    const token = p.tokenOf('rep-a');
    const client = await connect(await serve(p.root, p.env), token);
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name);
    for (const name of ['board_list', ...WRITE_TOOLS]) expect(names, name).toContain(name);
    expect(names.filter((name) => /dispatch|reopen|approve|token/.test(name))).toEqual([]);
    for (const tool of tools.filter((entry) => entry.name.startsWith('board_'))) {
      expect(Object.keys(tool.inputSchema.properties ?? {}), tool.name).not.toContain('executor');
    }
    await client.close();
  }, 240000);

  it('a representative claims, heartbeats and releases as itself', async () => {
    const p = project();
    const token = p.tokenOf('rep-a');
    const client = await connect(await serve(p.root, p.env), token);
    const claimed = await client.callTool({ name: 'board_claim',
      arguments: { change: 'add-farewell', task: '1.2', agent: 'leader-1' } });
    expect(claimed.isError, JSON.stringify(claimed.content)).toBeFalsy();
    const claim = answer<{ claim: { id: string; executor: string } }>(claimed).claim;
    expect(claim.executor).toBe('rep-a');
    const listed = answer<{ tasks: { id: string; status: string; executor?: string }[] }>(
      await client.callTool({ name: 'board_list', arguments: {} }));
    expect(listed.tasks.find((task) => task.id === 'add-farewell#1.2'))
      .toMatchObject({ status: 'claimed', executor: 'rep-a' });
    const beat = await client.callTool({ name: 'board_heartbeat', arguments: { claim: claim.id } });
    expect(beat.isError, JSON.stringify(beat.content)).toBeFalsy();
    const released = await client.callTool({ name: 'board_release', arguments: { claim: claim.id } });
    expect(released.isError, JSON.stringify(released.content)).toBeFalsy();
    expect(p.log().filter((e) => e.event === 'task.claimed').map((e) => [e.task, e.executor, e.agent]))
      .toEqual([['1.2', 'rep-a', 'leader-1']]);
    await client.close();
  }, 240000);

  it('negative: an executor argument, a disallowed executor, the server token on a write tool', async () => {
    const p = project();
    const repToken = p.tokenOf('rep-a');
    const juniorToken = p.tokenOf('junior');
    const url = await serve(p.root, p.env);
    const rep = await connect(url, repToken);
    const forged = await rep.callTool({ name: 'board_claim',
      arguments: { change: 'add-farewell', task: '1.2', agent: 'leader-1', executor: 'junior' } });
    expect(forged.isError).toBe(true);
    expect(errorCode(forged)).toBe('invalid_arguments');
    await rep.close();
    const junior = await connect(url, juniorToken);
    const refused = await junior.callTool({ name: 'board_claim',
      arguments: { change: 'add-farewell', task: '1.2', agent: 'coder-1' } });
    expect(refused.isError).toBe(true);
    expect(errorCode(refused)).toBe('executor_not_allowed');
    await junior.close();
    const server = await connect(url, SERVER_TOKEN);
    const names = (await server.listTools()).tools.map((tool) => tool.name);
    expect(names).toContain('board_list');
    for (const name of WRITE_TOOLS) expect(names, name).not.toContain(name);
    const anonymous = await server.callTool({ name: 'board_claim',
      arguments: { change: 'add-farewell', task: '1.2', agent: 'leader-1' } });
    expect(anonymous.isError).toBe(true);
    expect(errorCode(anonymous)).toBe('executor_token_required');
    await server.close();
    expect(p.log().filter((e) => e.event === 'task.claimed')).toEqual([]);
  }, 240000);
});
