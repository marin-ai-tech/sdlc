import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

function project() {
  const root = tempDir('sdlc-backlog-flow-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  cli(['backlog', 'epic', 'add', 'Claims self-service', '--json']);
  cli(['backlog', 'add', 'Show claim stage', '--epic', 'E1', '--kind', 'bugfix', '--risk', 'low', '--outcome', 'policyholders see the stage of each open claim',
    '--accept', 'a claim in review shows "in review"', '--accept', 'another policyholder\'s claim is never listed', '--json']);
  cli(['backlog', 'add', 'Stage email', '--epic', 'E1', '--outcome', 'an email on stage change', '--accept', 'one email within 5 minutes', '--depends', 'B1', '--json']);
  cli(['backlog', 'add', 'Unrefined idea', '--json']);
  return { root, cli, change: (id: string) => path.join(root, 'openspec/changes', id) };
}
const events = (root: string) => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
const AGENT = { CLAUDECODE: '1' };

describe('backlog → change → archive', () => {
  it('start creates the change from the item: kind, risk, source, a draft intent, the item goes in progress', () => {
    const { root, cli, change } = project();
    const r = cli(['backlog', 'start', 'B1', '--change', 'show-claim-stage', '--json'], AGENT);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.json()).toMatchObject({ item: { id: 'B1', status: 'in-progress', change: 'show-claim-stage' }, change: { id: 'show-claim-stage', kind: 'bugfix', risk: 'low' } });
    const state = parse(read(path.join(change('show-claim-stage'), '.sdlc.yaml')));
    expect(state.source).toEqual({ type: 'backlog', ref: 'B1' });
    expect(state.track).toBe('full');
    expect(state.track_suggestion?.track).toBe('lite');
    const intent = read(path.join(change('show-claim-stage'), 'intent.md'));
    expect(intent).toMatch(/Status: draft/);
    expect(intent).toContain('policyholders see the stage of each open claim');
    expect(intent).toContain('another policyholder\'s claim is never listed');
    expect(intent).toMatch(/B1/);
    expect(cli(['status', '--change', 'show-claim-stage', '--json']).json().change.gates.find((g: { id: string }) => g.id === 'intent').status).not.toBe('approved');
    expect(events(root)).toContain('backlog.started');
  });

  it('without --change the change id is derived from the title', () => {
    const { cli } = project();
    expect(cli(['backlog', 'start', 'B1', '--json']).json().change.id).toBe('show-claim-stage');
  });

  it('negative: an item that is not ready (missing outcome/acceptance or open dependencies) cannot start', () => {
    const { cli, change } = project();
    const blocked = cli(['backlog', 'start', 'B2', '--json']);
    expect(blocked.code).toBe(1);
    expect(blocked.json().status[0].code).toBe('backlog_item_not_ready');
    expect(blocked.json().status[0].message).toMatch(/B1/);
    const unrefined = cli(['backlog', 'start', 'B3', '--json']);
    expect(unrefined.json().status[0].code).toBe('backlog_item_not_ready');
    expect(unrefined.json().status[0].message).toMatch(/outcome/i);
    expect(fs.existsSync(change('stage-email'))).toBe(false);
  });

  it('negative: an item already in progress cannot start twice', () => {
    const { cli } = project();
    cli(['backlog', 'start', 'B1', '--json']);
    expect(cli(['backlog', 'start', 'B1', '--change', 'other', '--json']).json().status[0].code).toBe('invalid_transition');
  });

  it('archiving the change closes the item (and a deferred item it came from); the dependant becomes ready', () => {
    const { root, cli } = project();
    cli(['defer', 'add', 'Rate-limit export', '--why', 'pilot', '--json']);
    cli(['backlog', 'add', 'Rate-limit export', '--outcome', 'export is rate limited', '--accept', '429 above 100 rps', '--source-type', 'deferred', '--source-ref', 'D1', '--json']);
    cli(['backlog', 'start', 'B1', '--json']);
    cli(['backlog', 'start', 'B4', '--json']);
    for (const id of ['show-claim-stage', 'rate-limit-export']) {
      const r = cli(['archive', id, '--yes', '--force', '--note', 'test shortcut', '--json']);
      expect(r.code, r.stdout + r.stderr).toBe(0);
    }
    const list = cli(['backlog', 'list', '--json']).json();
    expect(list.items.find((i: { id: string }) => i.id === 'B1')).toMatchObject({ status: 'done' });
    expect(list.items.find((i: { id: string }) => i.id === 'B4')).toMatchObject({ status: 'done' });
    expect(list.items.find((i: { id: string }) => i.id === 'B2')).toMatchObject({ status: 'open', ready: true });
    expect(cli(['defer', 'list', '--json']).json().items[0]).toMatchObject({ id: 'D1', status: 'done' });
    expect(events(root)).toContain('backlog.done');
  });
});

describe('sdlc next and the report with a backlog', () => {
  it('with no active change, next proposes the first ready item instead of failing', () => {
    const { cli } = project();
    const r = cli(['next', '--json']);
    expect(r.code, r.stdout).toBe(0);
    expect(r.json()).toMatchObject({ change: null, next: { actor: 'agent', action: 'start-backlog-item', item: 'B1', cli: 'sdlc backlog start B1' } });
    expect(cli(['next']).stdout).toMatch(/B1[\s\S]*sdlc backlog start B1/);
  });

  it('negative: with no change and nothing ready, next still reports that there is no active change', () => {
    const root = tempDir('sdlc-next-empty-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    runCli(['backlog', 'add', 'Unrefined', '--json'], root, env);
    const r = runCli(['next', '--json'], root, env);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('no_active_changes');
  });

  it('report and dashboard show epic progress and what is next', () => {
    const { cli } = project();
    cli(['backlog', 'start', 'B1', '--json']);
    const model = cli(['report', '--json']).json();
    expect(model.backlog.epics[0]).toMatchObject({ id: 'E1', title: 'Claims self-service', total: 2, inProgress: 1, open: 1 });
    expect(model.backlog.counts).toMatchObject({ open: 2, 'in-progress': 1, done: 0, dropped: 0 });
    expect(model.backlog.next.map((i: { id: string }) => i.id)).toEqual([]);
    expect(model.backlog.blocked.map((i: { id: string }) => i.id)).toEqual(['B2']);
    expect(cli(['report', '--format', 'md']).stdout).toMatch(/## Backlog[\s\S]*Claims self-service/);
    const html = cli(['dashboard']).stdout;
    const start = html.indexOf('<h2 id="backlog"');
    expect(start).toBeGreaterThan(-1);
    expect(html.slice(start, html.indexOf('</section>', start))).toContain('Claims self-service');
  });
});
