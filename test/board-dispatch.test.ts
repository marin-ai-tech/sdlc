import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B117 (epic E16): placement through a representative. A person or the lead agent hands one task to an executor of
 * the registry - typically the representative (orchestrator, leader) of a swarm - with
 * `sdlc board dispatch --change <id> --task <n.m> --executor <id> [--lease <s>]`. The task is then reserved for that
 * executor: others cannot claim it, the representative claims it as usual (and from then on keeps it by
 * heartbeats). A representative that does not take the task before the dispatch lease ends loses it: the task
 * returns to the pool, logged once. Every dispatch is in the log.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = {
  executors: {
    'rep-a': { type: 'representative', max_risk: 'medium' },
    'swarm-b': { type: 'board', max_risk: 'high' },
    junior: { type: 'representative', max_risk: 'low' },
  },
};

interface Entry {
  event: string;
  task?: string;
  executor?: string;
}

interface BoardTask {
  id: string;
  status: string;
  executor?: string;
  expiresAt?: string;
}

function project() {
  const root = tempDir('sdlc-board-dispatch-');
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
  const board = (args: string[], extra: NodeJS.ProcessEnv = AGENT) => cli(['board', ...args, '--json'], extra);
  const dispatch = (executor: string, extra: string[] = [], who: NodeJS.ProcessEnv = {}) =>
    board(['dispatch', '--change', 'add-farewell', '--task', '1.2', '--executor', executor, ...extra], who);
  const claim = (executor: string, agent: string) =>
    board(['claim', '--change', 'add-farewell', '--task', '1.2', '--executor', executor, '--agent', agent]);
  const status = (): BoardTask | undefined =>
    board(['list']).json<{ tasks: BoardTask[] }>().tasks.find((task) => task.id === 'add-farewell#1.2');
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  return { root, cli, board, dispatch, claim, status, log };
}

const code = (r: { json: <T>() => T }) => r.json<{ status: { code: string }[] }>().status[0].code;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('B117: sdlc board dispatch', () => {
  it('a person dispatches a task to a representative; it is reserved for it and logged', () => {
    const p = project();
    const r = p.dispatch('rep-a');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const dispatched = r.json<{ dispatch: { item: string; executor: string; expiresAt: string } }>().dispatch;
    expect(dispatched).toMatchObject({ item: 'add-farewell#1.2', executor: 'rep-a' });
    const lease = (Date.parse(dispatched.expiresAt) - Date.now()) / 1000;
    expect(lease).toBeGreaterThan(800);
    expect(lease).toBeLessThan(1000);
    expect(p.status()).toMatchObject({ status: 'dispatched', executor: 'rep-a' });
    expect(p.log().filter((e) => e.event === 'task.dispatched').map((e) => [e.task, e.executor]))
      .toEqual([['1.2', 'rep-a']]);
    const other = p.claim('swarm-b', 'coder-9');
    expect(other.code).not.toBe(0);
    expect(code(other)).toBe('task_dispatched');
    expect(JSON.stringify(other.json())).toContain('rep-a');
    const taken = p.claim('rep-a', 'leader-1');
    expect(taken.code, taken.stdout + taken.stderr).toBe(0);
    expect(p.status()).toMatchObject({ status: 'claimed', executor: 'rep-a' });
  }, 240000);

  it('the lead agent may dispatch too', () => {
    const p = project();
    const r = p.dispatch('rep-a', [], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.status()?.status).toBe('dispatched');
  }, 240000);

  it('a representative that does not take the task loses it when the lease ends, once logged', async () => {
    const p = project();
    expect(p.dispatch('rep-a', ['--lease', '1']).code).toBe(0);
    await pause(2500);
    expect(p.status()?.status).toBe('open');
    expect(p.status()?.status).toBe('open');
    expect(p.log().filter((e) => e.event === 'task.dispatch_expired').map((e) => [e.task, e.executor]))
      .toEqual([['1.2', 'rep-a']]);
    expect(p.claim('swarm-b', 'coder-9').code).toBe(0);
  }, 240000);

  it('negative: an unknown or disallowed executor, a held, dispatched or submitted task, a bad lease', () => {
    const p = project();
    expect(code(p.dispatch('ghost'))).toBe('unknown_executor');
    expect(code(p.dispatch('junior'))).toBe('executor_not_allowed');
    expect(code(p.dispatch('rep-a', ['--lease', '0']))).toBe('invalid_lease');
    expect(code(p.board(['dispatch', '--change', 'add-farewell', '--task', '9.9', '--executor', 'rep-a'])))
      .toBe('unknown_task');
    expect(p.dispatch('rep-a').code).toBe(0);
    expect(code(p.dispatch('swarm-b'))).toBe('task_dispatched');
    expect(p.claim('rep-a', 'leader-1').code).toBe(0);
    expect(code(p.dispatch('swarm-b'))).toBe('task_claimed');
    expect(p.log().filter((e) => e.event === 'task.dispatched')).toHaveLength(1);
  }, 240000);
});
