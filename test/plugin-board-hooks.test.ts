import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { claimTask, boardTasks, submitClaim } from '../dist/core/board.js';
import { openAuction, bidTask, awardTask } from '../dist/core/board-market.js';
import { dispatchTask } from '../dist/core/board-dispatch.js';
import { boardSnapshot } from '../dist/core/board-view.js';
import { resolveChange } from '../dist/core/changes.js';
import { checkResult } from '../dist/core/task-result.js';
import { headCommit } from '../dist/core/git.js';
import { callPlugin } from '../dist/plugins/broker.js';
import { prepareEvaluation, executePrepared } from '../dist/plugins/evaluation.js';
import * as runtime from '../dist/plugins/runtime.js';
import { git, runCli, write } from './helpers.js';
import { BOARD_CHANGE, pluginBoardBase, pluginBoard, pluginId, type PluginBoard } from './fixtures/plugin-board.js';

let base: Awaited<ReturnType<typeof pluginBoardBase>>;
beforeAll(async () => { base = await pluginBoardBase(); }, 120000);
afterEach(() => vi.restoreAllMocks());

const pass = { output: { decision: 'pass' } };
const deny = { output: { decision: 'deny', code: 'fixture_denied', message: 'Fixture restriction' } };
const loop = { call: '(loop $forever (br $forever)) (i64.const 0)' };
const claimOptions = (task = '1.1', request?: string) => ({
  change: BOARD_CHANGE, task, executor: 'mesh-a', agent: 'peer', ...(request ? { request } : {}),
});

async function claim(p: PluginBoard, task = '1.1', request?: string) {
  const opts = claimOptions(task, request);
  return p.prepared('claim', opts, () => claimTask(p.root, p.paths, p.config(), opts));
}

async function auction(p: PluginBoard) {
  const opts = { change: BOARD_CHANGE, task: '1.2', window: '3600' };
  const opened = await p.prepared('auction', opts, () => openAuction(p.root, p.paths, p.config(), opts));
  for (const [executor, minutes] of [['mesh-a', '5'], ['mesh-b', '20']]) {
    const bid = { change: BOARD_CHANGE, task: '1.2', executor, agent: 'peer', minutes };
    await p.prepared('bid', bid, () => bidTask(p.root, p.paths, p.config(), bid), executor);
  }
  return Date.parse(opened.closesAt) + 1;
}

async function at<T>(now: number, action: () => Promise<T>): Promise<T> {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try { return await action(); } finally { clock.mockRestore(); }
}

async function list(p: PluginBoard) {
  return p.prepared('list', { change: BOARD_CHANGE },
    () => boardTasks(p.root, p.paths, p.config(), BOARD_CHANGE));
}

