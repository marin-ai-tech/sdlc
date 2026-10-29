import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B151 (review finding F9 of harness-runtime-prototype): `board_submit` over `sdlc mcp serve --http` runs the same
 * result check as `board submit`, so a branch that edits a protected file with a non-ASCII name is refused under the
 * file's real name and the claim stays held. Before B151 `git diff --name-only` printed the name C-quoted
 * (`core.quotePath`), the quoted form matched no protected glob, and the claim became submitted.
 */

/** The server token of this run, made at random: the case itself only uses the executor token. */
const SERVER_CREDENTIAL = randomBytes(16).toString('hex');
const PROTECTED = 'config/tést.yaml';
const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const REGISTRY = { executors: { 'rep-a': { type: 'representative', max_risk: 'medium' } } };
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

interface Entry {
  event: string;
  task?: string;
}

function project() {
  const root = tempDir('sdlc-board-mcp-paths-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  write(path.join(root, PROTECTED), 'setting: protected value\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_MCP_TOKEN: SERVER_CREDENTIAL });
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.enforcement.protected_paths = [PROTECTED];
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
  /** A result branch from main with one commit of the protected file only (staged by name, never `add -A`). */
  const editProtected = (branch: string) => {
    git(root, ['checkout', '-q', '-b', branch]);
    write(path.join(root, PROTECTED), 'setting: changed by the executor\n');
    git(root, ['add', '--', PROTECTED]);
    const message = ['work', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.2', 'SDLC-Agent: rep-a/leader-1'];
    git(root, ['commit', '-q', '-m', message.join('\n')]);
    git(root, ['checkout', '-q', 'main']);
  };
  return { root, env, tokenOf, log, editProtected };
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

async function connect(url: string, credential: string): Promise<Client> {
  const headers = { Authorization: `Bearer ${credential}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: 'sdlc-board-paths-test', version: '0.0.0' });
  await client.connect(transport);
  return client;
}

type CallResult = Awaited<ReturnType<Client['callTool']>>;

function answer<T>(result: CallResult): T {
  const content = result.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content.find((part) => part.type === 'text')?.text ?? 'null') as T;
}

interface Submitted {
  claim: { state: string };
  result: { ok: boolean; files: string[]; problems: { code: string; file?: string }[] };
}

describe('B151: board_submit over MCP gets the same verdict as the CLI', () => {
  it('board_submit over MCP refuses an edited non-ASCII protected file and keeps the claim held', async () => {
    const p = project();
    const client = await connect(await serve(p.root, p.env), p.tokenOf('rep-a'));
    const claimed = await client.callTool({ name: 'board_claim',
      arguments: { change: 'add-farewell', task: '1.2', agent: 'leader-1' } });
    expect(claimed.isError, JSON.stringify(claimed.content)).toBeFalsy();
    const claim = answer<{ claim: { id: string } }>(claimed).claim;
    p.editProtected('edited-protected');
    const submitted = await client.callTool({ name: 'board_submit',
      arguments: { claim: claim.id, branch: 'edited-protected' } });
    const { result } = answer<Submitted>(submitted);
    const forbidden = result.problems.filter((problem) => problem.code === 'forbidden_path');
    expect(forbidden.map((problem) => problem.file), JSON.stringify(result)).toEqual([PROTECTED]);
    expect(result.files.filter((file) => file.includes('"') || file.includes('\\'))).toEqual([]);
    expect(submitted.isError).toBe(true);
    const listed = answer<{ tasks: { id: string; status: string }[] }>(
      await client.callTool({ name: 'board_list', arguments: {} }));
    expect(listed.tasks.find((task) => task.id === 'add-farewell#1.2')?.status).toBe('claimed');
    expect(p.log().filter((entry) => entry.event === 'task.submitted')).toEqual([]);
    await client.close();
  }, 240000);
});
