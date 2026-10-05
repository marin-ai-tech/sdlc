import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

const AGENT = { CLAUDECODE: '1' };

function project() {
  const root = tempDir('sdlc-backlog-edit-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  cli(['backlog', 'epic', 'add', 'Claims self-service', '--json']);
  cli(['backlog', 'add', 'Show claim stage', '--epic', 'E1', '--outcome', 'policyholders see the stage',
    '--accept', 'a claim in review shows "in review"', '--json']);
  cli(['backlog', 'add', 'Stage email', '--epic', 'E1', '--outcome', 'an email on stage change',
    '--accept', 'one email within 5 minutes', '--depends', 'B1', '--json']);
  cli(['backlog', 'add', 'Unrefined idea', '--json']);
  const file = () => read(path.join(root, 'openspec/backlog.md'));
  const item = (id: string) => cli(['backlog', 'list', '--json']).json().items
    .find((entry: { id: string }) => entry.id === id);
  const order = () => cli(['backlog', 'list', '--json']).json().items.map((entry: { id: string }) => entry.id);
  return { root, cli, file, item, order };
}

const events = (root: string) => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n')
  .map((entry) => JSON.parse(entry));

describe('sdlc backlog edit', () => {
  it('an agent brings an item to ready: outcome and criteria are written, the item becomes ready', () => {
    const { root, cli, item } = project();
    expect(item('B3').ready).toBe(false);
    const r = cli(['backlog', 'edit', 'B3', '--outcome', 'agents can refine items',
      '--accept', 'the item is ready after the edit', '--accept', 'nothing else changes', '--json'], AGENT);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.json().item).toMatchObject({
      id: 'B3',
      outcome: 'agents can refine items',
      acceptance: ['the item is ready after the edit', 'nothing else changes'],
      ready: true,
    });
    expect(cli(['backlog', 'list', '--ready', '--json']).json().items.map((i: { id: string }) => i.id)).toContain('B3');
    const edited = events(root).filter((entry) => entry.event === 'backlog.edited');
    expect(edited).toHaveLength(1);
    expect(edited[0].detail).toMatch(/^B3\b/);
  });

  it('--title, --kind, --risk, --add-accept, --depends and --clear-depends change only what they name', () => {
    const { cli, item } = project();
    expect(cli(['backlog', 'edit', 'B1', '--title', 'Show claim stage in the portal', '--kind', 'bugfix',
      '--risk', 'low', '--add-accept', 'another policyholder\'s claim is never listed', '--json']).code).toBe(0);
    expect(item('B1')).toMatchObject({
      title: 'Show claim stage in the portal',
      kind: 'bugfix',
      risk: 'low',
      outcome: 'policyholders see the stage',
      acceptance: ['a claim in review shows "in review"', 'another policyholder\'s claim is never listed'],
    });
    expect(cli(['backlog', 'edit', 'B3', '--depends', 'B1', '--depends', 'B2', '--json']).code).toBe(0);
    expect(item('B3').dependsOn).toEqual(['B1', 'B2']);
    expect(cli(['backlog', 'edit', 'B3', '--clear-depends', '--json']).code).toBe(0);
    expect(item('B3').dependsOn).toEqual([]);
    expect(item('B2')).toMatchObject({ title: 'Stage email', dependsOn: ['B1'], acceptance: ['one email within 5 minutes'] });
  });

  it('negative: edit never reorders, moves to another epic or changes the status', () => {
    const { cli, item, order } = project();
    const before = order();
    expect(cli(['backlog', 'edit', 'B2', '--title', 'Stage change email', '--json'], AGENT).code).toBe(0);
    expect(order()).toEqual(before);
    expect(item('B2')).toMatchObject({ epic: 'E1', status: 'open' });
    expect(item('B3').epic).toBeUndefined();
    for (const flag of ['--epic', '--status', '--top', '--before']) {
      expect(cli(['backlog', 'edit', 'B2', flag, 'E1', '--json'], AGENT).code, flag).not.toBe(0);
    }
  });

  it('negative: invalid edits are refused and the file is left as it was', () => {
    const { cli, file } = project();
    const original = file();
    const refused: Array<[string[], string]> = [
      [['B9', '--title', 'x'], 'unknown_backlog_item'],
      [['B3'], 'invalid_option'],
      [['B3', '--depends', 'B7'], 'unknown_backlog_item'],
      [['B1', '--depends', 'B2'], 'dependency_cycle'],
      [['B1', '--depends', 'B1'], 'dependency_cycle'],
      [['B1', '--title', 'two\nlines'], 'invalid_option'],
      [['B1', '--kind', 'epic'], 'invalid_option'],
      [['B1', '--risk', 'extreme'], 'invalid_option'],
    ];
    for (const [args, code] of refused) {
      const r = cli(['backlog', 'edit', ...args, '--json']);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.json().status[0].code, args.join(' ')).toBe(code);
    }
    expect(file()).toBe(original);
  });

  it('negative: closed items cannot be edited', () => {
    const { cli, file } = project();
    expect(cli(['backlog', 'done', 'B1', '--note', 'shipped', '--json']).code).toBe(0);
    expect(cli(['backlog', 'drop', 'B3', '--note', 'not needed', '--json']).code).toBe(0);
    const original = file();
    for (const id of ['B1', 'B3']) {
      const r = cli(['backlog', 'edit', id, '--title', 'reopened by an edit', '--json'], AGENT);
      expect(r.code, id).toBe(1);
      expect(r.json().status[0].code, id).toBe('backlog_item_closed');
    }
    expect(file()).toBe(original);
  });

  it('negative: a dependency on a dropped item is refused, so an edit cannot drop an item in effect', () => {
    const { cli, file } = project();
    expect(cli(['backlog', 'drop', 'B3', '--note', 'not needed', '--json']).code).toBe(0);
    const original = file();
    const edit = cli(['backlog', 'edit', 'B1', '--depends', 'B3', '--json'], AGENT);
    expect(edit.code).toBe(1);
    expect(edit.json().status[0].code).toBe('dependency_dropped');
    const add = cli(['backlog', 'add', 'Later', '--outcome', 'o', '--accept', 'a', '--depends', 'B3', '--json'], AGENT);
    expect(add.code).toBe(1);
    expect(add.json().status[0].code).toBe('dependency_dropped');
    expect(file()).toBe(original);
  });

  it('is a command any actor may run, listed in help', () => {
    const { cli } = project();
    const entry = cli(['help', '--json']).json().commands.find((c: { name: string }) => c.name === 'backlog edit');
    expect(entry).toMatchObject({ actor: 'any' });
  });
});