describe('Elapsed award acceptance and read-only pending projections', () => {
  it('consumes a denied selected winner exactly once, with no reservation, fallback or award event', async () => {
    const p = pluginBoard(base);
    await p.guard(deny, { award: 'read' });
    const elapsed = await auction(p);
    const calls = vi.spyOn(runtime, 'invoke');
    await at(elapsed, () => list(p));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(p.board().auctions).toEqual([]);
    expect(p.board().dispatches).toEqual([]);
    expect(p.board().claims).toEqual([]);
    expect(p.events().filter((e) => e.event === 'task.award_refused'))
      .toMatchObject([{ task: '1.2', executor: 'mesh-a' }]);
    expect(p.events().filter((e) => e.event === 'task.awarded')).toEqual([]);
    const before = p.bytes();
    await at(elapsed, () => list(p));
    expect(calls).toHaveBeenCalledTimes(1);
    expect(p.bytes()).toEqual(before);
    expect(p.events().filter((e) => e.event === 'task.award_refused')).toHaveLength(1);
  });

  it('keeps elapsed awards pending in read-only views without running guests or writing bytes', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { award: 'read' }, loop);
    const elapsed = await auction(p);
    const calls = vi.spyOn(runtime, 'invoke');
    const before = p.bytes();
    const metadata = () => ['board.json', 'log.jsonl', 'plugins/registry.json', 'plugins/state/economy/store.json']
      .map((file) => {
        const stat = fs.statSync(path.join(p.root, 'openspec/.sdlc', file));
        return { mtime: stat.mtimeMs, ctime: stat.ctimeMs, size: stat.size, ino: stat.ino };
      });
    const unchangedFiles = metadata();
    const view = boardSnapshot(p.root, p.paths, p.config(), new Date(elapsed), BOARD_CHANGE)!;
    expect(view.tasks.find((task) => task.id === `${BOARD_CHANGE}#1.2`))
      .toMatchObject({ status: 'auction' });
    expect(view.tasks.find((task) => task.id === `${BOARD_CHANGE}#1.2`)).not.toHaveProperty('executor');
    expect(calls).not.toHaveBeenCalled();
    expect(p.bytes()).toEqual(before);
    expect(metadata()).toEqual(unchangedFiles);
  });

  it('leaves the complete board and event bytes intact when an elapsed award guest times out', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { award: 'read' }, loop);
    const elapsed = await auction(p);
    const before = p.bytes();
    await expect(at(elapsed, () => list(p))).rejects.toMatchObject({ code: 'plugin_timeout' });
    expect(p.bytes()).toEqual(before);
    expect(p.board().auctions).toHaveLength(1);
    expect(p.board().dispatches).toEqual([]);
    expect(p.events().filter((e) => ['task.awarded', 'task.award_refused'].includes(e.event))).toEqual([]);
  });

  it('rejects a stale authentic context before consuming the elapsed auction or writing observations', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { award: 'read' });
    const elapsed = await auction(p);
    await at(elapsed, async () => {
      const work = () => boardTasks(p.root, p.paths, p.config(), BOARD_CHANGE);
      const token = await prepareEvaluation(p.root, p.config(), {
        operation: 'list', args: { change: BOARD_CHANGE }, actor: { origin: 'cli', executor: 'mesh-a' }, board: true,
      }, work);
      expect(token).toBeDefined();
      fs.appendFileSync(path.join(p.root, 'openspec/changes', BOARD_CHANGE, 'plan.md'), '\nChanged after preparation.\n');
      const before = p.bytes();
      const calls = vi.spyOn(runtime, 'invoke');
      expect(() => executePrepared(token, work)).toThrow(expect.objectContaining({ code: 'plugin_evaluation_stale' }));
      expect(calls).not.toHaveBeenCalled();
      expect(p.bytes()).toEqual(before);
      expect(p.board().auctions).toHaveLength(1);
    });
  });

  it('honors revocation committed after preparation and before elapsed-award consumption', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { award: 'read' });
    const elapsed = await auction(p);
    await at(elapsed, async () => {
      const work = () => boardTasks(p.root, p.paths, p.config(), BOARD_CHANGE);
      const token = await prepareEvaluation(p.root, p.config(), {
        operation: 'list', args: { change: BOARD_CHANGE }, actor: { origin: 'cli', executor: 'mesh-a' }, board: true,
      }, work);
      p.ok(['plugins', 'revoke', 'economy']);
      const before = p.bytes();
      const calls = vi.spyOn(runtime, 'invoke');
      expect(() => executePrepared(token, work)).toThrow(expect.objectContaining({ code: 'plugin_unaccepted' }));
      expect(calls).not.toHaveBeenCalled();
      expect(p.bytes()).toEqual(before);
      expect(p.board().auctions).toHaveLength(1);
      expect(p.board().dispatches).toEqual([]);
    });
  });

  it('refuses a pre-expiry context once clock eligibility changes without invoking the newly due guest', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { award: 'read' }, loop);
    const elapsed = await auction(p);
    const work = () => boardTasks(p.root, p.paths, p.config(), BOARD_CHANGE);
    const token = await prepareEvaluation(p.root, p.config(), {
      operation: 'list', args: { change: BOARD_CHANGE }, actor: { origin: 'cli', executor: 'mesh-a' }, board: true,
    }, work);
    const before = p.bytes();
    const calls = vi.spyOn(runtime, 'invoke');
    await at(elapsed, async () => {
      expect(() => executePrepared(token, work)).toThrow(expect.objectContaining({ code: 'plugin_evaluation_stale' }));
    });
    expect(calls).not.toHaveBeenCalled();
    expect(p.bytes()).toEqual(before);
    expect(p.board().auctions).toHaveLength(1);
  });
});

