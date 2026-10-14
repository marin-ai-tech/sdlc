import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B116 (epic E16): the executor registry `openspec/executors.yaml`. A person lists the executors (swarms of type
 * representative, board, market or mesh), the highest risk and the kinds of change each may take, and labels for
 * what it can do. The registry is a state file: agents cannot edit it.
 * - `sdlc task executors [--json]` shows the registry; a broken file is refused with `executors_invalid`.
 * - With a registry, `sdlc task export` hands work only to a named executor that may take the change
 *   (`--executor <id>`): risk at most `max_risk`, kind in `kinds`. Each handed-out task is in the log.
 * - With a registry, `sdlc task check-result` wants every commit to carry `SDLC-Agent: <executor>/<agent>` naming an
 *   executor that may take the change. Each check is in the log.
 * - Without a registry both commands behave as in 0.19.0.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };
const REGISTRY = {
  executors: {
    'swarm-a': { type: 'board', name: 'Team A board', max_risk: 'medium', kinds: ['feature', 'bugfix'],
      capabilities: ['typescript'] },
    junior: { type: 'representative', max_risk: 'low' },
    fixers: { type: 'market', max_risk: 'high', kinds: ['bugfix'] },
    seniors: { type: 'mesh', max_risk: 'high' },
  },
};

interface Entry {
  event: string;
  change?: string;
  task?: string;
  executor?: string;
  detail?: string;
}

function project(risk = 'medium') {
  const root = tempDir('sdlc-executors-');
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
  /** A person approves; at high risk spec and plan also need a second person as tech lead (`high_risk_approvers`). */
  const approve = (gate: string) => {
    const r = cli(['approve', gate, '--change', 'add-farewell', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    if (risk !== 'high' || gate === 'intent') return;
    const lead = cli(['approve', gate, '--change', 'add-farewell', '--as', 'tech-lead', '--by', 'lee@example.com',
      '--json']);
    expect(lead.code, lead.stdout + lead.stderr).toBe(0);
  };
  expect(cli(['new', 'add-farewell', '--risk', risk, '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  approve('intent');
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  approve('spec');
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), OPEN_TASKS);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planning']);
  approve('plan');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'plan approved']);
  const registry = (body: unknown = REGISTRY) => {
    write(path.join(root, 'openspec/executors.yaml'), typeof body === 'string' ? body : stringify(body));
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'executor registry']);
  };
  const exportAs = (...extra: string[]) =>
    cli(['task', 'export', '--change', 'add-farewell', ...extra, '--json'], AGENT);
  /** A result branch with one commit of exactly `files`; the log the CLI appends on main stays out of it. */
  const resultBranch = (branch: string, files: string[], message: string) => {
    git(root, ['checkout', '-q', '-b', branch]);
    for (const rel of files) write(path.join(root, rel), `// ${branch} ${rel}\n`);
    git(root, ['add', '--', ...files]);
    git(root, ['commit', '-q', '-m', message]);
    git(root, ['checkout', '-q', 'main']);
  };
  const check = (branch: string) =>
    cli(['task', 'check-result', '--change', 'add-farewell', '--branch', branch, '--json'], AGENT);
  const log = (): Entry[] => {
    const text = fs.existsSync(path.join(root, 'openspec/.sdlc/log.jsonl'))
      ? read(path.join(root, 'openspec/.sdlc/log.jsonl')) : '';
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as Entry);
  };
  return { root, cli, registry, exportAs, resultBranch, check, log };
}

const commitMessage = (task: string, agent?: string) =>
  ['work', '', 'SDLC-Change: add-farewell', `SDLC-Task: ${task}`, ...(agent ? [`SDLC-Agent: ${agent}`] : [])]
    .join('\n');
const codes = (r: { json: () => { problems: { code: string }[] } }) => r.json().problems.map((p) => p.code);

