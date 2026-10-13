import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { HUMAN_COMMANDS } from '../src/core/help-catalog.js';
import { BIN, git, humanEnv, initGitRepo, runCli, tempDir } from './helpers.js';

/**
 * B100: `sdlc mcp serve --http <host:port>` serves the same read-only tools over MCP Streamable HTTP at `/mcp`, for
 * remote clients. Customer decision: a bearer token is always required, on localhost too. The token comes from
 * SDLC_MCP_TOKEN; without it the server refuses to start (`token_required`, exit code not 0). A request without the
 * token or with another one gets 401 and reaches no tool. Port 0 picks a free port; the server prints the URL it
 * listens on (`http://<host>:<port>/mcp`) on one line of stderr. The tools `health`, `report` and `explain` answer what
 * `sdlc health --json`, `sdlc report --format json` and `sdlc explain --json` print. Still no decision over MCP.
 */

const TOKEN = 'test-token-0123456789';
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

function project() {
  const root = tempDir('sdlc-mcp-http-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
  expect(runCli(['new', 'add-export', '--json'], root, env).code).toBe(0);
  return { root, env };
}

/** Starts the server and resolves with its URL from stderr; rejects when it exits first or after 60 s. */
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
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`exited ${code}: ${stderr}`));
    });
  });
}

async function connect(url: string, token: string): Promise<Client> {
  const headers = { Authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: 'sdlc-http-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

function answer(result: Awaited<ReturnType<Client['callTool']>>): unknown {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content.find((part) => part.type === 'text')?.text ?? 'null');
}

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
});

async function rawPost(url: string, auth?: string): Promise<number> {
  const headers: Record<string, string> = {
    'content-type': 'application/json', accept: 'application/json, text/event-stream',
  };
  if (auth) headers.authorization = auth;
  const response = await fetch(url, { method: 'POST', headers, body: INITIALIZE });
  await response.text();
  return response.status;
}

describe('B100: sdlc mcp serve over HTTP', () => {
  it('refuses to start without SDLC_MCP_TOKEN', () => {
    const p = project();
    const env = { ...p.env };
    delete env.SDLC_MCP_TOKEN;
    const r = spawnSync(process.execPath, [BIN, 'mcp', 'serve', '--http', '127.0.0.1:0'],
      { cwd: p.root, env, encoding: 'utf-8', timeout: 60000 });
    expect(r.status).not.toBe(0);
    expect(r.status).not.toBeNull();
    expect(`${r.stdout}${r.stderr}`).toMatch(/token_required|SDLC_MCP_TOKEN/);
  }, 120000);

  it('negative: no token or another token gets 401', async () => {
    const p = project();
    const url = await serve(p.root, { ...p.env, SDLC_MCP_TOKEN: TOKEN });
    expect(await rawPost(url)).toBe(401);
    expect(await rawPost(url, 'Bearer wrong-token')).toBe(401);
    expect(await rawPost(url, TOKEN)).toBe(401);
  }, 120000);

  it('with the token: the read-only tools, health/report/explain answer like the CLI, no decision', async () => {
    const p = project();
    const url = await serve(p.root, { ...p.env, SDLC_MCP_TOKEN: TOKEN });
    const client = await connect(url, TOKEN);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining(['health', 'report', 'explain', 'status', 'next']));
      const decisions = [...HUMAN_COMMANDS, 'adopt', 'verify', 'tests', 'lock', 'license', 'backlog']
        .map((name) => name.replace(/ /g, '_'));
      for (const name of decisions) expect(names, name).not.toContain(name);
      const health = answer(await client.callTool({ name: 'health', arguments: {} })) as Record<string, unknown>;
      const cliHealth = runCli(['health', '--json'], p.root, p.env).json<Record<string, unknown>>();
      expect(Object.keys(health).sort()).toEqual(Object.keys(cliHealth).sort());
      const explain = answer(await client.callTool({ name: 'explain', arguments: { change: 'add-export' } }));
      expect(explain).toEqual(runCli(['explain', '--change', 'add-export', '--json'], p.root, p.env).json());
      const report = answer(await client.callTool({ name: 'report', arguments: {} })) as Record<string, unknown>;
      expect(JSON.stringify(report)).toContain('add-export');
    } finally {
      await client.close();
    }
  }, 180000);
});
