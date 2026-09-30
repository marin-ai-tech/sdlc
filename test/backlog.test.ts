import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addBacklogItem,
  addEpic,
  BACKLOG_PATH,
  epicProgress,
  moveBacklogItem,
  nextBacklogItem,
  parseBacklog,
  readBacklog,
  setBacklogStatus,
} from '../src/core/backlog.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const NOW = new Date('2026-10-01T12:00:00Z');
const SAMPLE = [
  '# Backlog', '', 'Order is priority.', '',
  '## E1 Claims self-service', 'Goal: policyholders see claim status without calling support.', '',
  '### B1 [open] Show claim stage', '- **Kind**: feature', '- **Risk**: medium', '- **Outcome**: policyholders see the stage',
  '- **Acceptance**:', '  - a claim in review shows "in review"', '  - another policyholder\'s claim is never listed',
  '- **Source**: bmad spec.md CAP-1', '',
  '### B2 [open] Stage change email', '- **Outcome**: an email on stage change', '- **Acceptance**:', '  - one email within 5 minutes', '- **Depends on**: B1', '',
  '### B3 [in-progress] Portal login', '- **Outcome**: log in', '- **Acceptance**:', '  - works', '- **Change**: portal-login', '',
  '## Unassigned', '',
  '### B7 [open] Rate-limit export', '- **Source**: deferred D3', '',
  '```', '### B9 [open] inside code', '```',
].join('\n');

const ids = (items: Array<{ id: string }>) => items.map((i) => i.id);

