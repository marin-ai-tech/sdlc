import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { stepper } from '../src/cli/progress.js';
import { loadConfig } from '../src/core/config.js';
import { collectHealth } from '../src/core/health/index.js';
import type { FindingDraft } from '../src/core/health/model.js';
import { parseHealth } from '../src/core/health/thresholds.js';
import { projectPaths } from '../src/core/project.js';
import { buildTrace } from '../src/core/trace.js';
import { listActiveChanges } from '../src/core/changes.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E3 (onboarding) and E8 (dashboard and health) team runs of 2026-10-16, decided by the owner the same
 * day for 0.22.2.
 *
 * О1: the tour starts with `sdlc init` and the demo; a person joining a project that already uses sdlc gets no path
 * (clone, `sdlc doctor --fix`, the entry in roles.yaml, `sdlc next --me`).
 * О2: the stage table of `sdlc guide lifecycle` has no qa gate, so an agent answering from it skipped a required qa.
 * О3: "The workflows" does not say they are the agent's workflows nor how to call them; an agent invented
 * `sdlc intent --change <id>`.
 * О4: `sdlc explain` with no active change advised `sdlc new <name>` while `sdlc next` offered a ready backlog item.
 * О5: a title without Latin letters but with digits gave the change id `200`; the `b<n>` fallback only covered an
 * empty id.
 * О6: on the lite track the terminal stepper marked intent as current, though intent does not apply.
 * А1, О7 (as a hint): changes on other branches were invisible on `main` to `next --me`, `health`, the report and the
 * dashboard. They now name the changes found on other branches (as of the last fetch) and the branch.
 * А2: `daysSince` rounded down to whole days, so fractional `stalled_days` and `lock_days` never triggered.
 * А3: the dashboard showed agent commits only, not the agent's share of the log.
 * А4: with no SDLC-Task trailers in the history, every task was a separate "task without a commit" gap.
 * А5: `sdlc report` without `--since` printed the whole log, oldest first, under "Recent events".
 * А6: the sdlc-health workflow gave no form of `sdlc backlog move`; an agent invented `move B6 ready`.
 * А7: no health finding looked at gate rejections: three qa rounds on one change went unnoticed.
 */

const DAY = 86_400_000;
const RU_TITLE = 'Название задачи не длиннее 200 символов';

function project(tools = 'claude') {
  const root = tempDir('sdlc-onboarding-health-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node -e 0' } }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  write(file, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  return { root, cli, file, health: (now?: Date) => collectHealth(root, projectPaths(root), loadConfig(file), {
    light: true, ...(now ? { now } : {}) }) };
}

function setHealth(p: ReturnType<typeof project>, health: Record<string, number>): void {
  const config = parse(read(p.file));
  config.health = health;
  write(p.file, stringify(config));
}

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function finding(drafts: FindingDraft[], id: string): FindingDraft | undefined {
  return drafts.find((draft) => draft.id === id);
}

describe('А2: fractional day thresholds', () => {
  it('stalled_days 0.5 finds a change idle for 0.75 day and not one idle for 0.25 day; the age is not shown as 0', () => {
    const p = project();
    setHealth(p, { stalled_days: 0.5 });
    expect(p.cli(['new', 'idle-one', '--json']).code).toBe(0);
    const early = finding(p.health(new Date(Date.now() + 0.25 * DAY)), 'flow.stalled');
    expect(early?.facts ?? []).toEqual([]);
    const late = finding(p.health(new Date(Date.now() + 0.75 * DAY)), 'flow.stalled');
    expect(late?.facts.map((fact) => fact.params?.change)).toEqual(['idle-one']);
    expect(Number(late!.facts[0].params?.days)).toBeGreaterThan(0);
  }, 180000);

  it('lock_days 0.5 finds tests locked for 0.75 day', () => {
    const p = project();
    setHealth(p, { lock_days: 0.5 });
    expect(p.cli(['new', 'fix-x', '--kind', 'bugfix', '--risk', 'low', '--json']).code).toBe(0);
    expect(p.cli(['tests', 'lock', '--change', 'fix-x', '--json']).code).toBe(0);
    expect(finding(p.health(new Date(Date.now() + 0.25 * DAY)), 'discipline.test_lock')?.facts ?? []).toEqual([]);
    const late = finding(p.health(new Date(Date.now() + 0.75 * DAY)), 'discipline.test_lock');
    expect(late?.facts.map((fact) => fact.params?.change)).toEqual(['fix-x']);
  }, 180000);
});