describe('Historical replay and authentic operation contexts', () => {
  it('replays an exact successful claim after revocation without a guest, write or new event', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { claim: 'read' });
    const first = await claim(p, '1.1', 'hook-fixture:claim:receipt');
    p.ok(['plugins', 'revoke', 'economy']);
    const before = p.bytes();
    const calls = vi.spyOn(runtime, 'invoke');
    expect(await claim(p, '1.1', 'hook-fixture:claim:receipt')).toEqual(first);
    expect(calls).not.toHaveBeenCalled();
    expect(p.bytes()).toEqual(before);
    expect(p.events().filter((e) => e.event === 'task.claimed')).toHaveLength(1);
    await expect(claim(p, '1.3', 'hook-fixture:claim:fresh')).rejects.toMatchObject({ code: 'plugin_unaccepted' });
    expect(p.bytes()).toEqual(before);
  });

  it('refuses forged, wrong-operation and reused contexts without additional board changes', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { claim: 'read' });
    const work = () => boardTasks(p.root, p.paths, p.config(), BOARD_CHANGE);
    const binding = { operation: 'list', args: { change: BOARD_CHANGE },
      actor: { origin: 'cli' as const, executor: 'mesh-a' }, board: true };
    const forged = {} as Parameters<typeof executePrepared>[0];
    const before = p.bytes();
    expect(() => executePrepared(forged, work)).toThrow(expect.objectContaining({ code: 'plugin_evaluation_context' }));
    const wrong = await prepareEvaluation(p.root, p.config(), binding, work);
    const opts = claimOptions();
    expect(() => executePrepared(wrong, () => claimTask(p.root, p.paths, p.config(), opts)))
      .toThrow(expect.objectContaining({ code: 'plugin_evaluation_context' }));
    expect(p.bytes()).toEqual(before);
    const token = await prepareEvaluation(p.root, p.config(), binding, work);
    executePrepared(token, work);
    const consumed = p.bytes();
    expect(() => executePrepared(token, work)).toThrow(expect.objectContaining({ code: 'plugin_evaluation_context' }));
    expect(p.bytes()).toEqual(consumed);
  });

  it('preserves core executor refusal precedence without invoking an otherwise looping guest', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { claim: 'read' }, loop);
    const opts = { ...claimOptions(), executor: 'unknown' };
    const calls = vi.spyOn(runtime, 'invoke');
    const before = p.bytes();
    await expect(p.prepared('claim', opts, () => claimTask(p.root, p.paths, p.config(), opts)))
      .rejects.toMatchObject({ code: 'unknown_executor' });
    expect(calls).not.toHaveBeenCalled();
    expect(p.board().claims).toEqual([]);
    expect(p.events().filter((e) => e.event === 'task.claimed')).toEqual([]);
    expect(p.bytes()['plugins/state/economy/store.json']).toEqual(before['plugins/state/economy/store.json']);
  });
});