describe('backlog (core)', () => {
  it('parses epics, items in priority order, fields and multi-line acceptance', () => {
    const b = parseBacklog(SAMPLE);
    expect(b.epics).toEqual([expect.objectContaining({ id: 'E1', title: 'Claims self-service', goal: 'policyholders see claim status without calling support.' })]);
    expect(ids(b.items)).toEqual(['B1', 'B2', 'B3', 'B7']);
    expect(b.items[0]).toMatchObject({ epic: 'E1', kind: 'feature', risk: 'medium', outcome: 'policyholders see the stage', source: 'bmad spec.md CAP-1' });
    expect(b.items[0].acceptance).toEqual(['a claim in review shows "in review"', 'another policyholder\'s claim is never listed']);
    expect(b.items[3].epic).toBeUndefined();
    expect(b.items[2]).toMatchObject({ status: 'in-progress', change: 'portal-login' });
  });

  it('computes readiness: outcome + acceptance + dependencies done', () => {
    const b = parseBacklog(SAMPLE);
    const [b1, b2, , b7] = b.items;
    expect(b1.ready).toBe(true);
    expect(b2).toMatchObject({ ready: false, blockedBy: ['B1'] });
    expect(b7.ready).toBe(false);
    expect(b7.missing.join(' ')).toMatch(/outcome/i);
    expect(b7.missing.join(' ')).toMatch(/acceptance/i);
    expect(nextBacklogItem(b)?.id).toBe('B1');
  });

  it('negative: an in-progress or done item is never next, and a dependency on an unknown id blocks', () => {
    const b = parseBacklog(SAMPLE.replace('### B1 [open]', '### B1 [done]').replace('- **Depends on**: B1', '- **Depends on**: B1, B99'));
    expect(b.items[1].blockedBy).toEqual(['B99']);
    expect(nextBacklogItem(b)).toBeUndefined();
  });

  it('adds epics and items with new ids at the end of their section; ids are never reused', () => {
    const root = tempDir();
    const e1 = addEpic(root, { title: 'Claims self-service', goal: 'no status calls' });
    expect(e1.id).toBe('E1');
    const a = addBacklogItem(root, { title: 'Show claim stage', epic: 'E1', kind: 'feature', risk: 'medium', outcome: 'see the stage', acceptance: ['in review shows'] });
    const u = addBacklogItem(root, { title: 'Rate-limit export', source: 'deferred D3' });
    const c = addBacklogItem(root, { title: 'Stage email', epic: 'E1', outcome: 'email', acceptance: ['within 5 min'], dependsOn: ['B1'] });
    expect([a.id, u.id, c.id]).toEqual(['B1', 'B2', 'B3']);
    const b = readBacklog(root);
    expect(ids(b.items)).toEqual(['B1', 'B3', 'B2']);
    expect(read(path.join(root, BACKLOG_PATH))).toMatch(/^# Backlog/);
    write(path.join(root, BACKLOG_PATH), read(path.join(root, BACKLOG_PATH)).replace(/### B3[\s\S]*?(?=\n## |\n### |$)/, ''));
    expect(addBacklogItem(root, { title: 'Next' }).id).toBe('B4');
    expect(addEpic(root, { title: 'Second' }).id).toBe('E2');
  });

  it('negative: unknown epic, unknown dependency, dependency cycles and multi-line text are refused', () => {
    const root = tempDir();
    expect(() => addBacklogItem(root, { title: 'x', epic: 'E9' })).toThrow(/E9/);
    expect(() => addBacklogItem(root, { title: 'x', dependsOn: ['B9'] })).toThrow(/B9/);
    expect(() => addBacklogItem(root, { title: 'two\nlines' })).toThrow();
    addBacklogItem(root, { title: 'A' });
    write(path.join(root, BACKLOG_PATH), `${read(path.join(root, BACKLOG_PATH))}\n### B2 [open] B\n- **Depends on**: B3\n\n### B3 [open] C\n- **Depends on**: B2\n`);
    expect(() => addBacklogItem(root, { title: 'D', dependsOn: ['B2'] })).toThrow(/cycle/i);
  });

  it('moves items: to the top, before/after another item (joining its epic), to another epic', () => {
    const root = tempDir();
    addEpic(root, { title: 'One' });
    addEpic(root, { title: 'Two' });
    for (const t of ['a', 'b', 'c']) addBacklogItem(root, { title: t, epic: 'E1' });
    addBacklogItem(root, { title: 'd', epic: 'E2' });
    moveBacklogItem(root, 'B3', { top: true });
    expect(ids(readBacklog(root).items)).toEqual(['B3', 'B1', 'B2', 'B4']);
    moveBacklogItem(root, 'B4', { before: 'B1' });
    expect(readBacklog(root).items.find((i) => i.id === 'B4')!.epic).toBe('E1');
    expect(ids(readBacklog(root).items)).toEqual(['B3', 'B4', 'B1', 'B2']);
    moveBacklogItem(root, 'B3', { epic: 'E2' });
    expect(readBacklog(root).items.find((i) => i.id === 'B3')!.epic).toBe('E2');
    expect(() => moveBacklogItem(root, 'B9', { top: true })).toThrow(/B9/);
  });

  it('status transitions record the change and a dated closing note; invalid transitions are refused', () => {
    const root = tempDir();
    addBacklogItem(root, { title: 'a', outcome: 'o', acceptance: ['x'] });
    expect(setBacklogStatus(root, 'B1', 'in-progress', { change: 'do-a' }, NOW)).toMatchObject({ status: 'in-progress', change: 'do-a' });
    const done = setBacklogStatus(root, 'B1', 'done', { note: 'archived' }, NOW);
    expect(done.status).toBe('done');
    expect(done.closed).toMatch(/2026-10-01 done/);
    expect(() => setBacklogStatus(root, 'B1', 'in-progress', { change: 'again' }, NOW)).toThrow(/transition/i);
    addBacklogItem(root, { title: 'b' });
    expect(() => setBacklogStatus(root, 'B2', 'in-progress', {}, NOW)).toThrow(/change/i);
  });

  it('epic progress counts items by status', () => {
    const p = epicProgress(parseBacklog(SAMPLE));
    expect(p).toEqual([expect.objectContaining({ epic: expect.objectContaining({ id: 'E1' }), total: 3, open: 2, inProgress: 1, done: 0, dropped: 0 })]);
  });
});

describe('sdlc backlog (CLI)', () => {
  function project() {
    const root = tempDir('sdlc-backlog-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    return { root, cli };
  }
  const AGENT = { CLAUDECODE: '1' };

  it('epic add, add, list, next; agents may add; logged', () => {
    const { root, cli } = project();
    expect(cli(['backlog', 'epic', 'add', 'Claims self-service', '--goal', 'no status calls', '--json']).json().epic.id).toBe('E1');
    const a = cli(['backlog', 'add', 'Show claim stage', '--epic', 'E1', '--kind', 'feature', '--risk', 'medium', '--outcome', 'see the stage', '--accept', 'in review shows', '--accept', 'others never listed', '--json'], AGENT);
    expect(a.code, a.stderr).toBe(0);
    expect(a.json().item).toMatchObject({ id: 'B1', epic: 'E1', ready: true, acceptance: ['in review shows', 'others never listed'] });
    cli(['backlog', 'add', 'Stage email', '--epic', 'E1', '--outcome', 'email', '--accept', 'within 5 min', '--depends', 'B1', '--json']);
    cli(['backlog', 'add', 'Rate-limit export', '--json']);

    const list = cli(['backlog', 'list', '--json']).json();
    expect(ids(list.items)).toEqual(['B1', 'B2', 'B3']);
    expect(list.epics[0]).toMatchObject({ id: 'E1', total: 2, open: 2 });
    expect(ids(cli(['backlog', 'list', '--ready', '--json']).json().items)).toEqual(['B1']);
    expect(cli(['backlog', 'next', '--json']).json().item.id).toBe('B1');
    expect(cli(['backlog', 'list']).stdout).toMatch(/E1[\s\S]*B1[\s\S]*Show claim stage/);

    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(expect.arrayContaining(['backlog.epic.added', 'backlog.added']));
  });

  it('move and drop are human decisions: refused for agents, denied by the hook, logged for people', () => {
    const { root, cli } = project();
    cli(['backlog', 'add', 'a', '--json']);
    cli(['backlog', 'add', 'b', '--json']);
    expect(cli(['backlog', 'move', 'B2', '--top', '--json'], AGENT).json().status[0].code).toBe('agent_cannot_prioritize');
    expect(cli(['backlog', 'drop', 'B1', '--note', 'no', '--json'], AGENT).json().status[0].code).toBe('agent_cannot_prioritize');
    for (const command of ['sdlc backlog move B2 --top', 'sdlc backlog drop B1 --note x']) {
      const call = normalizeToolCall('Bash', { command }, root);
      expect(evaluateToolCall(call, { paths: projectPaths(root), config: defaultConfig() }), command).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    }
    expect(cli(['backlog', 'move', 'B2', '--top', '--json']).code).toBe(0);
    expect(ids(cli(['backlog', 'list', '--json']).json().items)).toEqual(['B2', 'B1']);
    expect(cli(['backlog', 'drop', 'B1', '--note', 'not needed', '--json']).json().item.status).toBe('dropped');
    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toEqual(expect.arrayContaining(['backlog.moved', 'backlog.dropped']));
  });

  it('negative: drop needs a note, move needs exactly one target, unknown items are refused', () => {
    const { cli } = project();
    cli(['backlog', 'add', 'a', '--json']);
    expect(cli(['backlog', 'drop', 'B1', '--json']).code).toBe(1);
    expect(cli(['backlog', 'move', 'B1', '--json']).code).toBe(1);
    expect(cli(['backlog', 'move', 'B1', '--top', '--before', 'B1', '--json']).code).toBe(1);
    expect(cli(['backlog', 'add', 'x', '--epic', 'E7', '--json']).json().status[0].code).toBe('unknown_epic');
  });
});