describe('О5: change ids from backlog titles', () => {
  it('a title with digits but no Latin letters starts the change as b<n>, never as the digits', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', RU_TITLE, '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    const r = p.cli(['backlog', 'start', 'B1', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const ids = listActiveChanges(projectPaths(p.root)).map((ref) => ref.id);
    expect(ids).toEqual(['b1']);
    expect(ids).not.toContain('200');
  }, 180000);

  it('a Latin title still gives a kebab-case id', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', 'Add CSV export 2', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    expect(p.cli(['backlog', 'start', 'B1', '--json']).code).toBe(0);
    expect(listActiveChanges(projectPaths(p.root)).map((ref) => ref.id)).toEqual(['add-csv-export-2']);
  }, 180000);
});

describe('О4: explain with no active change', () => {
  it('points to the ready backlog item, not to `sdlc new`', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', 'Add export', '--outcome', 'O', '--accept', 'A', '--json']).code).toBe(0);
    const text = p.cli(['explain']);
    expect(text.code, text.stdout + text.stderr).toBe(0);
    expect(text.stdout).toContain('sdlc backlog start B1');
    expect(text.stdout + text.stderr).not.toContain('sdlc new');
    const json = p.cli(['explain', '--json']);
    expect(json.code).toBe(0);
    expect(JSON.stringify(json.json())).toContain('sdlc backlog start B1');
  }, 180000);

  it('negative: with no backlog either, it still says how to start a change', () => {
    const p = project();
    const r = p.cli(['explain']);
    expect(r.stdout + r.stderr).toContain('sdlc new');
    expect(r.stdout + r.stderr).not.toContain('backlog start');
  }, 180000);
});

describe('О6: the stepper on the lite track', () => {
  const gate = (id: string, status: string, required: boolean) => ({ id, status, required });
  it('does not mark intent or spec as current when they do not apply', () => {
    const lite = stepper({
      gates: [gate('intent', 'blocked', false), gate('spec', 'blocked', false), gate('plan', 'pending', true),
        gate('verify', 'blocked', true), gate('review', 'blocked', true)],
      tasks: { complete: 0, total: 0 },
    });
    expect(lite).toContain('plan ●');
    expect(lite).not.toMatch(/intent ●|spec ●/);
  });

  it('negative: on the full track a pending intent is still current', () => {
    const full = stepper({
      gates: [gate('intent', 'pending', true), gate('spec', 'blocked', true), gate('plan', 'blocked', true)],
      tasks: { complete: 0, total: 0 },
    });
    expect(full).toContain('intent ●');
  });
});

describe('О1, О2, О3: the guide', () => {
  it('the first tour step tells a person joining an existing project what to run, in both languages', () => {
    const p = project();
    for (const locale of ['en', 'ru']) {
      const r = p.cli(['guide', 'tour', '--locale', locale]);
      expect(r.code).toBe(0);
      expect(r.stdout, locale).toContain('sdlc doctor --fix');
      expect(r.stdout, locale).toContain('sdlc next --me');
      expect(r.stdout, locale).toContain('roles.yaml');
    }
  }, 180000);

  it('the lifecycle guide names the qa gate and how the workflows are called, in both languages', () => {
    const p = project();
    for (const locale of ['en', 'ru']) {
      const r = p.cli(['guide', 'lifecycle', '--locale', locale]);
      expect(r.code).toBe(0);
      expect(r.stdout, locale).toMatch(/\bqa\b/);
      expect(r.stdout, locale).toContain('/sdlc:intent');
      expect(r.stdout, locale).toContain('$sdlc-intent');
      expect(r.stdout, locale).toContain('/sdlc-intent');
      expect(r.stdout, locale).toContain('sdlc intent');
    }
    const en = p.cli(['guide', 'lifecycle', '--locale', 'en']).stdout;
    expect(en).toMatch(/no `?sdlc intent`? command|not `?sdlc`? (sub)?commands/i);
  }, 180000);
});

