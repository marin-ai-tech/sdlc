import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { stringify, parse } from 'yaml';
import { claimTask } from '../dist/core/board.js';
import { bidTask } from '../dist/core/board-market.js';
import { readBoard } from '../dist/core/board-store.js';
import { resolveChange } from '../dist/core/changes.js';
import { loadConfig } from '../dist/core/config.js';
import { projectPaths } from '../dist/core/project.js';
import { exportItems } from '../dist/core/task-contract.js';
import { HarnessAdapter } from '../dist/executors/harness-adapter.js';
import { HarnessBundleHost } from '../dist/executors/harness-bundle-host.js';
import { HarnessRuntime } from '../dist/executors/harness-runtime.js';
import { callProjectTool, listedTools, servedProject } from '../dist/mcp/projects.js';
import { capturePackage } from '../dist/plugins/package.js';
import { runPrepared } from '../dist/plugins/evaluation.js';
import { FILES } from './farewell-fixture.js';
import { packageFiles } from './fixtures/plugin-modules.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const CHANGE = 'add-farewell';
const TASK_EXT = { economy: { scope: 'task', payload: { z: [2, 1], a: 3 } } };
const BID_EXT = { economy: { scope: 'bid', quote: 12, metadata: { z: [2, 1], a: 3 } } };
const TASK_SCHEMA = {
  type: 'object', required: ['scope', 'payload'], additionalProperties: false,
  properties: { scope: { const: 'task' }, payload: { type: 'object' } },
};
const BID_SCHEMA = {
  type: 'object', required: ['scope', 'quote', 'metadata'], additionalProperties: false,
  properties: { scope: { const: 'bid' }, quote: { type: 'integer' }, metadata: { type: 'object' } },
};

async function approvedFixture() {
  const root = tempDir('sdlc-ext-approved-fixture-');
  const env = humanEnv(tempDir('sdlc-ext-fixture-person-'));
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), '// original\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'initial fixture']);
  const cli = (args: string[]) => {
    const result = runCli([...args, '--json'], root, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result;
  };
  cli(['init', '--tools', 'codex']);
  const p = await packageFiles(root, { output: 42 }, { schemas: {
    config: true, state: true, facts: true, taskExt: TASK_SCHEMA, bidExt: BID_SCHEMA,
  } });
  const captured = capturePackage(root, p.source);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.plugins = { economy: { package: p.source, digest: captured.digest, enabled: true, config: {} } };
  config.verify.commands = [{ name: 'fixture', run: 'node -e "process.exit(0)"', required: true }];
  config.enforcement.mode = 'block';
  write(file, stringify(config));
  write(path.join(root, 'openspec/executors.yaml'), stringify({ executors: {
    'mesh-a': { type: 'mesh', max_risk: 'medium' },
    'mesh-b': { type: 'mesh', max_risk: 'medium' },
    hosted: { type: 'harness', max_risk: 'medium' },
  } }));
  cli(['plugins', 'accept', 'economy', '--expect-digest', captured.digest]);
  cli(['new', CHANGE, '--risk', 'medium']);
  const change = (name: string) => path.join(root, 'openspec/changes', CHANGE, name);
  write(change('intent.md'), FILES['intent.md']);
  cli(['approve', 'intent', '--change', CHANGE]);
  for (const name of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(name), FILES[name]);
  cli(['approve', 'spec', '--change', CHANGE]);
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 First task\n- [ ] 1.2 Second task\n');
  cli(['approve', 'plan', '--change', CHANGE]);
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'approved fixture source']);
  return { root, env };
}

let source: Awaited<ReturnType<typeof approvedFixture>>;

beforeAll(async () => { source = await approvedFixture(); }, 120000);

/** Copy only a genuine CLI-approved fixture, including its own local git history, into each isolated case. */
function fixture() {
  const root = tempDir('sdlc-ext-transport-');
  fs.cpSync(source.root, root, { recursive: true });
  const file = path.join(root, 'openspec/sdlc.yaml');
  const paths = projectPaths(root);
  const cli = (args: string[]) => runCli([...args, '--json'], root, source.env);
  const ok = (args: string[]) => {
    const result = cli(args);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    return result.json();
  };
  const board = () => readBoard(root);
  const bytes = () => [
    path.join(root, 'openspec/.sdlc/board.json'), path.join(root, 'openspec/.sdlc/log.jsonl'),
  ].map((file) => fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null);
  const claim = (ext?: unknown, request = 'transport:claim:0001', executor = 'mesh-a', task = '1.1') => [
    'board', 'claim', '--change', CHANGE, '--task', task, '--executor', executor, '--agent', 'peer',
    '--request', request, ...(ext === undefined ? [] : ['--ext-json', JSON.stringify(ext)]),
  ];
  const bid = (ext?: unknown, request = 'transport:bid:0001', executor = 'mesh-a', minutes = '12') => [
    'board', 'bid', '--change', CHANGE, '--task', '1.2', '--executor', executor, '--agent', 'peer',
    '--minutes', minutes, '--request', request, ...(ext === undefined ? [] : ['--ext-json', JSON.stringify(ext)]),
  ];
  const auction = () => ok(['board', 'auction', '--change', CHANGE, '--task', '1.2', '--window', '3600']);
  return { root, file, paths, cli, ok, board, bytes, claim, bid, auction };
}