describe('B116: sdlc task executors', () => {
  it('without a registry the list is empty; with one it shows every executor', () => {
    const p = project();
    const none = p.cli(['task', 'executors', '--json'], AGENT);
    expect(none.code, none.stdout + none.stderr).toBe(0);
    expect(none.json().executors).toEqual([]);
    p.registry();
    const r = p.cli(['task', 'executors', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const executors = r.json().executors as { id: string }[];
    expect(executors.map((e) => e.id).sort()).toEqual(['fixers', 'junior', 'seniors', 'swarm-a']);
    expect(executors.find((e) => e.id === 'swarm-a')).toMatchObject({
      id: 'swarm-a', type: 'board', name: 'Team A board', maxRisk: 'medium', kinds: ['feature', 'bugfix'],
      capabilities: ['typescript'],
    });
    expect(executors.find((e) => e.id === 'junior')).toMatchObject({ type: 'representative', maxRisk: 'low' });
    const text = p.cli(['task', 'executors'], AGENT).stdout;
    expect(text).toContain('swarm-a');
    expect(text).toContain('board');
  }, 240000);

  it('negative: a broken registry is refused and names the executor', () => {
    const p = project();
    const broken: [string, unknown][] = [
      ['hive', { executors: { 'swarm-a': { type: 'hive', max_risk: 'low' } } }],
      ['extreme', { executors: { 'swarm-a': { type: 'board', max_risk: 'extreme' } } }],
      ['no-max-risk', { executors: { 'swarm-a': { type: 'board' } } }],
      ['typo', { executors: { 'swarm-a': { type: 'board', 'max-risk': 'low' } } }],
      ['kind', { executors: { 'swarm-a': { type: 'board', max_risk: 'low', kinds: ['bogus'] } } }],
      ['bad-id', { executors: { 'Swarm A': { type: 'board', max_risk: 'low' } } }],
      ['not-a-map', 'executors:\n  - swarm-a\n'],
    ];
    for (const [label, body] of broken) {
      p.registry(body);
      const r = p.cli(['task', 'executors', '--json'], AGENT);
      expect(r.code, label).toBe(1);
      expect(r.json().status[0].code, label).toBe('executors_invalid');
      if (label !== 'not-a-map') expect(JSON.stringify(r.json().status), label).toMatch(/swarm-a|Swarm A/i);
      const exported = p.exportAs('--executor', 'swarm-a');
      expect(exported.code, label).not.toBe(0);
      expect(exported.json().status[0].code, label).toBe('executors_invalid');
    }
  }, 240000);
});

describe('B116: task export with a registry', () => {
  it('without a registry export is as in 0.19.0: no executor, no agent trailer, nothing in the log', () => {
    const p = project();
    const r = p.exportAs();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const item = r.json().items[0];
    expect(item).not.toHaveProperty('executor');
    expect(item.result.trailers).not.toHaveProperty('SDLC-Agent');
    expect(p.log().filter((e) => e.event === 'task.exported')).toEqual([]);
    const named = p.exportAs('--executor', 'swarm-a');
    expect(named.code).not.toBe(0);
    expect(named.json().status[0].code).toBe('no_executor_registry');
  }, 240000);

  it('an allowed executor receives the work with its agent trailer, and each task is logged', () => {
    const p = project();
    p.registry();
    const r = p.exportAs('--executor', 'swarm-a');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const items = r.json().items;
    expect(items.map((item: { id: string }) => item.id)).toEqual(['add-farewell#1.1', 'add-farewell#1.2']);
    for (const item of items) {
      expect(item.executor).toBe('swarm-a');
      expect(item.result.trailers).toMatchObject({ 'SDLC-Change': 'add-farewell', 'SDLC-Agent': 'swarm-a/<agent>' });
    }
    const exported = p.log().filter((e) => e.event === 'task.exported');
    expect(exported.map((e) => [e.change, e.task, e.executor])).toEqual([
      ['add-farewell', '1.1', 'swarm-a'], ['add-farewell', '1.2', 'swarm-a'],
    ]);
  }, 240000);

  it('negative: no executor named, an unknown one, or one not allowed for the risk or the kind get nothing', () => {
    const p = project();
    p.registry();
    const refused: [string[], string][] = [
      [[], 'executor_required'],
      [['--executor', 'ghost'], 'unknown_executor'],
      [['--executor', 'junior'], 'executor_not_allowed'],
      [['--executor', 'fixers'], 'executor_not_allowed'],
    ];
    for (const [extra, code] of refused) {
      const r = p.exportAs(...extra);
      expect(r.code, extra.join(' ')).not.toBe(0);
      expect(r.json().status[0].code, extra.join(' ')).toBe(code);
      expect(r.json()).not.toHaveProperty('items');
    }
    expect(JSON.stringify(p.exportAs('--executor', 'junior').json().status)).toMatch(/medium/);
    expect(p.log().filter((e) => e.event === 'task.exported')).toEqual([]);
  }, 240000);

  it('an executor not allowed for high-risk tasks cannot receive one', () => {
    const p = project('high');
    p.registry();
    expect(p.exportAs('--executor', 'swarm-a').json().status[0].code).toBe('executor_not_allowed');
    const senior = p.exportAs('--executor', 'seniors');
    expect(senior.code, senior.stdout + senior.stderr).toBe(0);
    expect(senior.json().items[0]).toMatchObject({ risk: 'high', executor: 'seniors' });
  }, 240000);

  it('the registry is off-limits to executors: it is a forbidden path of every work item', () => {
    const p = project();
    p.registry();
    expect(p.exportAs('--executor', 'swarm-a').json().items[0].forbidden).toContain('openspec/executors.yaml');
  }, 240000);
});

describe('B116: task check-result with a registry', () => {
  it('every commit names an allowed executor and its agent; the check is logged', () => {
    const p = project();
    p.registry();
    p.resultBranch('good', ['src/greet.js'], commitMessage('1.2', 'swarm-a/coder-3'));
    const r = p.check('good');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ ok: true, problems: [], executors: ['swarm-a'] });
    const checked = p.log().filter((e) => e.event === 'task.result_checked');
    expect(checked).toHaveLength(1);
    expect(checked[0]).toMatchObject({ change: 'add-farewell', executor: 'swarm-a' });
  }, 240000);

  it('negative: no agent trailer, a bare agent, an unknown or a disallowed executor fail', () => {
    const p = project();
    p.registry();
    const cases: [string, string | undefined, string][] = [
      ['no-agent', undefined, 'missing_agent'],
      ['bare-agent', 'claude-code', 'missing_agent'],
      ['empty-agent', 'swarm-a/', 'missing_agent'],
      ['ghost', 'ghost/coder', 'unknown_executor'],
      ['junior', 'junior/coder', 'executor_not_allowed'],
      ['fixers', 'fixers/coder', 'executor_not_allowed'],
    ];
    for (const [branch, agent, code] of cases) {
      p.resultBranch(branch, ['src/greet.js'], commitMessage('1.2', agent));
      const r = p.check(branch);
      expect(r.code, branch).toBe(1);
      expect(codes(r), branch).toContain(code);
      expect(r.json().ok, branch).toBe(false);
    }
    const failed = p.log().filter((e) => e.event === 'task.result_checked' && e.detail?.includes('unknown_executor'));
    expect(failed).toHaveLength(1);
  }, 240000);

  it('negative: a result that edits the registry fails as a forbidden path', () => {
    const p = project();
    p.registry();
    p.resultBranch('grant', ['openspec/executors.yaml'], commitMessage('1.2', 'swarm-a/coder-3'));
    const r = p.check('grant');
    expect(r.code).toBe(1);
    expect(r.json().problems).toContainEqual(expect.objectContaining({ code: 'forbidden_path',
      file: 'openspec/executors.yaml' }));
  }, 240000);

  it('without a registry a result needs no agent trailer, as in 0.19.0', () => {
    const p = project();
    p.resultBranch('plain', ['src/greet.js'], commitMessage('1.2'));
    const r = p.check('plain');
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().ok).toBe(true);
    expect(r.json()).not.toHaveProperty('executors');
  }, 240000);

  it('the published result schema knows the executors and the new problem codes', () => {
    const schema = read(path.join(REPO_ROOT, 'schemas/contracts/result.schema.json'));
    expect(JSON.parse(schema).properties).toHaveProperty('executors');
    for (const code of ['missing_agent', 'unknown_executor', 'executor_not_allowed']) expect(schema).toContain(code);
    const task = JSON.parse(read(path.join(REPO_ROOT, 'schemas/contracts/task.schema.json')));
    expect(task.properties).toHaveProperty('executor');
  });
});