describe('А6: the health workflow names the backlog move form', () => {
  it('step 6 gives `sdlc backlog move <B-id>` with --top, --before or --after; no status argument', () => {
    const text = read(path.join(REPO_ROOT, 'assets/workflows/health.md'));
    expect(text).toMatch(/sdlc backlog move <B-id> (--top|--before <B-id>|--after <B-id>)/);
    expect(text).not.toMatch(/backlog move <B-id> (ready|open|todo)/);
  });
});

describe('А7: repeated gate rejections are a health finding', () => {
  it('a gate rejected twice on one change is quality.rejections; a single rejection is not', () => {
    expect(parseHealth({ rejections: 3 }, 'h')?.rejections).toBe(3);
    const p = project();
    for (const id of ['twice', 'once']) {
      expect(p.cli(['new', id, '--json']).code).toBe(0);
      write(path.join(p.root, `openspec/changes/${id}/intent.md`), INTENT);
    }
    for (const note of ['first', 'second']) {
      const r = p.cli(['reject', 'intent', '--change', 'twice', '--note', note, '--json']);
      expect(r.code, r.stdout + r.stderr).toBe(0);
    }
    expect(p.cli(['reject', 'intent', '--change', 'once', '--note', 'one', '--json']).code).toBe(0);
    const found = finding(p.health(), 'quality.rejections');
    expect(found?.facts.map((fact) => [fact.params?.change, fact.params?.gate, Number(fact.params?.count)]))
      .toEqual([['twice', 'intent', 2]]);
  }, 180000);
});

describe('А5: the report lists recent events, newest first', () => {
  it('without --since: at most 20 events, the newest first; with --since: the whole period', () => {
    const p = project('none');
    for (let index = 1; index <= 25; index += 1) {
      expect(p.cli(['backlog', 'add', `Item ${index}`, '--json']).code).toBe(0);
    }
    const section = (md: string) => md.split(/^## /m).find((part) => part.startsWith('Recent events')) ?? '';
    const recent = section(p.cli(['report']).stdout).split('\n').filter((l) => l.startsWith('- '));
    expect(recent.length).toBeGreaterThan(0);
    expect(recent.length).toBeLessThanOrEqual(20);
    expect(recent[0]).toContain('B25 Item 25');
    expect(recent.join('\n')).not.toContain('B1 Item 1\n');
    expect(recent.some((l) => /B1 Item 1$/.test(l))).toBe(false);
    const today = new Date().toISOString().slice(0, 10);
    const period = section(p.cli(['report', '--since', today]).stdout).split('\n').filter((l) => l.startsWith('- '));
    expect(period[0]).toContain('B25 Item 25');
    expect(period.some((l) => /B1 Item 1$/.test(l))).toBe(true);
  }, 300000);
});

describe('А3: the dashboard shows the agent share of the log', () => {
  it('has an "Agent log events" tile next to agent commits', () => {
    const p = project('none');
    const out = path.join(p.root, 'dashboard.html');
    expect(p.cli(['dashboard', '--out', 'dashboard.html']).code).toBe(0);
    const html = read(out);
    expect(html).toContain('Agent commits');
    expect(html).toContain('Agent log events');
  }, 180000);
});

describe('А4: trace gaps without SDLC-Task trailers', () => {
  function withTasks() {
    const p = project('none');
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/add-x/tasks.md'),
      ['## 1. Work', '', '- [x] 1.1 First', '- [ ] 1.2 Second', '- [ ] 1.3 Third', ''].join('\n'));
    const ref = () => listActiveChanges(projectPaths(p.root)).find((entry) => entry.id === 'add-x')!;
    return { p, ref };
  }

  it('no commit names a task: one gap for the change instead of one per task', () => {
    const { p, ref } = withTasks();
    const gaps = buildTrace(p.root, ref()).gaps;
    expect(gaps.filter((gap) => gap.kind === 'task-without-commit')).toEqual([]);
    expect(gaps.filter((gap) => gap.kind === 'tasks-without-trailers')).toEqual([
      { kind: 'tasks-without-trailers', ref: '3' }]);
  }, 180000);

  it('negative: once a commit names a task, the other tasks are gaps one by one', () => {
    const { p, ref } = withTasks();
    write(path.join(p.root, 'src/a.js'), 'export const a = 1;\n');
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'feat: a\n\nSDLC-Change: add-x\nSDLC-Task: 1.1']);
    const gaps = buildTrace(p.root, ref()).gaps;
    expect(gaps.filter((gap) => gap.kind === 'task-without-commit').map((gap) => gap.ref)).toEqual(['1.2', '1.3']);
    expect(gaps.some((gap) => gap.kind === 'tasks-without-trailers')).toBe(false);
  }, 180000);
});

