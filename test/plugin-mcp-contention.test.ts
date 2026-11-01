import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { BOARD_CHANGE, pluginBoard, pluginBoardBase, type PluginBoard } from './fixtures/plugin-board.js';
import { answer, boardHolder, bounded, connect, httpServer, retainOwner, stopAll, succeeded,
  type CallResult } from './fixtures/plugin-mcp-contention.js';
import { read } from './helpers.js';

let base: Awaited<ReturnType<typeof pluginBoardBase>>;
beforeAll(async () => { base = await pluginBoardBase(); }, 120000);

function project(name: string): PluginBoard {
  const fixture = pluginBoard(base);
  fixture.rawConfig(raw => { raw.project = { ...raw.project, name }; });
  return fixture;
}

async function wasm(fixture: PluginBoard): Promise<void> {
  await fixture.guard({ output: { decision: 'pass' }, facts: { remaining: 3 } }, { claim: 'read' });
}

function token(fixture: PluginBoard): string {
  return (fixture.ok(['task', 'executors', 'token', 'mesh-a']) as { token: string }).token;
}

async function parallelReads() {
  const fixture = project('plugin-reader');
  await wasm(fixture);
  const before = fixture.bytes();
  const clients: Client[] = [];
  const server = await httpServer([fixture.root], base.env);
  try {
    clients.push(await connect(server.url), await connect(server.url));
    const results = await bounded(Promise.all(clients.map(client => client.callTool({
      name: 'economy__read', arguments: { input: {} },
    }))), 20000);
    for (const result of results) {
      succeeded(result);
      expect(answer(result)).toMatchObject({ plugin: 'economy', output: { decision: 'pass' } });
      expect(answer(result)).not.toHaveProperty('transaction');
    }
    expect(fixture.bytes()).toEqual(before);
  } finally { await stopAll(server, undefined, clients); }
}

async function assertBound(client: Client, target: PluginBoard): Promise<void> {
  const denied = await client.callTool({ name: 'board_claim', arguments: {
    project: 'contention-target', change: BOARD_CHANGE, task: '1.1', agent: 'other-project',
  } });
  expect(denied.isError).toBe(true);
  expect(answer<{ status: { code: string }[] }>(denied).status[0].code).toBe('invalid_arguments');
  expect(target.board().claims).toEqual([]);
}

function assertSingleClaim(fixture: PluginBoard, other: PluginBoard, results: CallResult[]) {
  const claims = results.map(result => {
    succeeded(result);
    return answer<{ claim: { id: string; executor: string; agent: string } }>(result).claim;
  });
  expect(claims[0]).toMatchObject({ executor: 'mesh-a', agent: 'http-contender' });
  expect(claims[1].id).toBe(claims[0].id);
  expect(fixture.board().claims).toHaveLength(1);
  expect(fixture.events().filter(event => event.event === 'task.claimed')).toHaveLength(1);
  expect(other.board().claims).toEqual([]);
}

async function contendedClaim(plugins: boolean) {
  const fixture = project('contention-target');
  const other = project('other-project');
  if (plugins) await wasm(fixture);
  const auth = token(fixture);
  const otherAuth = token(other);
  const clients: Client[] = [];
  const server = await httpServer([fixture.root, other.root], base.env);
  let holder: Awaited<ReturnType<typeof boardHolder>> | undefined;
  try {
    clients.push(await connect(server.url, auth), await connect(server.url, auth));
    clients.push(await connect(server.url, otherAuth));
    await assertBound(clients[2], fixture);
    holder = await boardHolder(fixture.root, base.env);
    expect(JSON.parse(holder.owner).pid).toBe(holder.child.pid);
    await claimWhileHeld(fixture, other, clients, holder);
  } finally { await stopAll(server, holder, clients); }
}

async function claimWhileHeld(fixture: PluginBoard, other: PluginBoard, clients: Client[],
  holder: Awaited<ReturnType<typeof boardHolder>>) {
  const board = path.join(fixture.root, 'openspec/.sdlc/board.json');
  const before = fs.existsSync(board) ? read(board) : null;
  const args = { project: 'contention-target', change: BOARD_CHANGE, task: '1.1',
    agent: 'http-contender', request: `contention-${randomUUID()}` };
  let settled = 0;
  const pending = Promise.allSettled(clients.slice(0, 2).map(client => client.callTool({
    name: 'board_claim', arguments: args,
  }).finally(() => { settled++; })));
  await retainOwner(holder, before);
  expect(settled, 'authenticated claims must wait for the live owner').toBe(0);
  await holder.release();
  const results = await bounded(pending, 20000);
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
  const values = results.map(result => (result as PromiseFulfilledResult<CallResult>).value);
  assertSingleClaim(fixture, other, values);
}

describe('Plugin MCP transport contention', () => {
  it('two parallel read-only Wasm plugin calls over actual SDK/HTTP both succeed without writes',
    parallelReads, 120000);
  it.each([true, false])('authenticated HTTP claim waits beyond the old retry window; plugins=%s',
    contendedClaim, 120000);
});
