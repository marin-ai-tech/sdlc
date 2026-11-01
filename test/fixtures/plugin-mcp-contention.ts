import { spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect } from 'vitest';
import { BIN, read } from '../helpers.js';

const SERVER_TOKEN = 'e20-contention-server-token';
type Owned = ReturnType<typeof own>;
export type CallResult = Awaited<ReturnType<Client['callTool']>>;

export async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${milliseconds}ms`)), milliseconds);
  });
  try { return await Promise.race([work, timeout]); }
  finally { clearTimeout(timer!); }
}

function own(child: ChildProcess) {
  let stderr = '';
  child.stderr?.on('data', chunk => { stderr += chunk; });
  const ended = new Promise<number | null>(resolve => {
    child.once('exit', resolve);
    child.once('error', error => {
      stderr += error.message;
      resolve(-1);
    });
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
  const stop = async () => {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await bounded(ended, 5000);
  };
  return { child, ended, stop, stderr: () => stderr };
}

async function until(ready: () => boolean, milliseconds = 15000): Promise<void> {
  const deadline = performance.now() + milliseconds;
  while (!ready()) {
    if (performance.now() >= deadline) throw new Error('Expected child readiness or writer contention');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function httpServer(roots: string[], env: NodeJS.ProcessEnv) {
  const args = [BIN, 'mcp', 'serve', '--http', '127.0.0.1:0'];
  for (const root of roots) args.push('--project', root);
  const owned = own(spawn(process.execPath, args, {
    cwd: roots[0], env: { ...env, SDLC_MCP_TOKEN: SERVER_TOKEN }, windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe'],
  }));
  try {
    await until(() => /http:\/\/127\.0\.0\.1:\d+\/mcp/.test(owned.stderr()));
    const url = /http:\/\/127\.0\.0\.1:\d+\/mcp/.exec(owned.stderr())![0];
    return { ...owned, url };
  } catch (error) {
    await owned.stop();
    throw new Error(`${String(error)}: ${owned.stderr()}`);
  }
}

export async function connect(url: string, token = SERVER_TOKEN): Promise<Client> {
  const headers = { Authorization: `Bearer ${token}` };
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: 'e20-contention-proof', version: '0.0.0' });
  try {
    await bounded(client.connect(transport), 15000);
    return client;
  } catch (error) {
    await bounded(client.close(), 2000);
    throw error;
  }
}

export async function closeClients(clients: Client[]): Promise<void> {
  await Promise.all(clients.map(client => bounded(client.close(), 2000)));
}

export function answer<T>(result: CallResult): T {
  const parts = result.content as Array<{ type: string; text?: string }>;
  const text = parts.find(part => part.type === 'text')?.text;
  return JSON.parse(text ?? 'null') as T;
}

export function succeeded(result: CallResult): void {
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
}

function holderSource(): string {
  const module = new URL('../../dist/core/writer-lock.js', import.meta.url).href;
  return [
    "import fs from 'node:fs';",
    `const {acquireWriterLock}=await import(${JSON.stringify(module)});`,
    'const file=process.argv[1];',
    'const lease=acquireWriterLock(file,10000);',
    'let checks=0;',
    'let intact=true;',
    'const inspect=()=>{checks++;intact=intact&&fs.readFileSync(file,"utf8")===lease.owner;};',
    'const watcher=setInterval(inspect,10);',
    'const finish=code=>{clearInterval(watcher);inspect();lease.release();',
    'process.send({released:true,intact,checks},()=>process.exit(code));};',
    'process.once("message",()=>finish(0));',
    'setTimeout(()=>finish(2),25000);',
    'process.send({owner:lease.owner});',
  ].join('\n');
}

export async function boardHolder(root: string, env: NodeJS.ProcessEnv) {
  const file = path.join(root, 'openspec/.sdlc/board.lock');
  const owned = own(spawn(process.execPath, ['--input-type=module', '-e', holderSource(), file], {
    cwd: root, env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  }));
  let owner = '';
  let released: { intact: boolean; checks: number } | undefined;
  owned.child.on('message', message => {
    const value = message as { owner?: string; released?: boolean; intact: boolean; checks: number };
    if (value.owner) owner = value.owner;
    if (value.released) released = value;
  });
  try { await until(() => owner !== ''); }
  catch (error) {
    await owned.stop();
    throw new Error(`${String(error)}: ${owned.stderr()}`);
  }
  const release = async () => {
    owned.child.send('release');
    expect(await bounded(owned.ended, 5000), owned.stderr()).toBe(0);
    expect(released).toMatchObject({ intact: true });
    expect(released!.checks).toBeGreaterThan(20);
  };
  return { ...owned, file, owner, release };
}

export async function retainOwner(holder: Awaited<ReturnType<typeof boardHolder>>, boardBytes: string | null) {
  const writers = `${holder.file}.writers`;
  await until(() => fs.readdirSync(writers).filter(name => name.endsWith('.json')).length > 1);
  const board = path.join(path.dirname(holder.file), 'board.json');
  const deadline = performance.now() + 2000;
  while (performance.now() < deadline) {
    expect(read(holder.file)).toBe(holder.owner);
    expect(fs.existsSync(board) ? read(board) : null).toBe(boardBytes);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

export async function stopAll(server: Owned | undefined, holder?: Owned, clients: Client[] = []): Promise<void> {
  try { await closeClients(clients); }
  finally {
    try { await holder?.stop(); }
    finally { await server?.stop(); }
  }
}
