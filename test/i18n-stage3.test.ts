import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setLocale } from '../src/core/i18n.js';
import { humanEnv, REPO_ROOT, runCli, tempDir } from './helpers.js';

const CYRILLIC = /[а-яё]{3}/i;

/**
 * Latin words a Russian string may contain: product and technology names, gate, stage and role ids, flag values,
 * command names and config keys. Everything else is an untranslated word.
 */
const ALLOWED = new Set([
  'adr', 'ai-native', 'ai-ready', 'anthropic', 'bmad', 'cli', 'claude', 'code', 'opencode', 'openspec', 'json', 'yaml',
  'html', 'id', 'osi', 'path', 'sdlc', 'yyyy-mm-dd', 'codegraph', 'git', 'npm', 'ssh', 'stdin', 'playbook', 'community',
  'license', 'open', 'source', 'kebab-case', 'worktree', 'config',
  'intent', 'spec', 'specs', 'plan', 'build', 'verify', 'review', 'release', 'archive', 'triage', 'explore', 'help', 'next',
  'status', 'design', 'proposal', 'tasks', 'verification', 'apply', 'validate', 'delta', 'verified', 'diff', 'context',
  'check', 'engineer', 'maintainer', 'product-owner', 'code-owner', 'release-manager', 'tech-lead',
  'block', 'warn', 'off', 'full', 'lite', 'both', 'skills', 'commands', 'true', 'false', 'done', 'dropped', 'init',
  'install', 'new', 'change', 'lock', 'unlock', 'pre-tool', 'session-start', 'stop', 'statusline', 'opsx', 'commit',
  'marketplace', 'enforcement', 'kind', 'risk', 'email', 'add-claims-status-panel', 'ok',
]);

function untranslated(): string[] {
  const ru = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'assets/locales/ru.json'), 'utf-8')) as Record<string, string>;
  const strip = (s: string) => s.replace(/`[^`]*`/g, ' ').replace(/"[^"]*"|«[^»]*»/g, ' ').replace(/\{[^}]*\}/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\S*[\\/._@]\S*/g, ' ').replace(/(^|\s)--?[\w-]+/g, ' ')
    .replace(/\bsdlc(\s+[a-z][\w-]*)+/g, ' ');
  const found: string[] = [];
  for (const [key, value] of Object.entries(ru)) {
    for (const word of strip(value).match(/[A-Za-z][A-Za-z+-]*/g) ?? []) {
      if (!ALLOWED.has(word.toLowerCase().replace(/-+$/, ''))) found.push(`${key}: ${word}`);
    }
  }
  return found;
}

afterEach(() => {
  setLocale('en');
  vi.doUnmock('@inquirer/prompts');
});

describe('stage 3: what was left', () => {
  it('Russian strings contain no English words apart from names, ids, commands and config keys', () => {
    expect(untranslated()).toEqual([]);
  });

  it('commander errors and per-command help follow the locale; English is unchanged', () => {
    const cwd = tempDir('sdlc-i18n3-');
    const env = humanEnv(tempDir('sdlc-home-'));
    const ru = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, cwd, { ...env, ...extra });
    const missing = ru(['approve', '--locale', 'ru']);
    expect(missing.stderr).toMatch(CYRILLIC);
    expect(missing.stderr).not.toMatch(/missing required argument/);
    expect(ru(['nonsense', '--locale', 'ru']).stderr).toMatch(CYRILLIC);
    const help = ru(['approve', '--help', '--locale', 'ru']).stdout;
    expect(help).toMatch(CYRILLIC);
    expect(help).not.toMatch(/^Usage:/m);
    // option descriptions too: every option line (two-space indent, flag first) carries Russian text
    const options = help.split('\n').filter((l) => /^\s{2}-/.test(l) && !/^\s{2}-h, --help|^\s{2}-V/.test(l));
    expect(options.length).toBeGreaterThan(2);
    for (const option of options) expect(option, option).toMatch(/[а-яё]/i);
    for (const command of ['backlog add', 'init', 'verify', 'report']) {
      const text = ru([...command.split(' '), '--help', '--locale', 'ru']).stdout;
      const lines = text.split('\n').filter((l) => /^\s{2}--/.test(l) && !/--locale/.test(l));
      expect(lines.filter((l) => !/[а-яё]/i.test(l)), command).toEqual([]);
    }
    expect(ru(['approve', '--help'], { SDLC_LOCALE: 'ru' }).stdout).toMatch(CYRILLIC);
    expect(ru(['approve']).stderr).toMatch(/error: missing required argument 'gate'/);
    expect(ru(['approve', '--help']).stdout).toMatch(/^Usage: sdlc approve/m);
  });

  it('every option and command description of every command is Russian under the ru locale', async () => {
    const { buildProgram } = await import('../src/cli/index.js');
    setLocale('ru');
    const english: string[] = [];
    const walk = (command: Command, at: string) => {
      for (const option of command.options) {
        if (!/[а-яё]/i.test(option.description)) english.push(`${at} ${option.flags}: ${option.description}`);
      }
      for (const child of command.commands) {
        if (!/[а-яё]/i.test(child.description())) english.push(`${at} ${child.name()}: ${child.description()}`);
        walk(child, `${at} ${child.name()}`);
      }
    };
    walk(buildProgram(), 'sdlc');
    expect(english).toEqual([]);
    const top = runCli(['--help', '--locale', 'ru'], tempDir('sdlc-i18n3-'), humanEnv(tempDir('sdlc-home-'))).stdout;
    expect(top).not.toMatch(/display help for command/);
  });

  it('negative: under the English locale option descriptions stay exactly as written', async () => {
    const { buildProgram } = await import('../src/cli/index.js');
    setLocale('en');
    const verify = buildProgram().commands.find((c) => c.name() === 'verify')!;
    expect(verify.options.find((o) => o.long === '--json')?.description).toBe('output JSON');
  });

  it('the init wizard passes translated hints to the prompt library', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const record = (kind: string) => async (options: Record<string, unknown>) => {
      calls.push({ kind, ...options });
      return kind === 'checkbox' ? [] : kind === 'confirm' ? true : '';
    };
    vi.doMock('@inquirer/prompts', () => ({
      checkbox: record('checkbox'), select: record('select'), confirm: record('confirm'), input: record('input'),
    }));
    const { terminalPrompter } = await import('../src/commands/init-wizard.js');
    setLocale('ru');
    const prompter = terminalPrompter();
    await prompter.checkbox('Инструменты?', [{ value: 'opencode', name: 'OpenCode', checked: true }]);
    await prompter.select('Режим?', [{ value: 'warn', name: 'warn' }], 'warn');
    for (const kind of ['checkbox', 'select']) {
      const options = calls.find((c) => c.kind === kind)!;
      const text = JSON.stringify({ instructions: options.instructions, theme: options.theme });
      expect(text, kind).toMatch(CYRILLIC);
    }
  });

  it('contributors can find how to add a language', () => {
    const guide = fs.readFileSync(path.join(REPO_ROOT, 'CONTRIBUTING.md'), 'utf-8');
    expect(guide).toMatch(/assets\/locales/);
    expect(guide).toMatch(/LOCALES/);
    expect(guide).toMatch(/i18n/);
  });
});
