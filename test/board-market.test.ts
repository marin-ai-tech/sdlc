import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B119 (epic E16): market mode. A person or the lead agent opens an auction for one open task
 * (`sdlc board auction --change <id> --task <n.m> [--window <s>]`, default window 300 s). Executors of the registry
 * bid with an estimate (`sdlc board bid … --minutes <n> [--cost <n>]`; one bid per executor, a new bid replaces it).
 * When the window ends, the next board command picks the winner by `board.market.rule` of openspec/sdlc.yaml —
 * `fastest` (default: least minutes), `cheapest` (least cost; a bid without a cost loses to one with it) or `first`
 * (the earliest bid); ties go to the executor with the higher max_risk, then the earlier bid — and reserves the task
 * for it as a dispatch does. A person may close it at once or reassign: `sdlc board award … --executor <id>`.
 * Every auction, bid and award is in the log. An auction without bids closes and the task is open again.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = {
  executors: {
    'swarm-a': { type: 'market', max_risk: 'medium' },
    'swarm-b': { type: 'market', max_risk: 'high' },
    junior: { type: 'market', max_risk: 'low' },
  },
};

interface Entry {
  event: string;
  task?: string;
  executor?: string;
  detail?: string;
}

interface BoardTask {
  id: string;
  status: string;
  executor?: string;
  closesAt?: string;
  bids?: { executor: string; minutes: number; cost?: number }[];
}