describe('Real economy guard and declarative fact restrictions', () => {
  it('rejects a captured claim verdict after the real plugin state revision changes', async () => {
    const p = pluginBoard(base);
    p.economy();
    const opts = claimOptions();
    const work = () => claimTask(p.root, p.paths, p.config(), opts);
    const token = await prepareEvaluation(p.root, p.config(), {
      operation: 'claim', args: opts, actor: { origin: 'cli', executor: 'mesh-a' }, board: true,
    }, work);
    await callPlugin(p.root, p.config(), 'economy', 'record', { units: 1 },
      { origin: 'cli', executor: 'mesh-a' }, pluginId());
    const before = p.bytes();
    const calls = vi.spyOn(runtime, 'invoke');
    expect(() => executePrepared(token, work)).toThrow(expect.objectContaining({ code: 'plugin_evaluation_stale' }));
    expect(calls).not.toHaveBeenCalled();
    expect(p.bytes()).toEqual(before);
    expect(p.board().claims).toEqual([]);
    expect(p.events().filter((e) => e.event === 'task.claimed')).toEqual([]);
  });

  it('allows an affordable claim, applies a stricter fact policy and refuses an exhausted allowance', async () => {
    const p = pluginBoard(base);
    p.economy([{ id: 'two-units-left', hook: 'claim',
      require: { fact: 'economy.remaining', op: 'gte', value: 2 }, reason: 'Reserve at least two demo units' }]);
    expect((await claim(p)).claim.state).toBe('held');
    const record = (units: number) => callPlugin(p.root, p.config(), 'economy', 'record', { units },
      { origin: 'cli', executor: 'mesh-a' }, pluginId());
    await record(2);
    const beforePolicy = p.bytes()['plugins/state/economy/store.json'];
    await expect(claim(p, '1.3')).rejects.toMatchObject({ code: 'plugin_refused',
      message: expect.stringContaining('Reserve at least two demo units') });
    expect(p.bytes()['plugins/state/economy/store.json']).toBe(beforePolicy);
    await record(1);
    const beforeGuard = p.bytes()['plugins/state/economy/store.json'];
    await expect(claim(p, '1.4')).rejects.toMatchObject({ code: 'plugin_refused',
      message: expect.stringContaining('Demo limit exhausted') });
    expect(p.bytes()['plugins/state/economy/store.json']).toBe(beforeGuard);
    expect(p.board().claims).toHaveLength(1);
    expect(p.events().filter((e) => e.event === 'task.claimed')).toHaveLength(1);
  });

  it('refuses an unavailable fact beneath negation before any board or log mutation', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { claim: 'read' }, {}, [{ id: 'missing-under-not', hook: 'claim',
      require: { not: { fact: 'economy.remaining', op: 'gt', value: 0 } }, reason: 'Missing facts cannot allow' }]);
    const before = p.bytes();
    await expect(claim(p)).rejects.toMatchObject({ code: 'plugin_fact_missing' });
    expect(p.bytes()).toEqual(before);
  });
});

describe('Pure restrictions at each mutable board seam', () => {
  it('allows core-valid claim, bid, manual award and dispatch with pure passing hooks', async () => {
    const p = pluginBoard(base);
    await p.guard(pass, { claim: 'read', bid: 'read', award: 'read' });
    const store = p.bytes()['plugins/state/economy/store.json'];
    expect((await claim(p)).claim.state).toBe('held');
    await auction(p);
    const awarded = { change: BOARD_CHANGE, task: '1.2', executor: 'mesh-a' };
    await p.prepared('award', awarded, () => awardTask(p.root, p.paths, p.config(), awarded));
    const dispatched = { change: BOARD_CHANGE, task: '1.3', executor: 'mesh-b' };
    await p.prepared('dispatch', dispatched, () => dispatchTask(p.root, p.paths, p.config(), dispatched), 'mesh-b');
    expect(p.board().claims).toHaveLength(1);
    expect(p.board().dispatches).toMatchObject([
      { task: '1.2', executor: 'mesh-a' }, { task: '1.3', executor: 'mesh-b' },
    ]);
    expect(p.events().filter((e) => e.event === 'task.bid')).toHaveLength(2);
    expect(p.events().filter((e) => e.event === 'task.awarded')).toHaveLength(1);
    expect(p.events().filter((e) => e.event === 'task.dispatched')).toHaveLength(1);
    expect(p.bytes()['plugins/state/economy/store.json']).toBe(store);
  });

  it.each(['claim', 'bid', 'award', 'dispatch'] as const)('refuses %s without creating its positive effect',
    async (surface) => {
      const p = pluginBoard(base);
      const hook = surface === 'dispatch' ? 'award' : surface;
      await p.guard(deny, { [hook]: 'read' });
      if (surface === 'bid' || surface === 'award') {
        const opts = { change: BOARD_CHANGE, task: '1.2', window: '3600' };
        await p.prepared('auction', opts, () => openAuction(p.root, p.paths, p.config(), opts));
      }
      const before = p.board();
      const action = () => {
        if (surface === 'claim') return claim(p);
        const opts = { change: BOARD_CHANGE, task: surface === 'dispatch' ? '1.3' : '1.2', executor: 'mesh-a' };
        if (surface === 'award') return p.prepared('award', opts,
          () => awardTask(p.root, p.paths, p.config(), opts));
        if (surface === 'dispatch') return p.prepared('dispatch', opts,
          () => dispatchTask(p.root, p.paths, p.config(), opts));
        const bid = { ...opts, agent: 'peer', minutes: '5' };
        return p.prepared('bid', bid, () => bidTask(p.root, p.paths, p.config(), bid));
      };
      await expect(action()).rejects.toMatchObject({ code: 'plugin_refused' });
      expect(p.board()).toEqual(before);
      expect(p.events().filter((e) => ['task.claimed', 'task.bid', 'task.awarded', 'task.dispatched'].includes(e.event)))
        .toEqual([]);
    });
});

