import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

const AGENT = { CLAUDECODE: '1' };

function project() {
  const root = tempDir('sdlc-epic-edit-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  cli(['backlog', 'epic', 'add', '0.7.0 Control and traceability', '--goal', 'people see who acts', '--json']);
  cli(['backlog', 'epic', 'add', '0.8.0 MCP', '--json']);
  cli(['backlog', 'add', 'Named approvers', '--epic', 'E1', '--outcome', 'o', '--accept', 'a', '--json']);
  cli(['backlog', 'add', 'Rework', '--epic', 'E1', '--json']);
  cli(['backlog', 'add', 'Registry', '--epic', 'E2', '--json']);
  const list = () => cli(['backlog', 'list', '--json']).json();
  const file = () => read(path.join(root, 'openspec/backlog.md'));
  return { root, cli, list, file };
}

const events = (root: string) => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n')
  .map((entry) => JSON.parse(entry));

describe('sdlc backlog epic edit', () => {
  it('changes the title and the goal of an epic, logs it, and answers with the epic', () => {
    const { root, cli, list, file } = project();
    const r = cli(['backlog', 'epic', 'edit', 'E1', '--title', '0.8.0 Control and traceability',
      '--goal', 'every decision is traceable', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(r.json().epic).toMatchObject({ id: 'E1', title: '0.8.0 Control and traceability',
      goal: 'every decision is traceable' });
    expect(list().epics[0]).toMatchObject({ id: 'E1', title: '0.8.0 Control and traceability' });
    expect(file()).toMatch(/^## E1 0\.8\.0 Control and traceability$/m);
    expect(file()).toMatch(/^Goal: every decision is traceable$/m);
    const edited = events(root).filter((entry) => entry.event === 'backlog.epic.edited');
    expect(edited).toHaveLength(1);
    expect(edited[0].detail).toMatch(/^E1\b/);
  });

  it('--clear-goal removes the goal; --title alone keeps it', () => {
    const { cli, list } = project();
    expect(cli(['backlog', 'epic', 'edit', 'E1', '--title', 'Control', '--json']).code).toBe(0);
    expect(list().epics[0]).toMatchObject({ title: 'Control', goal: 'people see who acts' });
    expect(cli(['backlog', 'epic', 'edit', 'E1', '--clear-goal', '--json']).code).toBe(0);
    expect(list().epics[0].goal).toBeUndefined();
  });

  it('negative: items, their order, their epics and the order of epics do not change', () => {
    const { cli, list } = project();
    const before = list();
    expect(cli(['backlog', 'epic', 'edit', 'E2', '--title', '0.9.0 MCP', '--json'], AGENT).code).toBe(0);
    const after = list();
    expect(after.items.map((i: { id: string; epic?: string }) => `${i.id}:${i.epic}`))
      .toEqual(before.items.map((i: { id: string; epic?: string }) => `${i.id}:${i.epic}`));
    expect(after.epics.map((e: { id: string }) => e.id)).toEqual(['E1', 'E2']);
  });

  it('negative: invalid edits are refused and the file is left as it was', () => {
    const { cli, file } = project();
    const original = file();
    const refused: Array<[string[], string]> = [
      [['E9', '--title', 'x'], 'unknown_epic'],
      [['E1'], 'invalid_option'],
      [['E1', '--title', 'two\nlines'], 'invalid_option'],
      [['E1', '--title', ' '], 'invalid_option'],
      [['E1', '--goal', 'g', '--clear-goal'], 'invalid_option'],
    ];
    for (const [args, code] of refused) {
      const r = cli(['backlog', 'epic', 'edit', ...args, '--json']);
      expect(r.code, args.join(' ')).toBe(1);
      expect(r.json().status[0].code, args.join(' ')).toBe(code);
    }
    expect(file()).toBe(original);
  });

  it('any actor may run it, and help lists it', () => {
    const { cli } = project();
    expect(cli(['backlog', 'epic', 'edit', 'E1', '--goal', 'refined by the agent', '--json'], AGENT).code).toBe(0);
    const entry = cli(['help', '--json']).json().commands.find((c: { name: string }) => c.name === 'backlog epic edit');
    expect(entry).toMatchObject({ actor: 'any' });
  });
});
