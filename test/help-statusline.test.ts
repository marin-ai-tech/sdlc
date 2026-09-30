import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/cli/index.js';
import { WORKFLOW_IDS } from '../src/integrations/assets.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

function project(init: string[] = ['init', '--tools', 'claude', '--json']) {
  const root = tempDir('sdlc-help-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], input?: string) => runCli(args, root, env, input);
  expect(cli(init).code).toBe(0);
  return { root, cli };
}

const HUMAN_ONLY = ['approve', 'reject', 'waive', 'tests unlock', 'track set', 'backlog move', 'backlog drop', 'license set'];

describe('sdlc help', () => {
  it('--json lists every workflow with its invocation per tool and every CLI command with who runs it', () => {
    const { cli } = project();
    const r = cli(['help', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const catalog = r.json();
    expect(catalog.workflows.map((w: { id: string }) => w.id)).toEqual([...WORKFLOW_IDS]);
    expect(catalog.workflows.find((w: { id: string }) => w.id === 'intent')).toMatchObject({
      invocation: { claude: '/sdlc:intent', opencode: '/sdlc-intent' },
      description: expect.stringMatching(/intent/i),
    });
    const names = catalog.commands.map((c: { name: string }) => c.name);
    for (const command of buildProgram().commands.map((c) => c.name())) {
      expect(names.some((n: string) => n === command || n.startsWith(`${command} `)), command).toBe(true);
    }
    for (const name of HUMAN_ONLY) {
      expect(catalog.commands.find((c: { name: string }) => c.name === name), name).toMatchObject({ actor: 'human' });
    }
    expect(catalog.commands.find((c: { name: string }) => c.name === 'status')).toMatchObject({ actor: 'any' });
    expect(catalog.commands.every((c: { description: string }) => c.description.length > 5)).toBe(true);
  });

  it('text help groups by who acts; a topic shows usage and an example', () => {
    const { cli } = project();
    const all = cli(['help']).stdout;
    expect(all).toMatch(/Workflows/i);
    expect(all).toMatch(/people|person/i);
    const topic = cli(['help', 'approve']).stdout;
    expect(topic).toMatch(/sdlc approve <gate>/);
    expect(topic).toMatch(/--change/);
    expect(topic).toMatch(/Example/i);
    expect(topic).toMatch(/person|human/i);
  });

  it('text help gives every command its description and lists no bare command groups', () => {
    const { cli } = project();
    const lines = cli(['help']).stdout.split('\n');
    const start = lines.find((l) => /sdlc backlog start/.test(l))!;
    expect(start).toMatch(/sdlc backlog start <B-id>\s{2,}\S.{5,}/);
    for (const group of ['sdlc backlog', 'sdlc backlog epic', 'sdlc defer', 'sdlc layout']) {
      expect(lines.some((l) => l.trim() === group), group).toBe(false);
    }
    expect(lines.find((l) => /^\s+\/sdlc:intent|SDLC: Intent/.test(l))).toMatch(/intent/i);
  });

  it('every command and option has a real description; usages are accurate', () => {
    const { cli } = project();
    const catalog = cli(['help', '--json']).json();
    for (const c of catalog.commands as Array<{ name: string; description: string; usage: string }>) {
      expect(c.description, c.name).not.toMatch(/^Manage /);
    }
    const license = catalog.commands.find((c: { name: string }) => c.name === 'license set');
    expect(license.usage).not.toMatch(/--change/);
    expect(license.usage).toMatch(/community|commercial|<type>/);
    for (const [cmd, flag] of [['backlog add', '--outcome'], ['backlog move', '--before'], ['defer add', '--why'], ['explore list', '--json']]) {
      const text = cli([...cmd.split(' '), '--help']).stdout;
      const optionLine = text.split('\n').find((l) => l.trim().startsWith(flag))!;
      expect(optionLine, `${cmd} ${flag}`).toMatch(new RegExp(`${flag}\\S*(\\s+<[^>]+>)?\\s{2,}\\S{3,}`));
    }
  });

  it('negative: an unknown topic is an error with the list of topics', () => {
    const { cli } = project();
    const r = cli(['help', 'nope', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('unknown_topic');
  });
});

describe('sdlc statusline (Claude Code status line)', () => {
  it('prints one compact line for the active change', () => {
    const { root, cli } = project();
    cli(['new', 'add-export']);
    const r = cli(['statusline'], JSON.stringify({ cwd: root, workspace: { current_dir: root } }));
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/add-export/);
    expect(lines[0]).toMatch(/plan|intent/i);
    expect(lines[0]).toMatch(/agent|person/i);
  });

  it('negative: outside a project or with bad input it prints nothing and never fails', () => {
    const outside = tempDir('sdlc-noproject-');
    const env = humanEnv(tempDir('sdlc-home-'));
    for (const input of [JSON.stringify({ cwd: outside }), 'not json', '']) {
      const r = runCli(['statusline'], outside, env, input);
      expect(r.code, input).toBe(0);
      expect(r.stdout.trim(), input).toBe('');
    }
  });

  it('init --statusline installs it in .claude/settings.json; default init does not; a user status line is kept', () => {
    const plain = project();
    const settings = (root: string) => JSON.parse(read(path.join(root, '.claude/settings.json')));
    expect(settings(plain.root).statusLine).toBeUndefined();

    const withLine = project(['init', '--tools', 'claude', '--statusline', '--json']);
    expect(settings(withLine.root).statusLine).toEqual({ type: 'command', command: 'sdlc statusline' });
    expect(withLine.cli(['uninstall', '--json']).code).toBe(0);
    expect(fs.existsSync(path.join(withLine.root, '.claude/settings.json')) ? settings(withLine.root).statusLine : undefined).toBeUndefined();

    const custom = project(['init', '--tools', 'none', '--json']);
    write(path.join(custom.root, '.claude/settings.json'), JSON.stringify({ statusLine: { type: 'command', command: 'my-line' } }));
    const r = custom.cli(['init', '--tools', 'claude', '--statusline', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(settings(custom.root).statusLine).toEqual({ type: 'command', command: 'my-line' });
    expect(JSON.stringify(r.json())).toMatch(/statusLine|status line/i);
  });
});
