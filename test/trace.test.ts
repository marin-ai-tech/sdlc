import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * `sdlc trace <change>` links intent → requirements → scenarios → tasks → commits → evidence → review findings, and
 * lists the gaps. A commit belongs to a task by the trailers `SDLC-Change: <id>` and `SDLC-Task: <n.m>` (task numbers
 * repeat across changes, so the change is named too).
 */

const SPEC = [
  '# Spec Delta', '', '## ADDED Requirements', '',
  '### Requirement: Addition', 'The calculator SHALL add two numbers.', '',
  '#### Scenario: two numbers', '- **WHEN** 2 + 3', '- **THEN** 5', '',
  '#### Scenario: negative numbers', '- **WHEN** -2 + -3', '- **THEN** -5', '',
  '### Requirement: Division', 'The calculator SHALL divide.', '',
].join('\n');

const TASKS = ['# Tasks', '', '## 1. Addition', '', '- [x] 1.1 Implement add', '- [x] 1.2 Test add', '',
  '## 2. Integration', '', '- [ ] 2.1 Run sdlc verify', ''].join('\n');

const VERIFICATION = ['# Verification: demo', '', '## Behavioral verification', '',
  '| Scenario / proof item | What was run | What was seen | Result |', '|---|---|---|---|',
  '| two numbers | npm test | 5 | PASS |', ''].join('\n');

const REVIEW = ['# Review: demo', '', '## Findings', '',
  '### F1 [important][correctness] Overflow not handled', '- **Status**: fixed', '',
  '### F2 [minor][style] Naming', 'Rename add to sum.', ''].join('\n');

function commit(root: string, file: string, message: string): void {
  write(path.join(root, file), `${file}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', message]);
}

function project() {
  const root = tempDir('sdlc-trace-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/demo');
  write(path.join(dir, 'intent.md'), '# Intent: calculator\n');
  write(path.join(dir, 'specs/calc/spec.md'), SPEC);
  write(path.join(dir, 'tasks.md'), TASKS);
  write(path.join(dir, 'verification.md'), VERIFICATION);
  write(path.join(dir, 'review.md'), REVIEW);
  commit(root, 'src/add.js', 'feat: add\n\nSDLC-Change: demo\nSDLC-Task: 1.1');
  commit(root, 'test/add.test.js', 'test: add\n\nSDLC-Change: demo\nSDLC-Task: 1.2');
  commit(root, 'src/other.js', 'feat: other change\n\nSDLC-Change: other\nSDLC-Task: 2.1');
  return { root, cli, dir };
}

describe('sdlc trace <change>', () => {
  it('links requirements, scenarios, tasks, commits, evidence and findings', () => {
    const p = project();
    const r = p.cli(['trace', 'demo', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const trace = r.json();
    expect(trace.intent).toMatchObject({ title: 'calculator' });
    const addition = trace.requirements.find((req: { name: string }) => req.name === 'Addition');
    expect(addition.scenarios.map((s: { name: string }) => s.name)).toEqual(['two numbers', 'negative numbers']);
    expect(addition.scenarios[0].evidence).toEqual([expect.objectContaining({ result: 'PASS' })]);
    const tasks = Object.fromEntries(trace.tasks.map((t: { id: string; commits: string[] }) => [t.id, t.commits]));
    expect(tasks['1.1']).toHaveLength(1);
    expect(tasks['1.2']).toHaveLength(1);
    expect(trace.findings.map((f: { id: string; status?: string }) => `${f.id}:${f.status ?? '-'}`)).toEqual(['F1:fixed', 'F2:-']);
  }, 120000);

  it('lists the gaps, and nothing that is linked', () => {
    const trace = project().cli(['trace', 'demo', '--json']).json();
    const gaps = trace.gaps.map((g: { kind: string; ref: string }) => `${g.kind}:${g.ref}`).sort();
    expect(gaps).toEqual([
      'finding-without-status:F2',
      'requirement-without-scenario:Division',
      'scenario-without-evidence:negative numbers',
      'task-without-commit:2.1',
    ]);
  }, 120000);

  it('the text output shows the chain and the gaps', () => {
    const out = project().cli(['trace', 'demo']).stdout;
    for (const text of ['Addition', 'two numbers', '1.1', 'F1', 'Division', 'negative numbers', '2.1', 'F2']) {
      expect(out, text).toContain(text);
    }
    expect(out).toMatch(/gaps/i);
  }, 120000);

  it('works for an archived change', () => {
    const p = project();
    const archived = path.join(p.root, 'openspec/changes/archive/2026-10-05-demo');
    fs.mkdirSync(path.dirname(archived), { recursive: true });
    fs.renameSync(p.dir, archived);
    const r = p.cli(['trace', 'demo', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.json().requirements.map((req: { name: string }) => req.name)).toEqual(['Addition', 'Division']);
  }, 120000);

  it('the build workflow asks for the trailers that link a commit to its task', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'opencode', '--json']).code).toBe(0);
    const build = fs.readFileSync(path.join(p.root, '.opencode/commands/sdlc-build.md'), 'utf-8');
    expect(build).toContain('SDLC-Change: <id>');
    expect(build).toContain('SDLC-Task: <n.m>');
  }, 120000);

  it('negative: an unknown change is refused, and help lists the command', () => {
    const p = project();
    const r = p.cli(['trace', 'nothing', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('change_not_found');
    const names = p.cli(['help', '--json']).json().commands.map((c: { name: string }) => c.name);
    expect(names).toContain('trace');
  }, 120000);
});