describe('Plugin errors explicitly deny native edits, shell writes and repeated stop', () => {
  it.each(['invalid-output', 'infinite-loop'] as const)('%s never reaches the legacy allow fallback', async (fault) => {
    const p = pluginBoard(base);
    await p.guard({ output: { decision: 'allow' } }, { file_edit: 'read', stop: 'read' },
      fault === 'infinite-loop' ? loop : {});
    for (const call of [
      { tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'src/greet.js'),
        old_string: 'original', new_string: 'changed' } },
      { tool_name: 'Bash', tool_input: { command: 'echo fixture > src/greet.js' } },
    ]) {
      const answer = p.hook('pre-tool', call);
      expect(answer.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(answer.hookSpecificOutput.permissionDecisionReason).toMatch(/plugin_(hook|timeout)/);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const answer = p.hook('stop', { stop_hook_active: true });
      expect(answer.decision).toBe('block');
      expect(answer.reason).toMatch(/plugin_(hook|timeout)/);
    }
    expect(fs.readFileSync(path.join(p.root, 'src/greet.js'), 'utf8')).toBe('// original\n');
    expect(p.board().claims).toEqual([]);
  });
});

describe('Shared result restrictions', () => {
  it.each(['denial', 'fault'])('reports the same plugin %s for standalone and submission and keeps the claim held', async (mode) => {
    const p = pluginBoard(base);
    await p.guard(mode === 'denial' ? deny : { output: { decision: 'allow' } }, { result_accept: 'read' });
    const held = await claim(p);
    git(p.root, ['checkout', '-qb', 'candidate']);
    write(path.join(p.root, 'src/greet.js'), '// candidate\n');
    git(p.root, ['add', 'src/greet.js']);
    git(p.root, ['commit', '-qm', 'candidate\n\nSDLC-Change: add-farewell\nSDLC-Task: 1.1\nSDLC-Agent: mesh-a/peer']);
    git(p.root, ['checkout', '-q', 'main']);
    const ref = resolveChange(p.paths, BOARD_CHANGE);
    const before = p.bytes();
    const args = { change: BOARD_CHANGE, branch: 'candidate', base: held.item.base.commit, executor: 'mesh-a' };
    const standalone = await p.prepared('result', args,
      () => checkResult(p.root, ref, p.config(), args.branch, args.base, args.executor));
    expect(standalone.ok).toBe(false);
    expect(standalone.problems).toMatchObject([{ code: 'plugin_refused', plugin: { name: 'economy' } }]);
    if (mode === 'fault') {
      const cli = runCli(['task', 'check-result', '--change', BOARD_CHANGE, '--branch', args.branch,
        '--base', args.base, '--json'], p.root, base.env);
      expect(cli.code).toBe(1);
      expect(cli.json()).toMatchObject({ ok: false, problems: standalone.problems });
    }
    const submission = { claim: held.claim.id, branch: args.branch, base: args.base, executor: 'mesh-a', request: undefined };
    const submitted = await p.prepared('submit', submission,
      () => submitClaim(p.root, p.paths, p.config(), held.claim.id, args.branch, args.base, 'mesh-a'));
    expect(submitted.result.ok).toBe(false);
    expect(submitted.result.problems).toEqual(standalone.problems);
    expect(p.board().claims[0].state).toBe('held');
    expect(p.events().filter((e) => e.event === 'task.submitted')).toEqual([]);
    if (mode === 'fault') expect(p.bytes()).toEqual(before);
  });
});