describe('Extension transports through real CLI and core storage', () => {
  it('carries taskExt through export, claim, durable state and both receipt projections', () => {
    const p = fixture();
    const exported = p.ok(['task', 'export', '--change', CHANGE, '--task', '1.1', '--executor', 'mesh-a',
      '--ext-json', JSON.stringify(TASK_EXT)]).items[0];
    expect(exported.ext).toEqual(TASK_EXT);
    const claimed = p.ok(p.claim(TASK_EXT));
    expect(claimed.item.ext).toEqual(exported.ext);
    expect(claimed.claim.ext).toEqual(TASK_EXT);
    const stored = p.board();
    expect(stored.claims[0].ext).toEqual(TASK_EXT);
    const receipt = stored.requests.find((entry) => entry.key === 'transport:claim:0001')!;
    expect(receipt.value).toMatchObject({ item: { ext: TASK_EXT }, claim: { ext: TASK_EXT } });
    expect(receipt.result).toMatchObject({ item: { ext: TASK_EXT }, claim: { ext: TASK_EXT } });
    expect(p.ok(p.claim(TASK_EXT))).toEqual(claimed);
  });

  it('replays reordered taskExt and conflicts on changed values before writing anything', () => {
    const p = fixture();
    const first = p.ok(p.claim(TASK_EXT));
    const before = p.bytes();
    const reordered = { economy: { payload: { a: 3, z: [2, 1] }, scope: 'task' } };
    expect(p.ok(p.claim(reordered))).toEqual(first);
    expect(p.bytes()).toEqual(before);
    const changed = p.cli(p.claim({ economy: { scope: 'task', payload: { a: 4, z: [2, 1] } } }));
    expect(changed.code).not.toBe(0);
    expect(changed.json().status[0].code).toBe('request_conflict');
    expect(p.bytes()).toEqual(before);
  });

  it('preserves bidExt on replacements, auction storage and canonical receipt replay', () => {
    const p = fixture();
    p.auction();
    const first = p.ok(p.bid(BID_EXT));
    expect(first.bid.ext).toEqual(BID_EXT);
    const before = p.bytes();
    const reordered = { economy: { metadata: { a: 3, z: [2, 1] }, quote: 12, scope: 'bid' } };
    expect(p.ok(p.bid(reordered))).toEqual(first);
    expect(p.bytes()).toEqual(before);
    const changed = p.cli(p.bid({ economy: { ...BID_EXT.economy, quote: 13 } }));
    expect(changed.json().status[0].code).toBe('request_conflict');
    expect(p.bytes()).toEqual(before);
    const peer = p.ok(p.bid(BID_EXT, 'transport:bid:peer2', 'mesh-b', '20')).bid;
    const replacement = { economy: { ...BID_EXT.economy, quote: 15 } };
    p.ok(p.bid(replacement, 'transport:bid:replace', 'mesh-a', '10'));
    const stored = p.board();
    expect(stored.auctions[0].bids).toHaveLength(2);
    expect(stored.auctions[0].bids.find((bid) => bid.executor === 'mesh-b')).toEqual(peer);
    expect(stored.auctions[0].bids.find((bid) => bid.executor === 'mesh-a')?.ext).toEqual(replacement);
    const receipt = stored.requests.find((entry) => entry.key === 'transport:bid:replace')!;
    expect(receipt.value).toMatchObject({ ext: replacement });
    expect(receipt.result).toMatchObject({ bid: { ext: replacement } });
  });

  it('rejects unknown, invalid and prototype-shaped new input before board or log mutation', () => {
    const p = fixture();
    for (const ext of [{ unknown: {} }, BID_EXT, JSON.parse('{"economy":{"constructor":{}}}')]) {
      const before = p.bytes();
      const result = p.cli(p.claim(ext));
      expect(result.code, result.stdout + result.stderr).not.toBe(0);
      expect(result.json().status[0].code).toMatch(/^plugin_/);
      expect(p.bytes()).toEqual(before);
    }
    p.auction();
    const before = p.bytes();
    const result = p.cli(p.bid(TASK_EXT));
    expect(result.code).not.toBe(0);
    expect(result.json().status[0].code).toBe('plugin_schema');
    expect(p.bytes()).toEqual(before);
  });

  it('keeps disabled-plugin historical bid data opaque while refusing new extensions', () => {
    const p = fixture();
    p.auction();
    p.ok(p.bid(BID_EXT));
    const raw = parse(read(p.file));
    raw.plugins.economy.enabled = false;
    write(p.file, stringify(raw));
    expect(p.board().auctions[0].bids[0].ext).toEqual(BID_EXT);
    const before = p.bytes();
    const result = p.cli(p.bid(BID_EXT, 'transport:bid:disabled'));
    expect(result.code).not.toBe(0);
    expect(result.json().status[0].code).toMatch(/^plugin_/);
    expect(p.bytes()).toEqual(before);
    expect(p.board().auctions[0].bids[0].ext).toEqual(BID_EXT);
  });

  it('does not synthesize ext in unextended task, claim, bid or receipts', () => {
    const p = fixture();
    const item = p.ok(['task', 'export', '--change', CHANGE, '--task', '1.1', '--executor', 'mesh-a']).items[0];
    expect(item).not.toHaveProperty('ext');
    const claimed = p.ok(p.claim());
    expect(claimed.item).not.toHaveProperty('ext');
    expect(claimed.claim).not.toHaveProperty('ext');
    p.auction();
    expect(p.ok(p.bid()).bid).not.toHaveProperty('ext');
    const stored = p.board();
    expect(stored.claims[0]).not.toHaveProperty('ext');
    expect(stored.auctions[0].bids[0]).not.toHaveProperty('ext');
    expect(JSON.stringify(stored.requests)).not.toContain('"ext"');
  });

  it('keeps independently declared bidExt out of a winning task contract', () => {
    const p = fixture();
    p.auction();
    p.ok(p.bid(BID_EXT));
    p.ok(['board', 'award', '--change', CHANGE, '--task', '1.2', '--executor', 'mesh-a']);
    const awarded = p.ok(p.claim(undefined, 'transport:claim:awarded', 'mesh-a', '1.2'));
    expect(awarded.item).not.toHaveProperty('ext');
    expect(awarded.claim).not.toHaveProperty('ext');
    const explicit = p.ok(p.claim(TASK_EXT, 'transport:claim:explicit'));
    expect(explicit.item.ext).toEqual(TASK_EXT);
  });
});

