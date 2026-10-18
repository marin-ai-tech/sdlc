import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { BIN, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B118 (epic E16): the task board. Open tasks of changes whose plan is approved are on a board; an executor's agent
 * claims a task with a lease, keeps it with heartbeats, releases it or submits a result branch. The board lives in
 * the clone that serves it (`openspec/.sdlc/board.json`, not committed, a state file agents cannot edit); every
 * claim, release, expiry and submission is in the project log. Expiry is computed on read: no background timer.
 * - two agents cannot hold the same task at once (also when they claim at the same moment);
 * - a task whose agent stops sending heartbeats becomes open again;
 * - only executors of the registry (B116) allowed for the change may claim; the board decides no gate.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', '- [x] 1.3 Read the existing greeting', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = {
  executors: {
    'swarm-a': { type: 'board', max_risk: 'medium' },
    'swarm-b': { type: 'board', max_risk: 'high' },
    junior: { type: 'board', max_risk: 'low' },
  },
};

interface Entry {
  event: string;
  change?: string;
  task?: string;
  executor?: string;
  agent?: string;
}

interface BoardTask {
  id: string;
  status: string;
  executor?: string;
  agent?: string;
  expiresAt?: string;
}

function project() {
  const root = tempDir('sdlc-board-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
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
  const approvePlan = () => {
    approve('plan');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'plan approved']);
  };
  const board = (args: string[]) => cli(['board', ...args, '--json'], AGENT);
  const claim = (task: string, executor = 'swarm-a', agent = 'coder-1', extra: string[] = []) =>
    board(['claim', '--change', 'add-farewell', '--task', task, '--executor', executor, '--agent', agent, ...extra]);
  const tasks = (): BoardTask[] => board(['list']).json<{ tasks: BoardTask[] }>().tasks;
  const status = (id: string) => tasks().find((task) => task.id === id);
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  /** A result branch with one commit of exactly `files`; the files the CLI writes on main stay out of it. */
  const resultBranch = (branch: string, task: string, agent: string) => {
    git(root, ['checkout', '-q', '-b', branch]);
    write(path.join(root, 'src/greet.js'), `// ${branch}\n`);
    git(root, ['add', '--', 'src/greet.js']);
    const message = ['work', '', 'SDLC-Change: add-farewell', `SDLC-Task: ${task}`, `SDLC-Agent: ${agent}`];
    git(root, ['commit', '-q', '-m', message.join('\n')]);
    git(root, ['checkout', '-q', 'main']);
  };
  return { root, cli, env, approvePlan, board, claim, tasks, status, log, resultBranch };
}

const code = (r: { json: <T>() => T }) => r.json<{ status: { code: string }[] }>().status[0].code;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('B118: the board lists the open tasks of approved plans', () => {
  it('nothing before the plan is approved; then every open task, not the done one', () => {
    const p = project();
    const before = p.board(['list']);
    expect(before.code, before.stdout + before.stderr).toBe(0);
    expect(before.json<{ tasks: BoardTask[] }>().tasks).toEqual([]);
    p.approvePlan();
    const listed = p.tasks();
    expect(listed.map((task) => [task.id, task.status])).toEqual([
      ['add-farewell#1.1', 'open'], ['add-farewell#1.2', 'open'],
    ]);
    expect(p.cli(['board', 'list'], AGENT).stdout).toContain('add-farewell#1.2');
  }, 240000);
});

