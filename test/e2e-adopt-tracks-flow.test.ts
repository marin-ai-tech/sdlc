import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E4 (adopting node-semver) and E5 (tracks and human decisions) team runs of 2026-10-16, decided by
 * the owner for 0.22.3: the lifecycle and the change record.
 *
 * finding 6: after `sdlc rework <gate>` the hint asked the person to approve the artifact that had not changed yet; it is
 * the agent's turn to revise it from the rework note, as after a rejection.
 * finding 7: a change created with `sdlc new` could not be tied to a backlog item afterwards: `sdlc backlog link <B> --change
 * <id>` links it (the item becomes in progress, the change records the item as its source).
 * finding 8: `sdlc new <id>` and `sdlc backlog start <B> --change <id>` accepted the id of an archived change and the audit
 * showed two changes with one id.
 * finding 9: a change created by mistake could only be removed with git: `sdlc drop <change> --note` (a person only) closes
 * it as dropped: logged, moved to the archive with the reason, its deltas never reach the living specs, its backlog
 * item goes back to open.
 * finding 3: a change whose plan gate was waived (by the policy or a person) has no tasks.md, and the verify gate stayed
 * blocked on "no tasks.md" forever while `next` repeated "Implement the approved plan".
 * finding 6: running `sdlc approve` again for the same person, role and content recorded another approval event; the
 * audit counted it.
 */

function project(tools = 'none') {
  const root = tempDir('sdlc-adopt-tracks-flow-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node -e 0' } }));
  write(path.join(root, 'README.md'), '# demo\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  write(file, stringify(config));
  const change = (id: string, rel: string) => path.join(root, 'openspec/changes', id, rel);
  const log = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  return { root, cli, file, change, log };
}

type P = ReturnType<typeof project>;

/** intent and spec approved, plan written; approvePlan: approved, else rejected as in the E4 run. */
function throughPlan(p: P, id: string, approvePlan = true, rejectSpecFirst = false): void {
  expect(p.cli(['new', id, '--json']).code).toBe(0);
  write(p.change(id, 'intent.md'), FILES['intent.md']);
  expect(p.cli(['approve', 'intent', '--change', id, '--json']).code).toBe(0);
  for (const rel of ['proposal.md', 'design.md', 'specs/greeting/spec.md']) write(p.change(id, rel), FILES[rel]);
  if (rejectSpecFirst) {
    expect(p.cli(['reject', 'spec', '--change', id, '--note', 'Missing a scenario', '--json']).code).toBe(0);
    const file = p.change(id, 'specs/greeting/spec.md');
    const scenario = ['', '#### Scenario: Empty name', '- **WHEN** no name', '- **THEN** "Goodbye"', ''];
    write(file, read(file) + scenario.join('\n'));
  }
  const spec = p.cli(['approve', 'spec', '--change', id, '--json']);
  expect(spec.code, spec.stdout).toBe(0);
  for (const rel of ['plan.md', 'tasks.md']) write(p.change(id, rel), FILES[rel]);
  const plan = approvePlan
    ? p.cli(['approve', 'plan', '--change', id, '--json'])
    : p.cli(['reject', 'plan', '--change', id, '--note', 'The plan breaks the existing alias', '--json']);
  expect(plan.code, plan.stdout).toBe(0);
}