describe('Prepared synchronous core API binding', () => {
  it('carries independently prepared taskExt and bidExt through the actual core entry points', async () => {
    const p = fixture();
    const config = loadConfig(p.file);
    const ref = resolveChange(p.paths, CHANGE);
    const actor = { origin: 'cli' as const, executor: 'mesh-a' };
    const exportArgs = { change: CHANGE, task: '1.1', executor: 'mesh-a', ext: TASK_EXT };
    const exported = await runPrepared(p.root, config,
      { operation: 'export', args: exportArgs, actor, board: false },
      () => exportItems(p.root, ref, config, '1.1', 'mesh-a', TASK_EXT));
    expect(exported.items[0].ext).toEqual(TASK_EXT);
    const claimOpts = { change: CHANGE, task: '1.1', executor: 'mesh-a', agent: 'peer', ext: TASK_EXT,
      request: 'transport:core:claim' };
    const claimed = await runPrepared(p.root, config,
      { operation: 'claim', args: claimOpts, actor, board: true },
      () => claimTask(p.root, p.paths, config, claimOpts));
    expect(claimed.item.ext).toEqual(TASK_EXT);
    p.auction();
    const bidOpts = { change: CHANGE, task: '1.2', executor: 'mesh-a', agent: 'peer', minutes: '12',
      ext: BID_EXT, request: 'transport:core:bid' };
    const bid = await runPrepared(p.root, config,
      { operation: 'bid', args: bidOpts, actor, board: true },
      () => bidTask(p.root, p.paths, config, bidOpts));
    expect(bid.ext).toEqual(BID_EXT);
    expect(p.board().auctions[0].bids[0].ext).toEqual(BID_EXT);
  });

  it('refuses missing or mismatched new-extension preparation without persisting anything', async () => {
    const p = fixture();
    const config = loadConfig(p.file);
    const ref = resolveChange(p.paths, CHANGE);
    const before = p.bytes();
    expect(() => exportItems(p.root, ref, config, '1.1', 'mesh-a', TASK_EXT)).toThrow();
    expect(p.bytes()).toEqual(before);
    const prepared = { change: CHANGE, task: '1.1', executor: 'mesh-a', agent: 'peer', ext: TASK_EXT,
      request: 'transport:core:mismatch' };
    const actual = { ...prepared, ext: { economy: { scope: 'task', payload: { a: 99 } } } };
    await expect(runPrepared(p.root, config, { operation: 'claim', args: prepared,
      actor: { origin: 'cli', executor: 'mesh-a' }, board: true },
    () => claimTask(p.root, p.paths, config, actual))).rejects.toThrow();
    expect(p.bytes()).toEqual(before);
  });
});