function project(market?: Record<string, unknown>) {
  const root = tempDir('sdlc-board-market-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  if (market) config.board = { market };
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
  const board = (args: string[], who: NodeJS.ProcessEnv = AGENT) => cli(['board', ...args, '--json'], who);
  const task = ['--change', 'add-farewell', '--task', '1.2'];
  const auction = (extra: string[] = [], who: NodeJS.ProcessEnv = {}) => board(['auction', ...task, ...extra], who);
  const bid = (executor: string, minutes: string, extra: string[] = []) =>
    board(['bid', ...task, '--executor', executor, '--agent', 'bidder', '--minutes', minutes, ...extra]);
  const award = (executor: string) => board(['award', ...task, '--executor', executor], {});
  const status = (): BoardTask | undefined =>
    board(['list']).json<{ tasks: BoardTask[] }>().tasks.find((entry) => entry.id === 'add-farewell#1.2');
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  return { root, cli, board, auction, bid, award, status, log };
}

const code = (r: { json: <T>() => T }) => r.json<{ status: { code: string }[] }>().status[0].code;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** A window long enough for several CLI calls on a slow machine (each starts a Node process). */
const WINDOW = '12';

/** Waits until the auction's close time has passed, read from the board itself. */
async function untilClosed(p: ReturnType<typeof project>): Promise<void> {
  const closesAt = p.status()?.closesAt;
  expect(closesAt).toBeDefined();
  await pause(Math.max(0, Date.parse(closesAt as string) - Date.now()) + 500);
}
const events = (p: ReturnType<typeof project>, name: string) => p.log().filter((e) => e.event === name);

describe('B119: an auction for a task', () => {
  it('bids are shown; when the window ends the fastest bid wins and the task is reserved for it', async () => {
    const p = project();
    const opened = p.auction(['--window', WINDOW]);
    expect(opened.code, opened.stdout + opened.stderr).toBe(0);
    expect(p.bid('swarm-a', '30').code).toBe(0);
    expect(p.bid('swarm-b', '20').code).toBe(0);
    const during = p.status();
    expect(during?.status).toBe('auction');
    expect(during?.closesAt).toBeDefined();
    expect(during?.bids?.map((b) => [b.executor, b.minutes])).toEqual([['swarm-a', 30], ['swarm-b', 20]]);
    expect(code(p.board(['claim', '--change', 'add-farewell', '--task', '1.2', '--executor', 'swarm-a',
      '--agent', 'coder-1']))).toBe('task_auction');
    await untilClosed(p);
    expect(p.status()).toMatchObject({ status: 'dispatched', executor: 'swarm-b' });
    expect(events(p, 'task.auction_opened')).toHaveLength(1);
    expect(events(p, 'task.bid').map((e) => e.executor)).toEqual(['swarm-a', 'swarm-b']);
    const awarded = events(p, 'task.awarded');
    expect(awarded).toHaveLength(1);
    expect(awarded[0]).toMatchObject({ task: '1.2', executor: 'swarm-b' });
    expect(awarded[0].detail).toContain('fastest');
    expect(p.board(['claim', '--change', 'add-farewell', '--task', '1.2', '--executor', 'swarm-b',
      '--agent', 'coder-9']).code).toBe(0);
  }, 240000);

  it('a new bid of the same executor replaces its old one', () => {
    const p = project();
    expect(p.auction().code).toBe(0);
    expect(p.bid('swarm-a', '30').code).toBe(0);
    expect(p.bid('swarm-a', '10').code).toBe(0);
    expect(p.status()?.bids?.map((b) => [b.executor, b.minutes])).toEqual([['swarm-a', 10]]);
  }, 240000);

  it('the rule in sdlc.yaml: cheapest picks the least cost, first the earliest bid', async () => {
    const cheap = project({ rule: 'cheapest' });
    expect(cheap.auction(['--window', WINDOW]).code).toBe(0);
    expect(cheap.bid('swarm-a', '30', ['--cost', '5']).code).toBe(0);
    expect(cheap.bid('swarm-b', '20', ['--cost', '9']).code).toBe(0);
    await untilClosed(cheap);
    const first = project({ rule: 'first' });
    expect(first.auction(['--window', WINDOW]).code).toBe(0);
    expect(first.bid('swarm-a', '30').code).toBe(0);
    expect(first.bid('swarm-b', '20').code).toBe(0);
    await untilClosed(first);
    expect(cheap.status()).toMatchObject({ status: 'dispatched', executor: 'swarm-a' });
    expect(first.status()).toMatchObject({ status: 'dispatched', executor: 'swarm-a' });
  }, 240000);

  it('a person awards at once, and may reassign after an automatic award', async () => {
    const p = project();
    expect(p.auction(['--window', WINDOW]).code).toBe(0);
    expect(p.bid('swarm-a', '30').code).toBe(0);
    expect(p.bid('swarm-b', '20').code).toBe(0);
    await untilClosed(p);
    expect(p.status()?.executor).toBe('swarm-b');
    const reassigned = p.award('swarm-a');
    expect(reassigned.code, reassigned.stdout + reassigned.stderr).toBe(0);
    expect(p.status()).toMatchObject({ status: 'dispatched', executor: 'swarm-a' });
    const early = project();
    expect(early.auction().code).toBe(0);
    expect(early.bid('swarm-a', '30').code).toBe(0);
    expect(early.award('swarm-b').code).toBe(0);
    expect(early.status()).toMatchObject({ status: 'dispatched', executor: 'swarm-b' });
    expect(events(early, 'task.awarded')).toHaveLength(1);
  }, 240000);

  it('an auction without bids closes and the task is open again, once logged', async () => {
    const p = project();
    expect(p.auction(['--window', '1']).code).toBe(0);
    await pause(1800);
    expect(p.status()?.status).toBe('open');
    expect(p.status()?.status).toBe('open');
    expect(events(p, 'task.auction_expired')).toHaveLength(1);
    expect(events(p, 'task.awarded')).toEqual([]);
  }, 240000);

  it('negative: no auction, a closed one, a disallowed executor, a bad bid, a busy task, a bad rule', async () => {
    const p = project();
    expect(code(p.bid('swarm-a', '30'))).toBe('no_auction');
    expect(p.auction(['--window', WINDOW]).code).toBe(0);
    expect(code(p.auction())).toBe('task_auction');
    expect(code(p.bid('junior', '30'))).toBe('executor_not_allowed');
    expect(code(p.bid('swarm-a', '0'))).toBe('invalid_bid');
    expect(code(p.bid('swarm-a', 'soon'))).toBe('invalid_bid');
    expect(code(p.bid('swarm-a', '30', ['--cost', '-1']))).toBe('invalid_bid');
    await untilClosed(p);
    expect(code(p.bid('swarm-a', '30'))).toBe('no_auction');
    expect(p.board(['claim', '--change', 'add-farewell', '--task', '1.2', '--executor', 'swarm-a',
      '--agent', 'coder-1']).code).toBe(0);
    expect(code(p.auction())).toBe('task_claimed');
    // A bad rule makes the configuration invalid for every command, so it is written after the setup.
    const bad = project();
    const file = path.join(bad.root, 'openspec/sdlc.yaml');
    write(file, stringify({ ...parse(read(file)), board: { market: { rule: 'loudest' } } }));
    expect(code(bad.auction())).toBe('invalid_config');
    expect(events(p, 'task.bid')).toEqual([]);
  }, 240000);
});
