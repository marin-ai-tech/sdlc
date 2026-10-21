import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  catalog, installedLocales, normalizeLocale, resolveLocale, setLocale, systemLocale, t,
} from '../src/core/i18n.js';
import { REPO_ROOT, humanEnv, runCli, tempDir } from './helpers.js';

afterEach(() => setLocale('en'));

describe('choosing the locale', () => {
  it('normalizes English and unset system spellings', () => {
    expect(normalizeLocale('EN')).toBe('en');
    for (const none of ['C', 'POSIX', '', undefined]) expect(normalizeLocale(none)).toBeUndefined();
  });

  it('falls back to English when a catalog is not installed', () => {
    expect(resolveLocale({ env: { SDLC_LOCALE: 'xx' }, system: 'en_US' })).toBe('en');
    expect(resolveLocale({ env: {}, system: 'xx_XX.UTF-8' })).toBe('en');
    expect(resolveLocale({ env: {} })).toBe('en');
    expect(resolveLocale({ env: {}, system: 'fr_FR.UTF-8' })).toBe('en');
  });

  it('reads the system locale in priority order', () => {
    expect(systemLocale({ LC_ALL: 'en_US', LANG: 'xx_XX' }, 'xx-XX')).toBe('en');
    expect(systemLocale({ LC_MESSAGES: 'en_US', LANG: 'xx_XX' }, 'xx-XX')).toBe('en');
    expect(systemLocale({ LANG: 'en_US' }, 'xx-XX')).toBe('en');
  });
});

describe('catalogs and t()', () => {
  it('substitutes English parameters and returns an unknown key', () => {
    const [key, text] = Object.entries(catalog('en')).find(([, value]) => /\{\w+\}/.test(value))!;
    const param = /\{(\w+)\}/.exec(text)![1];
    expect(t(key, { [param]: 'XYZ' }, 'en')).toContain('XYZ');
    expect(t('no.such.key.anywhere', {}, 'en')).toBe('no.such.key.anywhere');
  });

  it('covers every key the code uses and every installed catalog', () => {
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (file.endsWith('.ts')) {
          for (const match of fs.readFileSync(file, 'utf8').matchAll(/\bt\(\s*'([a-z][\w.-]*)'/g)) used.add(match[1]);
        }
      }
    };
    walk(path.join(REPO_ROOT, 'src'));
    expect(used.size).toBeGreaterThan(20);
    const english = catalog('en');
    expect([...used].filter((key) => !(key in english))).toEqual([]);
    for (const locale of installedLocales()) {
      expect(Object.keys(english).filter((key) => !(key in catalog(locale))), locale).toEqual([]);
    }
  });
});

describe('English CLI output', () => {
  it('prints English help by default', () => {
    const en = runCli(['help'], tempDir('sdlc-i18n-help-'), humanEnv(tempDir('sdlc-home-'))).stdout;
    expect(en).toMatch(/Workflows/);
    expect(en).not.toMatch(/\p{Script=Cyrillic}/u);
  });
});