describe('Harness task payload and exact source comparison', () => {
  it('preserves taskExt in the runtime payload, accepts reordered keys and rejects changed values', async () => {
    const p = fixture();
    const claim = p.ok(p.claim(TASK_EXT, 'transport:claim:hosted', 'hosted'));
    const config = loadConfig(p.file);
    const ref = resolveChange(p.paths, CHANGE);
    const inputs: string[] = [];
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls++;
      const route = String(url);
      if (route.endsWith('/input')) inputs.push(JSON.parse(String(init?.body)).text);
      const value = route.endsWith('/sessions/local')
        ? { session_id: 'local', status: 'SESSION_STATUS_READY' }
        : { exit_code: 0, stdout: 'false', stderr: '' };
      return new Response(JSON.stringify(value), { status: 200 });
    };
    const runtime = new HarnessRuntime('fixture-only-host-token', fetcher);
    const host = new HarnessBundleHost({ root: p.root, config, ref, claim, runtime, tool: 'codex' });
    const adapter = new HarnessAdapter(runtime, host);
    const reordered = { ...claim.item, ext: { economy: { payload: { a: 3, z: [2, 1] }, scope: 'task' } } };
    await adapter.launch('local', reordered);
    expect(inputs).toHaveLength(1);
    expect(JSON.parse(inputs[0]).ext).toEqual(TASK_EXT);
    expect(inputs[0]).not.toContain(claim.claim.id);
    expect(inputs[0]).not.toContain('fixture-only-host-token');
    const before = calls;
    const changed = { ...claim.item, ext: { economy: { scope: 'task', payload: { a: 99 } } } };
    await expect(host.prepare('local', changed)).rejects.toMatchObject({ code: 'harness_refused' });
    expect(calls).toBe(before);
  });
});

describe('Structured MCP extension arguments', () => {
  it('carries structured task/bid ext through project routing and the real CLI without accepting executor input',
    async () => {
      const p = fixture();
      const served = servedProject(p.root);
      const caller = { project: served.name, executor: 'mesh-a' };
      const run = async (args: string[], root: string) => {
        const result = runCli(args, root, source.env);
        return { code: result.code ?? undefined, stdout: result.stdout, stderr: result.stderr };
      };
      const tools = await listedTools([served], caller);
      for (const name of ['board_claim', 'board_bid']) {
        expect(Object.keys(tools.find((tool) => tool.name === name)!.inputSchema.properties)).toContain('ext');
      }
      const args = { change: CHANGE, task: '1.1', agent: 'peer', request: 'transport:mcp:claim', ext: TASK_EXT };
      const claimed = await callProjectTool('board_claim', args, [served], run, caller);
      expect(claimed.isError, JSON.stringify(claimed)).not.toBe(true);
      expect(claimed.structuredContent).toMatchObject({ item: { ext: TASK_EXT }, claim: { ext: TASK_EXT } });
      const before = p.bytes();
      const forged = await callProjectTool('board_claim', { ...args, executor: 'mesh-b' }, [served], run, caller);
      expect(forged.isError).toBe(true);
      expect(p.bytes()).toEqual(before);
      p.auction();
      const bid = await callProjectTool('board_bid', { change: CHANGE, task: '1.2', agent: 'peer', minutes: 12,
        request: 'transport:mcp:bid', ext: BID_EXT }, [served], run, caller);
      expect(bid.isError, JSON.stringify(bid)).not.toBe(true);
      expect(bid.structuredContent).toMatchObject({ bid: { executor: 'mesh-a', ext: BID_EXT } });
      expect(p.board().auctions[0].bids[0].ext).toEqual(BID_EXT);
    });
});
