import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the greenfield E2E team run of 2026-10-16 (TodoMVC 1.0 with Qwen Code; protocol finding 4, finding 7, finding 9), decided by
 * the owner the same day.
 *
 * finding 4: a qa rejection with a note sent the change back to build, and then neither `sdlc status` nor `sdlc next` showed
 * the reason: the qa row said "waiting on the verify gate", next said only "Implement the approved plan". An open
 * rejection of any gate (the latest decision on it is a rejection) is shown with its person and note in `status`,
 * and `next` carries the note, until the gate is approved.
 * finding 7: `sdlc approve spec` ran no validation, so a delta spec that OpenSpec rejects could be approved. Structural
 * errors (a requirement without a scenario, no deltas) now refuse the approval (`spec_invalid`); warnings such as the
 * RFC 2119 "SHALL or MUST" advice are shown to the approver and recorded, and do not refuse: a requirement written
 * in another language has no SHALL. `sdlc validate` judges the same way: warnings alone leave a change valid.
 * finding 9: the tasks template ended with "Run sdlc verify and confirm every required check passes", while the verify gate
 * stays blocked as long as any task is open: the task could only be ticked before the evidence. The template no
 * longer has it, and in a change that still does, a passing `sdlc verify` ticks the task that names `sdlc verify`.
 */

const NOTE = 'Escape saves the edit instead of cancelling it';

