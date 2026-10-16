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
 * B120 (epic E16): mesh executors. In a peer-to-peer swarm a claim or a result can reach the board twice (relayed by
 * two peers, or retried after a lost answer). Every board write — claim, heartbeat, release, submit, bid — takes a
 * request key (`--request <key>`, MCP argument `request`): the same key with the same arguments answers what the
 * first call answered and writes nothing new (no second claim, no second log entry); the same key with other
 * arguments is refused with `request_conflict`. Over MCP an executor's token also gets `board_bid` (B119); auctions
 * and awards stay with people and the lead agent.
 */

const SERVER_TOKEN = 'server-token-0123456789';
const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = { executors: { 'mesh-a': { type: 'mesh', max_risk: 'medium' } } };
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

interface Entry {
  event: string;
  task?: string;
}

function project() {
  const root = tempDir('sdlc-board-mesh-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_MCP_TOKEN: SERVER_TOKEN });
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
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
  const board = (args: string[]) => cli(['board', ...args, '--json'], AGENT);
  const claim = (task: string, request?: string) => board(['claim', '--change', 'add-farewell', '--task', task,
    '--executor', 'mesh-a', '--agent', 'peer-1', ...(request ? ['--request', request] : [])]);
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  const resultBranch = (branch: string) => {
    git(root, ['checkout', '-q', '-b', branch]);
    write(path.join(root, 'src/greet.js'), `// ${branch}\n`);
    git(root, ['add', '--', 'src/greet.js']);
    git(root, ['commit', '-q', '-m', ['work', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.2',
      'SDLC-Agent: mesh-a/peer-1'].join('\n')]);
    git(root, ['checkout', '-q', 'main']);
  };
  return { root, env, cli, board, claim, log, resultBranch };
}

const code = (r: { json: <T>() => T }) => r.json<{ status: { code: string }[] }>().status[0].code;
const claimId = (r: { json: <T>() => T }) => r.json<{ claim: { id: string } }>().claim.id;

describe('B120: a relayed request is applied once', () => {
  it('the same claim twice with one request key gives one claim and one log entry', () => {
    const p = project();
    const first = p.claim('1.2', 'peer-1:claim:0001');
    expect(first.code, first.stdout + first.stderr).toBe(0);
    const again = p.claim('1.2', 'peer-1:claim:0001');
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(claimId(again)).toBe(claimId(first));
    expect(p.log().filter((e) => e.event === 'task.claimed')).toHaveLength(1);
    expect(code(p.claim('1.2', 'peer-2:claim:0001'))).toBe('task_claimed');
  }, 240000);

  it('submit, heartbeat and release replayed answer as the first time and log once', () => {
    const p = project();
    const id = claimId(p.claim('1.2', 'peer-1:claim:0001'));
    const beat = ['heartbeat', '--claim', id, '--request', 'peer-1:beat:0001'];
    expect(p.board(beat).code).toBe(0);
    expect(p.board(beat).code).toBe(0);
    p.resultBranch('sdlc/add-farewell/1.2');
    const submit = ['submit', '--claim', id, '--branch', 'sdlc/add-farewell/1.2', '--request', 'peer-1:submit:0001'];
    const submitted = p.board(submit);
    expect(submitted.code, submitted.stdout + submitted.stderr).toBe(0);
    const replay = p.board(submit);
    expect(replay.code, replay.stdout + replay.stderr).toBe(0);
    expect(p.log().filter((e) => e.event === 'task.submitted')).toHaveLength(1);
    const other = project();
    const otherId = claimId(other.claim('1.1'));
    const release = ['release', '--claim', otherId, '--request', 'peer-1:release:0001'];
    expect(other.board(release).code).toBe(0);
    expect(other.board(release).code).toBe(0);
    expect(other.log().filter((e) => e.event === 'task.released')).toHaveLength(1);
  }, 240000);

  it('negative: one key with other arguments conflicts; a malformed key is refused', () => {
    const p = project();
    expect(p.claim('1.2', 'peer-1:claim:0001').code).toBe(0);
    expect(code(p.claim('1.1', 'peer-1:claim:0001'))).toBe('request_conflict');
    expect(code(p.claim('1.1', 'bad key'))).toBe('invalid_request');
    expect(code(p.claim('1.1', 'x'))).toBe('invalid_request');
    expect(p.log().filter((e) => e.event === 'task.claimed')).toHaveLength(1);
  }, 240000);
});

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

describe('B119/B120 over MCP', () => {
  it('an executor token gets board_bid and the request argument; no auction or award tool', async () => {
    const p = project();
    const issued = p.cli(['task', 'executors', 'token', 'mesh-a', '--json']);
    expect(issued.code, issued.stdout + issued.stderr).toBe(0);
    const token = issued.json<{ token: string }>().token;
    const url = await serve(p.root, p.env);
    const transport = new StreamableHTTPClientTransport(new URL(url),
      { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    const client = new Client({ name: 'sdlc-mesh-test', version: '0.0.0' });
    await client.connect(transport);
    const tools = (await client.listTools()).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toContain('board_bid');
    expect(names.filter((name) => /auction|award/.test(name))).toEqual([]);
    const claimTool = tools.find((tool) => tool.name === 'board_claim');
    expect(Object.keys(claimTool?.inputSchema.properties ?? {})).toContain('request');
    const args = { change: 'add-farewell', task: '1.2', agent: 'peer-1', request: 'peer-1:mcp:0001' };
    const first = await client.callTool({ name: 'board_claim', arguments: args });
    const again = await client.callTool({ name: 'board_claim', arguments: args });
    expect(first.isError, JSON.stringify(first.content)).toBeFalsy();
    expect(again.isError, JSON.stringify(again.content)).toBeFalsy();
    const id = (result: typeof first) => JSON.parse((result.content as { text: string }[])[0].text).claim.id;
    expect(id(again)).toBe(id(first));
    expect(p.log().filter((e) => e.event === 'task.claimed')).toHaveLength(1);
    await client.close();
  }, 240000);
});
