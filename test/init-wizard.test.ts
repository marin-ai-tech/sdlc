import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { askInitChoices, initDefaults, shouldPrompt, starterRoles, type InitChoices, type Prompter } from '../src/commands/init-wizard.js';
import { initCommand } from '../src/commands/setup.js';
import { parseRolesFile } from '../src/core/roles.js';
import { BIN, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

const TTY = { stdinTTY: true, stdoutTTY: true };

/** A prompter with scripted answers; records every question in order. */
function scripted(answers: { tools?: string[]; mode?: string; statusline?: boolean; opsx?: boolean; language?: string; roles?: boolean; confirm?: boolean }) {
  const asked: string[] = [];
  const said: string[] = [];
  let confirms = 0;
  const prompter: Prompter = {
    async checkbox(message, choices) {
      asked.push(`checkbox:${message}`);
      return (answers.tools ?? choices.filter((c) => c.checked).map((c) => c.value)) as never;
    },
    async select(message, choices, initial) {
      asked.push(`select:${message}`);
      return (answers.mode ?? initial ?? choices[0].value) as never;
    },
    async confirm(message, initial) {
      asked.push(`confirm:${message}`);
      confirms++;
      if (/status ?line/i.test(message)) return answers.statusline ?? initial;
      if (/opsx/i.test(message)) return answers.opsx ?? initial;
      if (/roles/i.test(message)) return answers.roles ?? initial;
      return answers.confirm ?? initial;
    },
    async input(message, initial) {
      asked.push(`input:${message}`);
      return answers.language ?? initial;
    },
    say(text) {
      said.push(text);
    },
  };
  return { prompter, asked, said, confirms: () => confirms };
}

function repo() {
  const root = tempDir('sdlc-wizard-');
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Pat Lee']);
  git(root, ['config', 'user.email', 'pat@example.com']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  return root;
}

afterEach(() => vi.restoreAllMocks());

describe('shouldPrompt', () => {
  it('prompts only in a terminal, outside agent sessions, with no setup flags', () => {
    expect(shouldPrompt({}, TTY)).toBe(true);
    expect(shouldPrompt({ hooks: true }, TTY)).toBe(true); // commander's default for --no-hooks
  });

  it('negative: flags, --json, a non-terminal or an agent session never prompt', () => {
    for (const opts of [{ tools: 'claude' }, { json: true }, { mode: 'warn' }, { hooks: false }, { opsx: true },
      { statusline: true }, { language: 'ru' }, { delivery: 'skills' }, { cli: 'npx sdlc' }, { force: true }]) {
      expect(shouldPrompt(opts, TTY), JSON.stringify(opts)).toBe(false);
    }
    expect(shouldPrompt({}, { stdinTTY: false, stdoutTTY: true })).toBe(false);
    expect(shouldPrompt({}, { stdinTTY: true, stdoutTTY: false })).toBe(false);
    expect(shouldPrompt({}, { ...TTY, agent: 'claude-code' })).toBe(false);
  });
});

describe('askInitChoices', () => {
  const defaults = { tools: ['claude', 'opencode'] as const, mode: 'warn' as const, statusline: false, opsx: false, language: '' };

  it('welcomes, asks in order, shows a summary and returns the choices', async () => {
    const s = scripted({ tools: ['claude'], mode: 'block', statusline: true, opsx: true, language: 'ru', roles: true, confirm: true });
    const choices = await askInitChoices(s.prompter, { ...defaults, tools: [...defaults.tools] });
    expect(choices).toEqual<InitChoices>({ tools: ['claude'], mode: 'block', statusline: true, opsx: true, language: 'ru', roles: true, install: [], index: false });
    expect(s.said[0]).toMatch(/sdlc/i);
    expect(s.said.join('\n')).toMatch(/OpenSpec/);
    const kinds = s.asked.map((q) => q.split(':')[0]);
    expect(kinds).toEqual(['checkbox', 'select', 'confirm', 'confirm', 'input', 'confirm', 'confirm']);
    const summary = s.said.at(-1)!;
    for (const value of ['Claude Code', 'block', 'ru']) expect(summary).toContain(value);
  });

  it('asks about the status line only when Claude Code is chosen', async () => {
    const s = scripted({ tools: ['opencode'], confirm: true });
    const choices = await askInitChoices(s.prompter, { ...defaults, tools: [...defaults.tools] });
    expect(s.asked.some((q) => /status ?line/i.test(q))).toBe(false);
    expect(choices?.statusline).toBe(false);
  });

  it('negative: a declined summary returns nothing', async () => {
    const s = scripted({ confirm: false });
    expect(await askInitChoices(s.prompter, { ...defaults, tools: [...defaults.tools] })).toBeUndefined();
  });
});

describe('initDefaults and starterRoles', () => {
  it('a new project defaults to the detected tools (else both) and warn; an initialized one to its settings', () => {
    const root = repo();
    expect(initDefaults(root, [])).toMatchObject({ tools: ['claude', 'opencode'], mode: 'warn' });
    expect(initDefaults(root, ['opencode']).tools).toEqual(['opencode']);
    write(path.join(root, 'openspec/sdlc.yaml'), 'version: 1\ntools: [opencode]\nstatusline: true\nenforcement:\n  mode: block\n');
    expect(initDefaults(root, ['claude'])).toMatchObject({ tools: ['opencode'], mode: 'block', statusline: true });
  });

  it('starter roles.yaml: the git identity in every role, signing off, separation off with an explanation', () => {
    const text = starterRoles({ name: 'Pat Lee', email: 'pat@example.com' });
    const roles = parseRolesFile(text);
    expect(roles.signing).toBe('off');
    expect(roles.people).toHaveLength(1);
    expect(roles.people[0]).toMatchObject({ name: 'Pat Lee', emails: ['pat@example.com'] });
    for (const role of ['product-owner', 'engineer', 'tech-lead', 'code-owner', 'release-manager', 'maintainer']) {
      expect(roles.roles[role]).toEqual([roles.people[0].id]);
    }
    expect(roles.separation).toEqual({ authorCannotApprove: [], distinctApprovers: [], maxGatesPerPerson: 0 });
    expect(text).toMatch(/#.*(add people|more people)/i);
  });
});

describe('interactive sdlc init', () => {
  const quiet = () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  };

  it('writes what the person chose, like the matching flags, plus roles.yaml', async () => {
    const root = repo();
    const s = scripted({ tools: ['claude'], mode: 'block', statusline: true, opsx: false, language: '', roles: true, confirm: true });
    quiet();
    await initCommand(root, { hooks: true }, { prompter: s.prompter, io: TTY });
    const config = parse(read(path.join(root, 'openspec/sdlc.yaml')));
    expect(config.tools).toEqual(['claude']);
    expect(config.enforcement.mode).toBe('block');
    expect(config.statusline).toBe(true);
    expect(fs.existsSync(path.join(root, '.claude/skills'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.opencode'))).toBe(false);
    expect(parseRolesFile(read(path.join(root, 'openspec/roles.yaml'))).people[0].emails).toEqual(['pat@example.com']);
  }, 120000);

  it('negative: a declined summary writes nothing and says so', async () => {
    const root = repo();
    const out: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true));
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await initCommand(root, { hooks: true }, { prompter: scripted({ confirm: false }).prompter, io: TTY });
    expect(fs.existsSync(path.join(root, 'openspec'))).toBe(false);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
    expect(out.join('')).toMatch(/Nothing written/);
  }, 60000);

  it('negative: an existing roles.yaml is never overwritten', async () => {
    const root = repo();
    quiet();
    await initCommand(root, { tools: 'none' }, { io: { ...TTY, agent: 'claude-code' } });
    const mine = 'version: 1\nsigning: warn\npeople:\n  kim: { name: Kim, emails: [kim@example.com] }\nroles:\n  maintainer: [kim]\n';
    write(path.join(root, 'openspec/roles.yaml'), mine);
    await initCommand(root, { hooks: true }, { prompter: scripted({ tools: ['opencode'], roles: true, confirm: true }).prompter, io: TTY });
    expect(read(path.join(root, 'openspec/roles.yaml'))).toBe(mine);
  }, 120000);

  it('negative: in an agent session no question is asked and init runs as today', async () => {
    const root = repo();
    const s = scripted({ confirm: false });
    quiet();
    await initCommand(root, { hooks: true }, { prompter: s.prompter, io: { ...TTY, agent: 'claude-code' } });
    expect(s.asked).toEqual([]);
    expect(fs.existsSync(path.join(root, 'openspec/sdlc.yaml'))).toBe(true);
  }, 120000);

  it('negative: the CLI without a terminal never waits for input', () => {
    const root = repo();
    const r = spawnSync(process.execPath, [BIN, 'init'], { cwd: root, env: humanEnv(tempDir('sdlc-home-')), encoding: 'utf-8', timeout: 90000 });
    expect(r.error, 'init hung waiting for input').toBeUndefined();
    expect(r.status, r.stderr).toBe(0);
    expect(fs.existsSync(path.join(root, 'openspec/sdlc.yaml'))).toBe(true);
  }, 120000);
});