describe('B118: claims', () => {
  it('an allowed executor claims a task with a lease and receives the work item', () => {
    const p = project();
    p.approvePlan();
    const r = p.claim('1.2');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const { claim, item } = r.json<{ claim: Record<string, string>; item: Record<string, unknown> }>();
    expect(claim.id).toMatch(/^[0-9a-f]{32,}$/);
    expect(claim).toMatchObject({ item: 'add-farewell#1.2', executor: 'swarm-a', agent: 'coder-1' });
    const lease = (Date.parse(claim.expiresAt) - Date.now()) / 1000;
    expect(lease).toBeGreaterThan(800);
    expect(lease).toBeLessThan(1000);
    expect(item).toMatchObject({ id: 'add-farewell#1.2', contract: 'sdlc.task/1', executor: 'swarm-a' });
    expect((item.result as { trailers: Record<string, string> }).trailers['SDLC-Agent']).toBe('swarm-a/coder-1');
    expect(p.status('add-farewell#1.2')).toMatchObject({ status: 'claimed', executor: 'swarm-a', agent: 'coder-1' });
    expect(p.board(['list']).stdout).not.toContain(claim.id);
    expect(p.log().filter((e) => e.event === 'task.claimed').map((e) => [e.task, e.executor, e.agent]))
      .toEqual([['1.2', 'swarm-a', 'coder-1']]);
  }, 240000);

  it('negative: no plan, an unknown or disallowed executor, a bad agent, an unknown or done task, a bad lease', () => {
    const p = project();
    expect(code(p.claim('1.2'))).toBe('plan_not_approved');
    p.approvePlan();
    expect(code(p.claim('1.2', 'ghost'))).toBe('unknown_executor');
    expect(code(p.claim('1.2', 'junior'))).toBe('executor_not_allowed');
    expect(code(p.claim('1.2', 'swarm-a', 'coder 1'))).toBe('invalid_agent');
    expect(code(p.claim('9.9'))).toBe('unknown_task');
    expect(code(p.claim('1.3'))).toBe('task_done');
    expect(code(p.claim('1.2', 'swarm-a', 'coder-1', ['--lease', '0']))).toBe('invalid_lease');
    expect(p.tasks().every((task) => task.status === 'open')).toBe(true);
    expect(p.log().filter((e) => e.event === 'task.claimed')).toEqual([]);
  }, 240000);

  it('without a registry nobody can claim', () => {
    const p = project();
    p.approvePlan();
    fs.rmSync(path.join(p.root, 'openspec/executors.yaml'));
    expect(code(p.claim('1.2'))).toBe('no_executor_registry');
  }, 240000);

  it('two agents cannot hold the same task at once', () => {
    const p = project();
    p.approvePlan();
    expect(p.claim('1.2').code).toBe(0);
    for (const [executor, agent] of [['swarm-b', 'coder-9'], ['swarm-a', 'coder-2']]) {
      const second = p.claim('1.2', executor, agent);
      expect(second.code, `${executor}/${agent}`).not.toBe(0);
      expect(code(second)).toBe('task_claimed');
      expect(JSON.stringify(second.json())).toContain('swarm-a');
    }
    expect(p.claim('1.1', 'swarm-b', 'coder-9').code).toBe(0);
  }, 240000);

  it('two agents claiming at the same moment: exactly one wins', async () => {
    const p = project();
    p.approvePlan();
    const args = (n: number) => ['board', 'claim', '--change', 'add-farewell', '--task', '1.2',
      '--executor', 'swarm-a', '--agent', `racer-${n}`, '--json'];
    const run = (n: number) => new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [BIN, ...args(n)], { cwd: p.root, env: { ...p.env, ...AGENT } });
      child.on('close', (exit) => resolve(exit));
    });
    const exits = await Promise.all([1, 2, 3, 4, 5, 6].map(run));
    expect(exits.filter((exit) => exit === 0)).toHaveLength(1);
    expect(p.log().filter((e) => e.event === 'task.claimed')).toHaveLength(1);
  }, 240000);
});

describe('B118: leases', () => {
  it('a heartbeat extends the lease; an unknown claim is refused', async () => {
    const p = project();
    p.approvePlan();
    const claimed = p.claim('1.2', 'swarm-a', 'coder-1', ['--lease', '30']);
    const claim = claimed.json<{ claim: Record<string, string> }>().claim;
    await pause(1100);
    const beat = p.board(['heartbeat', '--claim', claim.id]);
    expect(beat.code, beat.stdout + beat.stderr).toBe(0);
    const renewed = beat.json<{ claim: Record<string, string> }>().claim;
    expect(Date.parse(renewed.expiresAt)).toBeGreaterThan(Date.parse(claim.expiresAt));
    expect(code(p.board(['heartbeat', '--claim', 'f'.repeat(32)]))).toBe('claim_unknown');
  }, 240000);

  it('a task whose agent stops sending heartbeats becomes open again, once logged', async () => {
    const p = project();
    p.approvePlan();
    const claimed = p.claim('1.2', 'swarm-a', 'coder-1', ['--lease', '1']);
    const claim = claimed.json<{ claim: Record<string, string> }>().claim;
    await pause(2500);
    expect(p.status('add-farewell#1.2')?.status).toBe('open');
    expect(p.status('add-farewell#1.2')?.status).toBe('open');
    expect(p.log().filter((e) => e.event === 'task.lease_expired').map((e) => [e.task, e.executor]))
      .toEqual([['1.2', 'swarm-a']]);
    expect(code(p.board(['heartbeat', '--claim', claim.id]))).toBe('claim_expired');
    expect(p.claim('1.2', 'swarm-b', 'coder-9').code).toBe(0);
  }, 240000);

  it('a released task is open again; releasing twice is refused', () => {
    const p = project();
    p.approvePlan();
    const claim = p.claim('1.2').json<{ claim: Record<string, string> }>().claim;
    const released = p.board(['release', '--claim', claim.id, '--note', 'out of scope for us']);
    expect(released.code, released.stdout + released.stderr).toBe(0);
    expect(p.status('add-farewell#1.2')?.status).toBe('open');
    expect(p.log().filter((e) => e.event === 'task.released').map((e) => e.task)).toEqual(['1.2']);
    expect(code(p.board(['release', '--claim', claim.id]))).toBe('claim_unknown');
    const next = p.claim('1.2').json<{ item: { result: { branch: string } } }>();
    expect(next.item.result.branch).toBe('sdlc/add-farewell/1.2-2');
  }, 240000);
});