describe('А1, О7: changes on other branches are named', () => {
  /** main has `here`; feat/away adds `away`; feat/here-too carries `here` as well; feat/done carries `done`, archived on main. */
  function branches() {
    const p = project('none');
    expect(p.cli(['new', 'here', '--json']).code).toBe(0);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'here']);
    git(p.root, ['branch', 'feat/here-too']);
    git(p.root, ['checkout', '-q', '-b', 'feat/away']);
    expect(p.cli(['new', 'away', '--json']).code).toBe(0);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'away']);
    git(p.root, ['checkout', '-q', '-b', 'feat/done', 'main']);
    write(path.join(p.root, 'openspec/changes/done/intent.md'), INTENT);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'done']);
    git(p.root, ['checkout', '-q', 'main']);
    write(path.join(p.root, 'openspec/changes/archive/2026-10-16-done/intent.md'), INTENT);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'archive done']);
    return p;
  }

  it('next --me, health, the report and the dashboard on main name `away` and its branch, and nothing else', () => {
    const p = branches();
    const me = p.cli(['next', '--me', '--json']);
    expect(me.code, me.stdout + me.stderr).toBe(0);
    expect(me.json<{ otherBranches: Array<{ id: string; branch: string }> }>().otherBranches)
      .toEqual([{ id: 'away', branch: 'feat/away' }]);
    expect(p.cli(['next', '--me']).stdout).toContain('feat/away');
    const hint = finding(p.health(), 'flow.branches');
    expect(hint?.level).toBe('info');
    expect(hint?.facts.map((fact) => [fact.params?.change, fact.params?.branch])).toEqual([['away', 'feat/away']]);
    const report = p.cli(['report', '--format', 'json']);
    expect(report.code).toBe(0);
    expect(report.json<{ otherBranches: unknown }>().otherBranches).toEqual([{ id: 'away', branch: 'feat/away' }]);
    expect(p.cli(['report']).stdout).toContain('feat/away');
    expect(p.cli(['dashboard', '--out', 'dashboard.html']).code).toBe(0);
    const html = read(path.join(p.root, 'dashboard.html'));
    expect(html).toContain('feat/away');
    for (const text of [JSON.stringify(me.json()), html, p.cli(['report']).stdout]) {
      expect(text).not.toContain('feat/here-too');
      expect(text).not.toContain('feat/done');
    }
  }, 300000);

  it('negative: a repository with one branch has no hint', () => {
    const p = project('none');
    expect(p.cli(['new', 'solo', '--json']).code).toBe(0);
    expect(p.cli(['next', '--me', '--json']).json<{ otherBranches: unknown[] }>().otherBranches).toEqual([]);
    expect(finding(p.health(), 'flow.branches')?.facts ?? []).toEqual([]);
    expect(fs.existsSync(path.join(p.root, '.git'))).toBe(true);
  }, 180000);
});
