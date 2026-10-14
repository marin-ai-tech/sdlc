import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { HUMAN_COMMANDS } from '../src/core/help-catalog.js';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B118 (epic E16), the executor's identity. Customer decision: a person issues each executor its own token with
 * `sdlc task executors token <id>` (a human command); the token is printed once and only its SHA-256 is kept in
 * openspec/executors.yaml (`token_sha256`). `sdlc mcp serve --http` accepts, besides SDLC_MCP_TOKEN, the token of
 * an executor that is in the registry now: issuing a new token or removing the executor revokes the old one at once,
 * without a restart. The token never appears in any output but the issuing command's, and never in the log.
 */

const SERVER_TOKEN = 'server-token-0123456789';
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = [
  '# Executors a person allowed to take work (comments survive token issuing).',
  'executors:',
  '  swarm-a:',
  '    type: board',
  '    max_risk: medium',
  '  junior:',
  '    type: representative',
  '    max_risk: low',
  '',
].join('\n');
const running: ChildProcess[] = [];

afterEach(() => {
  for (const child of running.splice(0)) child.kill();
});

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function project(registry: string | undefined = REGISTRY) {
  const root = tempDir('sdlc-executor-tokens-');
  const env = humanEnv(tempDir('sdlc-home-'), { SDLC_MCP_TOKEN: SERVER_TOKEN });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/executors.yaml');
  if (registry !== undefined) write(file, registry);
  const issue = (id: string, extra: NodeJS.ProcessEnv = {}) =>
    cli(['task', 'executors', 'token', id, '--json'], extra);
  const tokenOf = (id: string) => {
    const r = issue(id);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    return r.json<{ executor: string; token: string }>().token;
  };
  const registryDoc = () => parse(read(file)) as { executors: Record<string, Record<string, unknown>> };
  return { root, env, file, cli, issue, tokenOf, registryDoc };
}

/** Starts the HTTP server and resolves with its URL from stderr; rejects when it exits first or after 60 s. */
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

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x', version: '0' } },
});

async function post(url: string, token: string): Promise<number> {
  const headers = {
    'content-type': 'application/json', accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
  const response = await fetch(url, { method: 'POST', headers, body: INITIALIZE });
  await response.text();
  return response.status;
}

describe('B118: a person issues an executor its token', () => {
  it('the token is printed once; only its hash is kept, comments and other executors survive', () => {
    const p = project();
    const token = p.tokenOf('swarm-a');
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    const text = read(p.file);
    expect(text).toContain('# Executors a person allowed to take work');
    expect(text).not.toContain(token);
    const doc = p.registryDoc();
    expect(doc.executors['swarm-a'].token_sha256).toBe(sha256(token));
    expect(doc.executors.junior).toEqual({ type: 'representative', max_risk: 'low' });
    const listed = p.cli(['task', 'executors', '--json'], AGENT);
    expect(listed.code, listed.stdout + listed.stderr).toBe(0);
    const executors = listed.json<{ executors: { id: string; hasToken: boolean }[] }>().executors;
    expect(executors.find((e) => e.id === 'swarm-a')?.hasToken).toBe(true);
    expect(executors.find((e) => e.id === 'junior')?.hasToken).toBe(false);
    expect(listed.stdout).not.toContain(token);
    expect(listed.stdout).not.toContain(sha256(token));
    const log = read(path.join(p.root, 'openspec/.sdlc/log.jsonl'));
    expect(log).toContain('executor.token_issued');
    expect(log).not.toContain(token);
  }, 240000);

  it('a new token replaces the old one', () => {
    const p = project();
    const first = p.tokenOf('swarm-a');
    const second = p.tokenOf('swarm-a');
    expect(second).not.toBe(first);
    expect(p.registryDoc().executors['swarm-a'].token_sha256).toBe(sha256(second));
  }, 240000);

  it('negative: an agent cannot issue a token, by the CLI or through the hook', () => {
    const p = project();
    const before = read(p.file);
    const r = p.issue('swarm-a', AGENT);
    expect(r.code).not.toBe(0);
    expect(r.json<{ status: { code: string }[] }>().status[0].code).toBe('agent_cannot_issue_token');
    expect(r.stdout).not.toMatch(/"token"/);
    expect(read(p.file)).toBe(before);
    expect(HUMAN_COMMANDS as readonly string[]).toContain('task executors token');
    const stdin = JSON.stringify({ cwd: p.root, tool_name: 'Bash',
      tool_input: { command: 'sdlc task executors token swarm-a' } });
    const out = p.cli(['hook', 'pre-tool'], AGENT, stdin).stdout.trim();
    expect(JSON.parse(out).hookSpecificOutput.permissionDecision).toBe('deny');
  }, 240000);

  it('negative: an unknown executor, no registry, a malformed hash', () => {
    const p = project();
    const code = (r: { json: <T>() => T }) => r.json<{ status: { code: string }[] }>().status[0].code;
    expect(code(p.issue('ghost'))).toBe('unknown_executor');
    write(p.file, REGISTRY.replace('    max_risk: medium', '    max_risk: medium\n    token_sha256: not-a-hash'));
    expect(code(p.cli(['task', 'executors', '--json'], AGENT))).toBe('executors_invalid');
    fs.rmSync(p.file);
    expect(code(p.issue('swarm-a'))).toBe('no_executor_registry');
  }, 240000);
});

describe('B118: the HTTP server knows executors by their token', () => {
  it('an executor token is accepted; a replaced token, an unknown one or a removed executor are not', async () => {
    const p = project();
    const first = p.tokenOf('swarm-a');
    const juniorToken = p.tokenOf('junior');
    const url = await serve(p.root, p.env);
    expect(await post(url, SERVER_TOKEN)).toBe(200);
    expect(await post(url, first)).toBe(200);
    expect(await post(url, juniorToken)).toBe(200);
    expect(await post(url, 'x'.repeat(40))).toBe(401);
    const second = p.tokenOf('swarm-a');
    expect(await post(url, first)).toBe(401);
    expect(await post(url, second)).toBe(200);
    const doc = read(p.file).replace(/ {2}junior:\n(?: {4}.*\n)+/, '');
    write(p.file, doc);
    expect(await post(url, juniorToken)).toBe(401);
    expect(await post(url, second)).toBe(200);
  }, 240000);

  it('negative: a broken registry fails closed for executor tokens, the server token still works', async () => {
    const p = project();
    const token = p.tokenOf('swarm-a');
    const url = await serve(p.root, p.env);
    write(p.file, `${read(p.file)}\n  broken: [\n`);
    expect(await post(url, token)).toBe(401);
    expect(await post(url, SERVER_TOKEN)).toBe(200);
  }, 240000);
});