describe('B118: submitting a result', () => {
  it('a branch that passes check-result is submitted and the task leaves the open list', () => {
    const p = project();
    p.approvePlan();
    const state = read(path.join(p.root, 'openspec/changes/add-farewell/.sdlc.yaml'));
    const claim = p.claim('1.2').json<{ claim: Record<string, string> }>().claim;
    p.resultBranch('sdlc/add-farewell/1.2', '1.2', 'swarm-a/coder-1');
    const r = p.board(['submit', '--claim', claim.id, '--branch', 'sdlc/add-farewell/1.2']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.status('add-farewell#1.2')).toMatchObject({ status: 'submitted', executor: 'swarm-a' });
    expect(p.log().filter((e) => e.event === 'task.submitted').map((e) => [e.task, e.executor]))
      .toEqual([['1.2', 'swarm-a']]);
    expect(code(p.claim('1.2', 'swarm-b', 'coder-9'))).toBe('task_submitted');
    expect(read(path.join(p.root, 'openspec/changes/add-farewell/.sdlc.yaml'))).toBe(state);
  }, 240000);

  it('negative: a failing branch, or one another executor committed, keeps the claim held', () => {
    const p = project();
    p.approvePlan();
    const claim = p.claim('1.2').json<{ claim: Record<string, string> }>().claim;
    p.resultBranch('no-agent', '1.2', 'claude-code');
    p.resultBranch('other', '1.2', 'swarm-b/coder-9');
    const failing = p.board(['submit', '--claim', claim.id, '--branch', 'no-agent']);
    expect(failing.code).toBe(1);
    expect(JSON.stringify(failing.json())).toContain('missing_agent');
    const other = p.board(['submit', '--claim', claim.id, '--branch', 'other']);
    expect(other.code).toBe(1);
    expect(JSON.stringify(other.json())).toContain('wrong_executor');
    expect(p.status('add-farewell#1.2')?.status).toBe('claimed');
    expect(p.log().filter((e) => e.event === 'task.submitted')).toEqual([]);
  }, 240000);
});

describe('B118: the board file belongs to the harness', () => {
  it('it is not committed, agents cannot edit it, and executors must not touch it', () => {
    const p = project();
    p.approvePlan();
    expect(p.claim('1.2').code).toBe(0);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/board.json'))).toBe(true);
    const ignored = spawnSync('git', ['check-ignore', '-q', 'openspec/.sdlc/board.json'], { cwd: p.root });
    expect(ignored.status).toBe(0);
    const decide = (tool: string, input: Record<string, string>) => {
      const stdin = JSON.stringify({ cwd: p.root, tool_name: tool, tool_input: input });
      const out = p.cli(['hook', 'pre-tool'], AGENT, stdin).stdout.trim();
      return out ? JSON.parse(out).hookSpecificOutput.permissionDecision : 'allow';
    };
    const board = path.join(p.root, 'openspec/.sdlc/board.json');
    expect(decide('Write', { file_path: board, content: '{"version":1,"claims":[]}' })).toBe('deny');
    expect(decide('Bash', { command: 'echo {} > openspec/.sdlc/board.json' })).toBe('deny');
    const forbidden = p.cli(['task', 'export', '--change', 'add-farewell', '--executor', 'swarm-a', '--json'], AGENT)
      .json<{ items: { forbidden: string[] }[] }>().items[0].forbidden;
    expect(forbidden).toContain('openspec/.sdlc/board.json');
  }, 240000);
});
