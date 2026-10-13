import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B115 (epic E16): the task contract every executor type receives and returns.
 * - `sdlc task export --change <id> [--task <n.m>] --json` gives one work item per open task (contract `sdlc.task/1`):
 *   the task, risk and kind, the base commit, the plan's files and proof, the spec scenarios, the verify checks, the
 *   paths the executor must not touch, and where the result goes (branch `sdlc/<change>/<task>` and the trailers).
 *   Work is handed out only after the plan gate is approved.
 * - `sdlc task check-result --change <id> --branch <ref> --json` checks a returned branch: every commit carries
 *   `SDLC-Change: <id>` and `SDLC-Task: <a task of the change>`, no forbidden path is touched; files outside the plan
 *   are a warning. It merges nothing and approves nothing; anyone, an agent too, may run both commands.
 * - The contract is published as JSON Schemas in schemas/contracts/.
 */

const OPEN_TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');
const AGENT = { CLAUDECODE: '1' };

function project() {
  const root = tempDir('sdlc-task-contract-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  write(path.join(root, 'README.md'), '# demo\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.enforcement.protected_paths = ['.github/workflows/**'];
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  expect(cli(['new', 'add-farewell', '--risk', 'medium', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  expect(cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  expect(cli(['approve', 'spec', '--change', 'add-farewell', '--json']).code).toBe(0);
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), OPEN_TASKS);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'planning']);
  /** A person approves the plan and the approval is committed on main before any work is handed out. */
  const approvePlan = () => {
    expect(cli(['approve', 'plan', '--change', 'add-farewell', '--json']).code).toBe(0);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'plan approved']);
  };
  const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf-8' }).stdout.trim();
  /** A result branch from the current HEAD with one commit touching `files`. */
  const resultBranch = (branch: string, files: string[], message: string) => {
    git(root, ['checkout', '-q', '-b', branch]);
    for (const rel of files) write(path.join(root, rel), `// ${branch} ${rel}\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
    git(root, ['checkout', '-q', 'main']);
  };
  return { root, cli, approvePlan, head, resultBranch };
}

const trailers = (task: string) => `work\n\nSDLC-Change: add-farewell\nSDLC-Task: ${task}`;

describe('B115: task export', () => {
  it('no work is handed out before the plan is approved', () => {
    const p = project();
    const r = p.cli(['task', 'export', '--change', 'add-farewell', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('plan_not_approved');
    p.approvePlan();
    write(path.join(p.root, 'openspec/changes/add-farewell/plan.md'), `${FILES['plan.md']}\nOne more step.\n`);
    const stale = p.cli(['task', 'export', '--change', 'add-farewell', '--json']);
    expect(stale.code).not.toBe(0);
    expect(stale.json().status[0].code).toBe('plan_not_approved');
  }, 240000);

  it('one work item per open task, with everything an executor needs', () => {
    const p = project();
    p.approvePlan();
    const r = p.cli(['task', 'export', '--change', 'add-farewell', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const items = r.json().items;
    expect(items.map((item: { id: string }) => item.id)).toEqual(['add-farewell#1.1', 'add-farewell#1.2']);
    const item = items[1];
    expect(item.contract).toBe('sdlc.task/1');
    expect(item).toMatchObject({ change: 'add-farewell', risk: 'medium', task: { id: '1.2' } });
    expect(item.task.text).toContain('Implement farewell');
    expect(item.base.commit).toBe(p.head());
    expect(item.plan.files).toEqual(expect.arrayContaining(['src/greet.js', 'test/greet.test.js']));
    expect(item.scenarios).toContain('Named farewell');
    expect(JSON.stringify(item.checks)).toContain('npm test');
    expect(item.forbidden).toEqual(expect.arrayContaining(['openspec/roles.yaml', '.github/workflows/**']));
    expect(item.result).toMatchObject({
      branch: 'sdlc/add-farewell/1.2', trailers: { 'SDLC-Change': 'add-farewell', 'SDLC-Task': '1.2' },
    });
  }, 240000);

  it('--task picks one; an unknown task is refused', () => {
    const p = project();
    p.approvePlan();
    const one = p.cli(['task', 'export', '--change', 'add-farewell', '--task', '1.2', '--json']);
    expect(one.json().items).toHaveLength(1);
    const unknown = p.cli(['task', 'export', '--change', 'add-farewell', '--task', '9.9', '--json']);
    expect(unknown.code).not.toBe(0);
    expect(unknown.json().status[0].code).toBe('unknown_task');
  }, 240000);

  it('the contract is published as JSON Schemas whose required fields the output has', () => {
    const p = project();
    p.approvePlan();
    const item = p.cli(['task', 'export', '--change', 'add-farewell', '--task', '1.1', '--json']).json().items[0];
    const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas/contracts/task.schema.json'), 'utf8'));
    for (const key of schema.required as string[]) expect(item, key).toHaveProperty(key);
    const result = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas/contracts/result.schema.json'), 'utf8'));
    expect(result.required).toEqual(expect.arrayContaining(['ok', 'commits', 'files', 'problems']));
  }, 240000);
});

describe('B115: task check-result', () => {
  it('a branch whose commits carry the trailers and stay in the plan is ok', () => {
    const p = project();
    p.approvePlan();
    p.resultBranch('sdlc/add-farewell/1.2', ['src/greet.js'], trailers('1.2'));
    const r = p.cli(['task', 'check-result', '--change', 'add-farewell', '--branch', 'sdlc/add-farewell/1.2', '--json'],
      AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ ok: true, problems: [] });
    expect(r.json().commits[0].task).toBe('1.2');
    expect(r.json().files).toEqual(['src/greet.js']);
  }, 240000);

  it('negative: missing trailers, an unknown task or a forbidden path fail; outside the plan only warns', () => {
    const p = project();
    p.approvePlan();
    const check = (branch: string) =>
      p.cli(['task', 'check-result', '--change', 'add-farewell', '--branch', branch, '--json']);
    p.resultBranch('no-trailers', ['src/greet.js'], 'work without trailers');
    p.resultBranch('unknown-task', ['src/greet.js'], trailers('9.9'));
    p.resultBranch('forbidden', ['openspec/roles.yaml'], trailers('1.2'));
    p.resultBranch('outside', ['README.md'], trailers('1.2'));
    p.resultBranch('forged-state', ['openspec/changes/add-farewell/.sdlc.yaml'], trailers('1.2'));
    p.resultBranch('new-state', ['openspec/changes/evil/.sdlc.yaml'], trailers('1.2'));
    p.resultBranch('forged-log', ['openspec/.sdlc/log.jsonl'], trailers('1.2'));
    const codes = (branch: string) => check(branch).json().problems.map((problem: { code: string }) => problem.code);
    expect(codes('no-trailers')).toContain('missing_trailer');
    expect(codes('unknown-task')).toContain('unknown_task');
    expect(codes('forbidden')).toContain('forbidden_path');
    expect(check('forbidden').code).toBe(1);
    for (const branch of ['forged-state', 'new-state', 'forged-log']) {
      expect(codes(branch), branch).toContain('forbidden_path');
      expect(check(branch).json().ok, branch).toBe(false);
    }
    const outside = check('outside');
    expect(outside.code).toBe(0);
    expect(outside.json().ok).toBe(true);
    expect(JSON.stringify(outside.json().warnings)).toContain('outside_plan');
    const missing = check('no-such-branch');
    expect(missing.code).not.toBe(0);
  }, 240000);
});
