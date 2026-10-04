import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { askInitChoices, type Prompter } from '../src/commands/init-wizard.js';
import { catalog, LOCALES, normalizeLocale, resolveLocale, setLocale, systemLocale, t } from '../src/core/i18n.js';
import { git, humanEnv, initGitRepo, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

const CYRILLIC = /[а-яё]{3}/i;

function project(extra: NodeJS.ProcessEnv = {}) {
  const root = tempDir('sdlc-i18n-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'), extra);
  const cli = (args: string[], more: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...more });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

/** The environment of a person whose system speaks `lang` and who set no SDLC_LOCALE. */
const system = (lang: string): NodeJS.ProcessEnv => ({ SDLC_LOCALE: undefined, LC_ALL: undefined, LC_MESSAGES: undefined, LANG: lang });

afterEach(() => setLocale('en'));

describe('choosing the locale', () => {
  it('normalizes system and user spellings', () => {
    expect(normalizeLocale('ru_RU.UTF-8')).toBe('ru');
    expect(normalizeLocale('ru-RU')).toBe('ru');
    expect(normalizeLocale('EN')).toBe('en');
    for (const none of ['C', 'POSIX', '', undefined]) expect(normalizeLocale(none)).toBeUndefined();
  });

  it('the flag beats SDLC_LOCALE, which beats sdlc.yaml, which beats the system; nothing set means English', () => {
    expect(resolveLocale({ flag: 'en', env: { SDLC_LOCALE: 'ru' }, config: 'ru', system: 'ru_RU' })).toBe('en');
    expect(resolveLocale({ env: { SDLC_LOCALE: 'ru' }, config: 'en', system: 'en_US' })).toBe('ru');
    expect(resolveLocale({ env: {}, config: 'ru', system: 'en_US' })).toBe('ru');
    expect(resolveLocale({ env: {}, system: 'ru_RU.UTF-8' })).toBe('ru');
    expect(resolveLocale({ env: {} })).toBe('en');
  });

  it('negative: a locale without a translation means English and does not fall through', () => {
    expect(resolveLocale({ env: { SDLC_LOCALE: 'de' }, system: 'ru_RU' })).toBe('en');
    expect(resolveLocale({ env: {}, system: 'fr_FR.UTF-8' })).toBe('en');
  });

  it('the system locale comes from LC_ALL, LC_MESSAGES, LANG, then the OS', () => {
    expect(systemLocale({ LC_ALL: 'ru_RU.UTF-8', LANG: 'en_US' }, 'en-US')).toBe('ru');
    expect(systemLocale({ LC_MESSAGES: 'ru_RU', LANG: 'en_US' }, 'en-US')).toBe('ru');
    expect(systemLocale({ LANG: 'ru_RU.UTF-8' }, 'en-US')).toBe('ru');
    expect(systemLocale({}, 'ru-RU')).toBe('ru');
    expect(systemLocale({ LANG: 'C' }, 'ru-RU')).toBe('ru');
  });
});

describe('catalogs and t()', () => {
  it('t substitutes params, falls back to English per key, and returns the key when no catalog has it', () => {
    const [key, text] = Object.entries(catalog('en')).find(([, v]) => /\{\w+\}/.test(v))!;
    const param = /\{(\w+)\}/.exec(text)![1];
    expect(t(key, { [param]: 'XYZ' }, 'en')).toContain('XYZ');
    expect(t('no.such.key.anywhere', {}, 'ru')).toBe('no.such.key.anywhere');
  });

  it('every key the code uses has English text, and every shipped locale has every English key', () => {
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (file.endsWith('.ts')) for (const m of fs.readFileSync(file, 'utf-8').matchAll(/\bt\(\s*'([a-z][\w.-]*)'/g)) used.add(m[1]);
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(used.size).toBeGreaterThan(20);
    const en = catalog('en');
    expect([...used].filter((key) => !(key in en))).toEqual([]);
    for (const locale of LOCALES) expect(Object.keys(en).filter((key) => !(key in catalog(locale))), locale).toEqual([]);
  });
});

describe('the CLI speaks the locale; JSON stays English', () => {
  it('help: Russian with --locale ru, English JSON in any locale', () => {
    const { cli } = project();
    const en = cli(['help']).stdout;
    const ru = cli(['help', '--locale', 'ru']).stdout;
    expect(en).not.toMatch(CYRILLIC);
    expect(ru).toMatch(CYRILLIC);
    const json = (args: string[]) => JSON.stringify(cli([...args, '--json']).json());
    expect(json(['help', '--locale', 'ru'])).toBe(json(['help']));
  });

  it('the system locale is used when nothing else is set; SDLC_LOCALE and sdlc.yaml override it', () => {
    const { root, cli } = project();
    expect(cli(['help'], system('ru_RU.UTF-8')).stdout).toMatch(CYRILLIC);
    expect(cli(['help'], system('de_DE.UTF-8')).stdout).not.toMatch(CYRILLIC);
    expect(cli(['help'], { ...system('ru_RU.UTF-8'), SDLC_LOCALE: 'en' }).stdout).not.toMatch(CYRILLIC);
    const config = path.join(root, 'openspec/sdlc.yaml');
    write(config, `${fs.readFileSync(config, 'utf-8')}locale: ru\n`);
    expect(cli(['help'], system('en_US.UTF-8')).stdout).toMatch(CYRILLIC);
    expect(cli(['help', '--locale', 'en'], system('en_US.UTF-8')).stdout).not.toMatch(CYRILLIC);
  });

  it('status and Next: stage titles, gate states and the hint in Russian; the JSON view unchanged', () => {
    const { cli } = project();
    const created = cli(['new', 'add-x', '--locale', 'ru']);
    expect(created.stdout).toMatch(/Далее:/);
    const status = cli(['status', '--change', 'add-x', '--locale', 'ru']).stdout;
    const stageLine = status.split('\n').find((l) => /^\s+stage|^\s+стадия/i.test(l)) ?? '';
    expect(stageLine).toMatch(CYRILLIC);
    expect(JSON.stringify(cli(['status', '--change', 'add-x', '--json', '--locale', 'ru']).json()))
      .toBe(JSON.stringify(cli(['status', '--change', 'add-x', '--json']).json()));
  });
});

describe('the init wizard speaks the locale', () => {
  it('questions and the summary are Russian when the locale is ru', async () => {
    const asked: string[] = [];
    const said: string[] = [];
    const prompter: Prompter = {
      async checkbox(message, choices) { asked.push(message); return choices.filter((c) => c.checked).map((c) => c.value) as never; },
      async select(message, _c, initial) { asked.push(message); return initial as never; },
      async confirm(message, initial) { asked.push(message); return initial; },
      async input(message, initial) { asked.push(message); return initial; },
      say(text) { said.push(text); },
    };
    setLocale('ru');
    await askInitChoices(prompter, { tools: ['claude'], mode: 'warn', statusline: false, opsx: false, language: '' });
    expect(asked.length).toBeGreaterThan(4);
    expect(asked.every((q) => CYRILLIC.test(q))).toBe(true);
    expect(said.at(-1)).toMatch(CYRILLIC);
  });
});