function project() {
  const root = tempDir('sdlc-greenfield-findings-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
  config.gates.qa = { required: true };
  write(file, stringify(config));
  const change = (rel: string) => path.join(root, 'openspec/changes/add-farewell', rel);
  return { root, cli, change, file: (rel: string) => path.join(root, rel) };
}

/** A change with intent approved and the spec files written; returns helpers to go further. */
function throughIntent(p: ReturnType<typeof project>) {
  expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(p.change('intent.md'), FILES['intent.md']);
  expect(p.cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
  for (const rel of ['proposal.md', 'design.md']) write(p.change(rel), FILES[rel]);
}

describe('finding 7: the spec gate runs the validation', () => {
  it('a requirement without a scenario refuses the approval as spec_invalid; nothing is approved', () => {
    const p = project();
    throughIntent(p);
    write(p.change('specs/greeting/spec.md'), ['## ADDED Requirements', '', '### Requirement: Farewell message',
      'The system SHALL say goodbye.', ''].join('\n'));
    const r = p.cli(['approve', 'spec', '--change', 'add-farewell', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json<{ status: { code: string; message: string }[] }>().status[0].code).toBe('spec_invalid');
    expect(r.stdout).toMatch(/scenario/i);
    const status = p.cli(['status', '--change', 'add-farewell', '--json']).stdout;
    expect(status).not.toMatch(/"spec"[^}]*"approved"/);
  }, 180000);

  });

describe('finding 9: no task duplicates the verify gate', () => {
  it('the tasks template has no "Run sdlc verify" task', () => {
    const p = project();
    throughIntent(p);
    const r = p.cli(['instructions', 'tasks', '--change', 'add-farewell', '--json']);
    expect(r.code).toBe(0);
    const template = r.json<{ template: string; instruction: string }>().template;
    expect(template).not.toMatch(/sdlc verify/i);
    expect(fs.readFileSync(p.file('openspec/schemas/sdlc/templates/tasks.md'), 'utf8')).not.toMatch(/sdlc verify/i);
  }, 180000);

  it('a passing sdlc verify ticks an old "Run sdlc verify" task and the gate opens; other open tasks stay open', () => {
    const p = project();
    throughIntent(p);
    write(p.change('specs/greeting/spec.md'), FILES['specs/greeting/spec.md']);
    expect(p.cli(['approve', 'spec', '--change', 'add-farewell', '--json']).code).toBe(0);
    write(p.change('plan.md'), FILES['plan.md']);
    const tasks = (open: string) => ['# Tasks', '', '## 1. Farewell', '', '- [x] 1.1 Add the test first',
      open, '', '## 2. Integration', '', '- [ ] 2.1 Run sdlc verify and confirm every required check passes', ''].join('\n');
    write(p.change('tasks.md'), tasks('- [ ] 1.2 Implement farewell'));
    expect(p.cli(['approve', 'plan', '--change', 'add-farewell', '--json']).code).toBe(0);
    write(p.file('test/greet.test.js'), "import test from 'node:test';\ntest('ok', () => {});\n");
    // Another task still open: verify runs, but neither that task nor the verify task is ticked by it.
    p.cli(['verify', '--change', 'add-farewell']);
    expect(read(p.change('tasks.md'))).toContain('- [ ] 1.2 Implement farewell');
    expect(read(p.change('tasks.md'))).toContain('- [ ] 2.1 Run sdlc verify');
    write(p.change('tasks.md'), tasks('- [x] 1.2 Implement farewell'));
    const r = p.cli(['verify', '--change', 'add-farewell']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(read(p.change('tasks.md'))).toContain('- [x] 2.1 Run sdlc verify');
    expect(p.cli(['status', '--change', 'add-farewell']).stdout).toMatch(/verify\s+✓ passed/);
  }, 240000);

  it('negative: a failing sdlc verify does not tick the task', () => {
    const p = project();
    throughIntent(p);
    write(p.change('specs/greeting/spec.md'), FILES['specs/greeting/spec.md']);
    expect(p.cli(['approve', 'spec', '--change', 'add-farewell', '--json']).code).toBe(0);
    write(p.change('plan.md'), FILES['plan.md']);
    write(p.change('tasks.md'), ['# Tasks', '', '## 1. Farewell', '', '- [x] 1.1 Implement', '',
      '- [ ] 1.2 Run sdlc verify and confirm every required check passes', ''].join('\n'));
    expect(p.cli(['approve', 'plan', '--change', 'add-farewell', '--json']).code).toBe(0);
    write(p.file('test/greet.test.js'), "import test from 'node:test';\ntest('red', () => { throw new Error('red'); });\n");
    expect(p.cli(['verify', '--change', 'add-farewell']).code).not.toBe(0);
    expect(read(p.change('tasks.md'))).toContain('- [ ] 1.2 Run sdlc verify');
  }, 240000);
});

describe('finding 4: an open rejection is visible in status and next', () => {
  it('after a qa rejection while the change is back in build, status and next show the person and the note', () => {
    const p = project();
    throughIntent(p);
    write(p.change('specs/greeting/spec.md'), FILES['specs/greeting/spec.md']);
    expect(p.cli(['approve', 'spec', '--change', 'add-farewell', '--json']).code).toBe(0);
    write(p.change('plan.md'), FILES['plan.md']);
    write(p.change('tasks.md'), ['# Tasks', '', '## 1. Farewell', '', '- [x] 1.1 Add the test first',
      '- [ ] 1.2 Implement farewell', ''].join('\n'));
    expect(p.cli(['approve', 'plan', '--change', 'add-farewell', '--json']).code).toBe(0);
    const rejected = p.cli(['reject', 'qa', '--change', 'add-farewell', '--note', NOTE, '--json']);
    expect(rejected.code, rejected.stdout + rejected.stderr).toBe(0);
    const status = p.cli(['status', '--change', 'add-farewell']).stdout;
    const qaRow = status.split('\n').find((line) => /^\s+qa\s/.test(line)) ?? '';
    expect(qaRow).toMatch(/rejected/);
    expect(status).toContain(NOTE);
    expect(p.cli(['next', '--change', 'add-farewell']).stdout).toContain(NOTE);
    const next = p.cli(['next', '--change', 'add-farewell', '--json']).json<{ next: { message: string } }>();
    expect(next.next.message).toContain(NOTE);
  }, 240000);

  it('negative: without a rejection nothing says rejected', () => {
    const p = project();
    throughIntent(p);
    const status = p.cli(['status', '--change', 'add-farewell']).stdout;
    expect(status).not.toMatch(/rejected/);
    expect(p.cli(['next', '--change', 'add-farewell']).stdout).not.toMatch(/rejected/);
  }, 180000);
  it('warnings do not refuse English requirements without SHALL', () => {
    const p = project();
    throughIntent(p);
    write(p.change('specs/greeting/spec.md'), ['## ADDED Requirements', '', '### Requirement: Farewell message',
      'The system says goodbye with the name.', '', '#### Scenario: Named farewell', '- **WHEN** Ada signs out',
      '- **THEN** the message is "Goodbye, Ada"', ''].join('\n'));
    const english = p.cli(['approve', 'spec', '--change', 'add-farewell']);
    expect(english.code, english.stdout + english.stderr).toBe(0);
    expect(english.stdout + english.stderr).toMatch(/SHALL/);
    const log = read(p.file('openspec/.sdlc/log.jsonl'));
    expect(log.split('\n').find((l) => l.includes('gate.spec.approved'))).toMatch(/warning/i);

  }, 240000);
});
