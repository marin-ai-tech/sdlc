import { spawn, type ChildProcess } from 'node:child_process';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E11 team run (an executor swarm, the board and the auction, 2026-10-18), decided by the owner for
 * 0.23.5.
 *
 * finding 1: `sdlc instructions --json` gave `outputPath: "plan.md"`, relative to the change folder; agents wrote it relative
 * to the repository root (five times in three runs). `outputPath` is relative to the project root.
 * finding 2: the board tools over MCP took numbers (`lease`) only as strings; a JSON number is accepted.
 * finding 3: a result branch the executor pushed to origin was `unknown_ref` until the board host fetched it; the submit
 * fetches a valid branch name from origin itself, and refuses a name that is not a branch name.
 * finding 4: every attempt at a task used the same result branch, so a retry overwrote the rejected attempt; each attempt
 * after the first gets its own branch, and `previousAttempts` keeps the head commit of the rejected one.
 * finding 5: `sdlc board list` showed a dispatched task as `executor/?`.
 */

const SERVER_TOKEN = 'server-token-0123456789';
const TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const REGISTRY = { executors: { 'rep-a': { type: 'representative', max_risk: 'medium' } } };
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

function project() {
  const root = tempDir('sdlc-0235-board-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_MCP_TOKEN: SERVER_TOKEN });
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  const approve = (gate: string) => expect(cli(['approve', gate, '--change', 'add-farewell', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--risk', 'medium', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  approve('intent');
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  approve('spec');
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), TASKS);
  write(path.join(root, 'openspec/executors.yaml'), stringify(REGISTRY));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planning and executor registry']);
  approve('plan');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'plan approved']);
  const origin = path.join(tempDir('sdlc-0235-origin-'), 'origin.git');
  git(root, ['clone', '-q', '--bare', root, origin]);
  git(root, ['remote', 'add', 'origin', origin]);
  git(root, ['fetch', '-q', 'origin']);
  const token = () => {
    const r = cli(['task', 'executors', 'token', 'rep-a', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json<{ token: string }>().token;
  };
  return { root, env, cli, origin, token };
}

/** The executor's own clone: one commit on `branch` with the trailers of its work item, pushed to origin. */
function pushResult(origin: string, branch: string, trailers: Record<string, string>, content: string): string {
  const work = path.join(tempDir('sdlc-0235-executor-'), 'work');
  git(path.dirname(work), ['clone', '-q', origin, work]);
  git(work, ['config', 'user.name', 'Bot A']);
  git(work, ['config', 'user.email', 'bot-a@example.com']);
  git(work, ['config', 'commit.gpgsign', 'false']);
  git(work, ['checkout', '-q', '-b', branch]);
  write(path.join(work, 'test/greet.test.js'), content);
  git(work, ['add', '-A']);
  const message = ['Add the greeting test', '', ...Object.entries(trailers).map(([k, v]) => `${k}: ${v}`)].join('\n');
  git(work, ['commit', '-q', '-m', message]);
  git(work, ['push', '-q', '--force', 'origin', branch]);
  return read(path.join(work, '.git', 'refs', 'heads', ...branch.split('/'))).trim();
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
  const transport = new StreamableHTTPClientTransport(new URL(url),
    { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'sdlc-0235-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<{ error: boolean; body: T }> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  return { error: result.isError === true, body: JSON.parse(content.find((p) => p.type === 'text')?.text ?? 'null') as T };
}

interface Claimed {
  claim: { id: string };
  item: { result: { branch: string; trailers: Record<string, string> }; previousAttempts?: Array<{ head?: string }> };
}

describe('finding 1: outputPath is relative to the project root', () => {
  it('instructions plan names openspec/changes/<id>/plan.md', () => {
    const p = project();
    const r = p.cli(['instructions', 'plan', '--change', 'add-farewell', '--json']);
    expect(r.code).toBe(0);
    expect(r.json<{ outputPath: string }>().outputPath).toBe('openspec/changes/add-farewell/plan.md');
  }, 240000);
});

describe('finding 2–finding 4: claiming and submitting over MCP', () => {
  it('a numeric lease is accepted; a pushed branch is submitted without a manual fetch; a bad name is refused', async () => {
    const p = project();
    const client = await connect(await serve(p.root, p.env), p.token());
    const claimed = await call<Claimed>(client, 'board_claim', { change: 'add-farewell', task: '1.1', agent: 'bot',
      lease: 600 });
    expect(claimed.error, JSON.stringify(claimed.body)).toBe(false);
    const bad = await call<unknown>(client, 'board_submit', { claim: claimed.body.claim.id, branch: '--upload-pack=x' });
    expect(bad.error).toBe(true);
    const { branch, trailers } = claimed.body.item.result;
    pushResult(p.origin, branch, trailers, 'import test from "node:test";\ntest("greets", () => {});\n');
    const submitted = await call<{ result: { ok: boolean } }>(client, 'board_submit',
      { claim: claimed.body.claim.id, branch });
    expect(submitted.error, JSON.stringify(submitted.body)).toBe(false);
    expect(submitted.body.result.ok).toBe(true);
    await client.close();
  }, 300000);

  it('a retry after a reopen gets its own branch, and previousAttempts keeps the rejected head', async () => {
    const p = project();
    const client = await connect(await serve(p.root, p.env), p.token());
    const first = await call<Claimed>(client, 'board_claim', { change: 'add-farewell', task: '1.1', agent: 'bot' });
    const firstBranch = first.body.item.result.branch;
    const head = pushResult(p.origin, firstBranch, first.body.item.result.trailers, 'export {};\n');
    git(p.root, ['fetch', '-q', 'origin', `+refs/heads/${firstBranch}:refs/heads/${firstBranch}`]);
    expect((await call(client, 'board_submit', { claim: first.body.claim.id, branch: firstBranch })).error).toBe(false);
    expect(p.cli(['board', 'reopen', '--change', 'add-farewell', '--task', '1.1', '--reason', 'Skips']).code).toBe(0);
    const second = await call<Claimed>(client, 'board_claim', { change: 'add-farewell', task: '1.1', agent: 'bot' });
    expect(second.error, JSON.stringify(second.body)).toBe(false);
    expect(second.body.item.result.branch).not.toBe(firstBranch);
    expect(second.body.item.previousAttempts?.[0]?.head).toBe(head);
    await client.close();
  }, 300000);
});

describe('finding 5: a dispatched task without an agent', () => {
  it('board list does not show executor/?', () => {
    const p = project();
    expect(p.cli(['board', 'dispatch', '--change', 'add-farewell', '--task', '1.2', '--executor', 'rep-a']).code).toBe(0);
    const list = p.cli(['board', 'list']);
    expect(list.stdout).toMatch(/rep-a/);
    expect(list.stdout).not.toMatch(/rep-a\/\?/);
  }, 240000);
});