describe('B116: agents of an executor never gain a way to change the registry or approve', () => {
  it('the hook denies an agent edit or shell write of the registry', () => {
    const p = project();
    p.registry();
    const decide = (tool: string, input: Record<string, string>) => {
      const stdin = JSON.stringify({ cwd: p.root, tool_name: tool, tool_input: input });
      const out = p.cli(['hook', 'pre-tool'], AGENT, stdin).stdout.trim();
      return out ? JSON.parse(out).hookSpecificOutput : { permissionDecision: 'allow' };
    };
    const file = path.join(p.root, 'openspec/executors.yaml');
    const edit = decide('Write', { file_path: file, content: 'executors: {}\n' });
    expect(edit.permissionDecision).toBe('deny');
    expect(edit.permissionDecisionReason).toMatch(/executors\.yaml/);
    expect(decide('Bash', { command: 'echo "executors: {}" > openspec/executors.yaml' }).permissionDecision)
      .toBe('deny');
    expect(decide('Write', { file_path: path.join(p.root, 'docs/executors.md'), content: 'notes\n' })
      .permissionDecision).not.toBe('deny');
  }, 240000);

  it('an agent running as an executor cannot approve a gate', () => {
    const p = project();
    p.registry();
    const r = p.cli(['approve', 'review', '--change', 'add-farewell', '--json'], { SDLC_AGENT: 'swarm-a' });
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('agent_cannot_approve');
  }, 240000);
});