describe('Guarded fact policies without an enabled plugin namespace', () => {
  it('blocks repeated stop on malformed settings that contain only a plugin fact policy', () => {
    const p = pluginBoard(base);
    p.rawConfig((raw) => {
      delete raw.plugins;
      raw.plugin_policies = [{ id: 'stop-budget', hook: 'stop', reason: 'Budget is required',
        require: { fact: 'budget.ready', op: 'eq', value: true } }];
    });
    fs.appendFileSync(p.file, '\nbroken: [\n');
    expect(p.hook('stop', { stop_hook_active: true }).decision).toBe('block');
  });

  it('refuses a CLI claim with plugin_fact_missing beneath any/not when the plugin map is empty', () => {
    const p = pluginBoard(base);
    p.rawConfig((raw) => {
      raw.plugins = {};
      raw.plugin_policies = [{ id: 'missing-claim-fact', hook: 'claim', reason: 'Missing facts must refuse',
        require: { any: [
          { fact: 'economy.remaining', op: 'gt', value: 0 },
          { not: { fact: 'economy.remaining', op: 'lte', value: 0 } },
        ] } }];
    });
    const before = p.bytes();
    const result = runCli(['board', 'claim', '--change', BOARD_CHANGE, '--task', '1.1', '--executor', 'mesh-a',
      '--agent', 'peer', '--request', 'policy-only:claim:0001', '--json'], p.root, base.env);
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.json().status[0].code).toBe('plugin_fact_missing');
    expect(p.bytes()).toEqual(before);
    expect(p.board().claims).toEqual([]);
    expect(p.events().filter((event) => event.event === 'task.claimed')).toEqual([]);
  });

  it('refuses CLI check-result when a disabled namespace cannot supply its required fact', () => {
    const p = pluginBoard(base);
    p.rawConfig((raw) => {
      raw.plugins = { economy: { package: 'packages/unavailable', digest: `sha256:${'0'.repeat(64)}`,
        enabled: false, config: {} } };
      raw.plugin_policies = [{ id: 'missing-result-fact', hook: 'result_accept', reason: 'Missing facts must refuse',
        require: { not: { fact: 'economy.remaining', op: 'lte', value: 0 } } }];
    });
    const baseSha = headCommit(p.root)!;
    git(p.root, ['checkout', '-qb', 'policy-candidate']);
    write(path.join(p.root, 'src/greet.js'), '// candidate\n');
    git(p.root, ['add', 'src/greet.js']);
    git(p.root, ['commit', '-qm', 'candidate\n\nSDLC-Change: add-farewell\nSDLC-Task: 1.1\nSDLC-Agent: mesh-a/peer']);
    git(p.root, ['checkout', '-q', 'main']);
    const before = p.bytes();
    const result = runCli(['task', 'check-result', '--change', BOARD_CHANGE, '--branch', 'policy-candidate',
      '--base', baseSha, '--json'], p.root, base.env);
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.json().status[0].code).toBe('plugin_fact_missing');
    expect(p.bytes()).toEqual(before);
    expect(p.events().filter((event) => event.event === 'task.result_checked')).toEqual([]);
  });
});