function nextOf(p: P, id: string) {
  const r = p.cli(['next', '--change', id, '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r.json<{ next: { actor: string; action?: string; gate?: string; cli?: string; message: string } }>().next;
}

describe('finding 6: after a rework the agent revises first', () => {
  for (const [approvePlan, rejectSpecFirst] of [[true, false], [false, false], [false, true]]) {
  it(`rework spec after the plan was ${approvePlan ? 'approved' : 'rejected'}${rejectSpecFirst ? ', the spec rejected once' : ''}: the agent revises the spec first, then the person approves`, () => {
    const p = project();
    throughPlan(p, 'add-farewell', approvePlan, rejectSpecFirst);
    const rework = p.cli(['rework', 'spec', '--change', 'add-farewell', '--reason', 'wrong-assumption',
      '--note', 'The flag already exists as an alias']);
    expect(rework.code, rework.stdout + rework.stderr).toBe(0);
    const hint = rework.stdout.split(/\r?\n/).find((line) => line.startsWith('Next:')) ?? '';
    expect(hint).toMatch(/^Next: agent/);
    expect(hint).not.toMatch(/sdlc approve spec/);
    const before = nextOf(p, 'add-farewell');
    expect(before.actor).toBe('agent');
    expect(before.gate).toBe('spec');
    expect(before.message).toContain('The flag already exists as an alias');
    expect(before.cli ?? '').not.toMatch(/sdlc approve spec/);
    const spec = p.change('add-farewell', 'specs/greeting/spec.md');
    write(spec, read(spec).replace('#### Scenario', '#### Scenario: Alias kept\n- **WHEN** x\n- **THEN** y\n\n#### Scenario'));
    const after = nextOf(p, 'add-farewell');
    expect(after.actor).toBe('human');
    expect(after.cli ?? '').toMatch(/sdlc approve spec --change add-farewell/);
  }, 240000);
  }
});

describe('finding 8: an archived id is not reused', () => {
  function archived(p: P, id: string): void {
    expect(p.cli(['new', id, '--json']).code).toBe(0);
    fs.renameSync(path.join(p.root, 'openspec/changes', id), path.join(p.root, 'openspec/changes/archive', `2026-10-16-${id}`));
  }

  it('sdlc new and backlog start --change refuse the id of an archived change; another id works', () => {
    const p = project();
    fs.mkdirSync(path.join(p.root, 'openspec/changes/archive'), { recursive: true });
    archived(p, 'b1-version');
    const again = p.cli(['new', 'b1-version', '--json']);
    expect(again.code).not.toBe(0);
    expect(again.stdout + again.stderr).toMatch(/archiv/i);
    expect(fs.existsSync(path.join(p.root, 'openspec/changes/b1-version'))).toBe(false);
    expect(p.cli(['backlog', 'add', 'Version flag', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    const start = p.cli(['backlog', 'start', 'B1', '--change', 'b1-version', '--json']);
    expect(start.code).not.toBe(0);
    expect(start.stdout + start.stderr).toMatch(/archiv/i);
    expect(fs.existsSync(path.join(p.root, 'openspec/changes/b1-version'))).toBe(false);
    expect(p.cli(['new', 'b1-version-2', '--json']).code).toBe(0);
  }, 240000);
});

describe('finding 7: link an existing change to a backlog item', () => {
  it('backlog link B1 --change <id>: the item is in progress with the change; the change records the item', () => {
    const p = project();
    expect(p.cli(['new', 'add-export', '--json']).code).toBe(0);
    expect(p.cli(['backlog', 'add', 'Export', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    const link = p.cli(['backlog', 'link', 'B1', '--change', 'add-export', '--json']);
    expect(link.code, link.stdout + link.stderr).toBe(0);
    const backlog = read(path.join(p.root, 'openspec/backlog.md'));
    expect(backlog).toMatch(/### B1 \[in-progress\] Export/);
    expect(backlog).toMatch(/\*\*Change\*\*: add-export/);
    const state = parse(read(p.change('add-export', '.sdlc.yaml')));
    expect(state.source_ref ?? state.source?.ref).toBe('B1');
    expect(p.log().some((e) => e.event === 'backlog.linked' && e.change === 'add-export')).toBe(true);
  }, 240000);

  it('negative: an unknown change, an item linked to another change, and a second link are refused', () => {
    const p = project();
    expect(p.cli(['new', 'one', '--json']).code).toBe(0);
    expect(p.cli(['new', 'two', '--json']).code).toBe(0);
    expect(p.cli(['backlog', 'add', 'Export', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    expect(p.cli(['backlog', 'link', 'B1', '--change', 'nope', '--json']).code).not.toBe(0);
    expect(p.cli(['backlog', 'link', 'B1', '--change', 'one', '--json']).code).toBe(0);
    expect(p.cli(['backlog', 'link', 'B1', '--change', 'two', '--json']).code).not.toBe(0);
    expect(read(path.join(p.root, 'openspec/backlog.md'))).toMatch(/\*\*Change\*\*: one/);
  }, 240000);
});

describe('finding 9: sdlc drop closes a change created by mistake', () => {
  it('a person drops a change with a note: logged, archived as dropped, specs untouched, the backlog item open again', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', 'Export', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    expect(p.cli(['backlog', 'start', 'B1', '--change', 'add-export', '--json']).code).toBe(0);
    write(p.change('add-export', 'specs/greeting/spec.md'), FILES['specs/greeting/spec.md']);
    const specsBefore = fs.readdirSync(path.join(p.root, 'openspec/specs'));
    const drop = p.cli(['drop', 'add-export', '--note', 'Created by mistake: the work is done in b1-version', '--json']);
    expect(drop.code, drop.stdout + drop.stderr).toBe(0);
    expect(fs.existsSync(path.join(p.root, 'openspec/changes/add-export'))).toBe(false);
    const archive = fs.readdirSync(path.join(p.root, 'openspec/changes/archive'));
    const folder = archive.find((name) => name.endsWith('-add-export'));
    expect(folder).toBeDefined();
    const state = parse(read(path.join(p.root, 'openspec/changes/archive', folder!, '.sdlc.yaml')));
    expect(state.dropped).toMatchObject({ note: 'Created by mistake: the work is done in b1-version' });
    expect(fs.readdirSync(path.join(p.root, 'openspec/specs'))).toEqual(specsBefore);
    const entry = p.log().find((e) => e.event === 'change.dropped');
    expect(entry).toMatchObject({ change: 'add-export' });
    expect(read(path.join(p.root, 'openspec/backlog.md'))).toMatch(/### B1 \[open\] Export/);
    const status = p.cli(['status', '--json']).stdout;
    expect(status).not.toContain('"add-export"');
  }, 240000);

  it('negative: without --note, from an agent session, or for an unknown change it is refused and nothing moves', () => {
    const p = project();
    expect(p.cli(['new', 'keep-me', '--json']).code).toBe(0);
    expect(p.cli(['drop', 'keep-me', '--json']).code).not.toBe(0);
    expect(p.cli(['drop', 'keep-me', '--note', 'x', '--json'], { CLAUDECODE: '1' }).code).not.toBe(0);
    expect(p.cli(['drop', 'nope', '--note', 'x', '--json']).code).not.toBe(0);
    expect(fs.existsSync(p.change('keep-me', '.sdlc.yaml'))).toBe(true);
    expect(p.log().some((e) => e.event === 'change.dropped')).toBe(false);
  }, 240000);
});

describe('finding 3: verify without tasks.md when plan was waived', () => {
  function docsChange(p: P, waive: 'policy' | 'person') {
    if (waive === 'policy') {
      const config = parse(read(p.file));
      config.gates.plan = { ...config.gates.plan, auto_waive: { kinds: ['docs'] } };
      write(p.file, stringify(config));
    }
    expect(p.cli(['new', 'readme-run', '--kind', 'docs', '--risk', 'low', '--json']).code).toBe(0);
    expect(p.cli(['track', 'set', 'lite', '--change', 'readme-run', '--note', 'README only', '--json']).code).toBe(0);
    if (waive === 'person') {
      expect(p.cli(['waive', 'plan', '--change', 'readme-run', '--note', 'README only', '--json']).code).toBe(0);
    }
    write(path.join(p.root, 'README.md'), '# demo\n\nRun `npm test`.\n');
  }

  for (const waive of ['policy', 'person'] as const) {
    it(`plan waived by the ${waive}: a passing verify satisfies the verify gate and next moves on`, () => {
      const p = project();
      docsChange(p, waive);
      const verify = p.cli(['verify', '--change', 'readme-run', '--json']);
      expect(verify.code, verify.stdout + verify.stderr).toBe(0);
      const status = p.cli(['status', '--change', 'readme-run', '--json']).json();
      const gate = (status.change ?? status).gates.find((g: { id: string }) => g.id === 'verify');
      expect(gate.satisfied).toBe(true);
      expect(gate.reason ?? '').not.toMatch(/no tasks\.md/);
      const next = nextOf(p, 'readme-run');
      expect(next.message).not.toMatch(/Implement the approved plan/);
    }, 240000);
  }

  it('negative: with plan waived but an open task in tasks.md, verify still waits for the task', () => {
    const p = project();
    docsChange(p, 'policy');
    write(p.change('readme-run', 'tasks.md'), '## 1. Docs\n\n- [ ] 1.1 README section\n');
    expect(p.cli(['verify', '--change', 'readme-run', '--json']).code).toBe(0);
    const status = p.cli(['status', '--change', 'readme-run', '--json']).json();
    const gate = (status.change ?? status).gates.find((g: { id: string }) => g.id === 'verify');
    expect(gate.satisfied).toBe(false);
  }, 240000);
});

describe('finding 6: approving twice records one approval', () => {
  it('a second sdlc approve of the same content by the same person says so and writes nothing', () => {
    const p = project();
    expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
    write(p.change('add-farewell', 'intent.md'), FILES['intent.md']);
    expect(p.cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
    const record = read(p.change('add-farewell', '.sdlc.yaml'));
    const events = p.log().length;
    const again = p.cli(['approve', 'intent', '--change', 'add-farewell']);
    expect(again.code, again.stdout + again.stderr).toBe(0);
    expect(again.stdout + again.stderr).toMatch(/already approved/i);
    expect(read(p.change('add-farewell', '.sdlc.yaml'))).toBe(record);
    expect(p.log().length).toBe(events);
    const audit = p.cli(['audit', '--change', 'add-farewell', '--json']).stdout;
    expect(audit.match(/gate\.intent\.approved/g)?.length ?? 0).toBeLessThanOrEqual(1);
  }, 240000);

  it('negative: after the intent changes, approving again records a new approval', () => {
    const p = project();
    expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
    write(p.change('add-farewell', 'intent.md'), FILES['intent.md']);
    expect(p.cli(['approve', 'intent', '--change', 'add-farewell', '--json']).code).toBe(0);
    write(p.change('add-farewell', 'intent.md'), FILES['intent.md'].replace('say goodbye', 'say goodbye politely'));
    const again = p.cli(['approve', 'intent', '--change', 'add-farewell']);
    expect(again.code).toBe(0);
    expect(again.stdout).not.toMatch(/already approved/i);
    expect(p.log().filter((e) => e.event === 'gate.intent.approved').length).toBe(2);
  }, 240000);
});
