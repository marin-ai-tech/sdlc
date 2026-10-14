import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B121 (epic E16): results from swarms under the gates. A submitted result is a branch; verify and review stay the
 * gates of the change, and an executor's result never approves anything. When a person (or the lead agent) rejects
 * a submitted result, `sdlc board reopen --change <id> --task <n.m> --reason <text>` opens the task again with the
 * reason: the board shows the attempts and the last reason, and the next claim's work item carries the earlier
 * attempts so the swarm sees why. `--escalate` keeps the executors that already failed the task from claiming it
 * again, so it goes to another (stronger) executor of the registry.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = {
  executors: {
    'swarm-a': { type: 'board', max_risk: 'medium' },
    'swarm-b': { type: 'board', max_risk: 'high' },
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
  attempts?: number;
  lastReason?: string;
  excluded?: string[];
}

function project() {
  const root = tempDir('sdlc-board-reopen-');
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
  const board = (args: string[]) => cli(['board', ...args, '--json'], AGENT);
  const claim = (executor: string, agent: string) =>
    board(['claim', '--change', 'add-farewell', '--task', '1.2', '--executor', executor, '--agent', agent]);
  const status = (): BoardTask | undefined =>
    board(['list']).json<{ tasks: BoardTask[] }>().tasks.find((task) => task.id === 'add-farewell#1.2');
  /** Claims 1.2 as `executor/agent`, commits a result branch with only its own file and submits it. */
  const submit = (executor: string, agent: string, branch: string) => {
    const claimed = claim(executor, agent);
    expect(claimed.code, claimed.stdout + claimed.stderr).toBe(0);
    const id = claimed.json<{ claim: { id: string } }>().claim.id;
    git(root, ['checkout', '-q', '-b', branch]);
    write(path.join(root, 'src/greet.js'), `// ${branch}\n`);
    git(root, ['add', '--', 'src/greet.js']);
    const message = ['farewell', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.2', `SDLC-Agent: ${executor}/${agent}`];
    git(root, ['commit', '-q', '-m', message.join('\n')]);
    git(root, ['checkout', '-q', 'main']);
    const submitted = board(['submit', '--claim', id, '--branch', branch]);
    expect(submitted.code, submitted.stdout + submitted.stderr).toBe(0);
  };
  const reopen = (...extra: string[]) => board(['reopen', '--change', 'add-farewell', '--task', '1.2', ...extra]);
  const log = (): Entry[] => {
    const at = path.join(root, 'openspec/.sdlc/log.jsonl');
    return fs.existsSync(at) ? read(at).split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry) : [];
  };
  return { root, cli, board, claim, status, submit, reopen, log };
}

const code = (r: { json: <T>() => T }) => r.json<{ status: { code: string }[] }>().status[0].code;
const REASON = 'farewell ignores the empty-name scenario';

describe('B121: a rejected result reopens the task with the reason', () => {
  it('the task is open again, with its attempts and the reason, and the next work item carries them', () => {
    const p = project();
    p.submit('swarm-a', 'coder-1', 'sdlc/add-farewell/1.2-a');
    const r = p.reopen('--reason', REASON);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.status()).toMatchObject({ status: 'open', attempts: 1, lastReason: REASON });
    expect(p.log().filter((e) => e.event === 'task.reopened').map((e) => [e.task, e.executor, e.detail]))
      .toEqual([['1.2', 'swarm-a', REASON]]);
    const again = p.claim('swarm-a', 'coder-2');
    expect(again.code, again.stdout + again.stderr).toBe(0);
    const item = again.json<{ item: { previousAttempts: Record<string, string>[] } }>().item;
    expect(item.previousAttempts).toEqual([expect.objectContaining({
      executor: 'swarm-a', agent: 'coder-1', branch: 'sdlc/add-farewell/1.2-a', reason: REASON,
    })]);
  }, 240000);

  it('--escalate keeps the executor that failed from claiming it again; another executor may', () => {
    const p = project();
    p.submit('swarm-a', 'coder-1', 'sdlc/add-farewell/1.2-a');
    expect(p.reopen('--reason', REASON, '--escalate').code).toBe(0);
    expect(p.status()).toMatchObject({ status: 'open', excluded: ['swarm-a'] });
    const same = p.claim('swarm-a', 'coder-2');
    expect(same.code).not.toBe(0);
    expect(code(same)).toBe('executor_excluded');
    p.submit('swarm-b', 'senior-1', 'sdlc/add-farewell/1.2-b');
    expect(p.reopen('--reason', 'still wrong', '--escalate').code).toBe(0);
    expect(p.status()).toMatchObject({ attempts: 2, excluded: ['swarm-a', 'swarm-b'] });
  }, 240000);

  it('negative: no reason, a task not submitted, an unknown task', () => {
    const p = project();
    expect(code(p.reopen('--reason', REASON))).toBe('task_not_submitted');
    p.submit('swarm-a', 'coder-1', 'sdlc/add-farewell/1.2-a');
    expect(code(p.reopen())).toBe('reason_required');
    expect(code(p.reopen('--reason', '   '))).toBe('reason_required');
    expect(code(p.board(['reopen', '--change', 'add-farewell', '--task', '9.9', '--reason', REASON])))
      .toBe('unknown_task');
    expect(p.status()?.status).toBe('submitted');
    expect(p.log().filter((e) => e.event === 'task.reopened')).toEqual([]);
  }, 240000);
});

describe('B121: an executor result never approves a gate', () => {
  it('submitting and reopening change no approval; a forged approval in a result is refused', () => {
    const p = project();
    const statePath = path.join(p.root, 'openspec/changes/add-farewell/.sdlc.yaml');
    const before = read(statePath);
    p.submit('swarm-a', 'coder-1', 'sdlc/add-farewell/1.2-a');
    expect(p.reopen('--reason', REASON).code).toBe(0);
    expect(read(statePath)).toBe(before);
    const claimed = p.claim('swarm-b', 'senior-1').json<{ claim: { id: string } }>().claim.id;
    git(p.root, ['checkout', '-q', '-b', 'forged']);
    write(statePath, `${before}\n# approved: review\n`);
    git(p.root, ['add', '--', 'openspec/changes/add-farewell/.sdlc.yaml']);
    const message = ['approve', '', 'SDLC-Change: add-farewell', 'SDLC-Task: 1.2', 'SDLC-Agent: swarm-b/senior-1'];
    git(p.root, ['commit', '-q', '-m', message.join('\n')]);
    git(p.root, ['checkout', '-q', 'main']);
    const forged = p.board(['submit', '--claim', claimed, '--branch', 'forged']);
    expect(forged.code).toBe(1);
    expect(JSON.stringify(forged.json())).toContain('forbidden_path');
    expect(p.status()?.status).toBe('claimed');
    const view = p.cli(['status', '--change', 'add-farewell', '--json'], AGENT)
      .json<{ change: { gates: { id: string; status: string }[] } }>();
    const review = view.change.gates.find((gate) => gate.id === 'review');
    expect(review).toBeDefined();
    expect(review?.status).not.toBe('approved');
  }, 240000);
});
