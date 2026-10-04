/**
 * Localized text for people: help, Next hints, stage and gate labels, the init wizard, hook reasons, the report
 * and the dashboard. JSON output, the project log and change records never depend on the locale: they are read
 * by agents, CI and later versions.
 *
 * Contract (the lead's; implementation by the executor):
 * - Catalogs: `assets/locales/<locale>.json`, flat { "key": "text" }; `{name}` placeholders take params.
 *   `en` is complete for every key the code uses; every shipped locale has every key of `en`.
 * - `normalizeLocale('ru_RU.UTF-8') === 'ru'`, `'ru-RU' → 'ru'`, `'EN' → 'en'`; `'C'`, `'POSIX'`, `''`,
 *   undefined → undefined.
 * - `resolveLocale(sources)`: the first source that is set wins, in this order — `flag` (`--locale`),
 *   `env.SDLC_LOCALE`, `config` (`locale:` in openspec/sdlc.yaml), `system`. The winner normalized; when it is
 *   not one of LOCALES the result is `en` (an explicit choice without a translation means English, it does not
 *   fall through to the next source). Nothing set → `en`.
 * - `systemLocale(env, intlLocale)`: `env.LC_ALL`, then `env.LC_MESSAGES`, then `env.LANG`, then `intlLocale`
 *   (default `Intl.DateTimeFormat().resolvedOptions().locale`); the first non-empty one that normalizes.
 * - `t(key, params?, locale?)`: text in `locale` (default: the current one set by `setLocale`), else in `en`,
 *   else the key itself. Params replace `{name}`.
 * - The CLI takes `--locale <locale>` on every command and sets the locale before the command runs (flag, env,
 *   the project's sdlc.yaml when there is one, system).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { assetsDir } from '../integrations/assets.js';

export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];

export interface LocaleSources {
  flag?: string;
  env?: NodeJS.ProcessEnv;
  config?: string;
  system?: string;
}

const cache = new Map<Locale, Record<string, string>>();
let current: Locale = 'en';

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

function loadCatalog(locale: Locale): Record<string, string> {
  const hit = cache.get(locale);
  if (hit) return hit;
  const file = path.join(assetsDir(), 'locales', `${locale}.json`);
  const raw = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(raw) as Record<string, string>;
  cache.set(locale, data);
  return data;
}

function substitute(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (Object.prototype.hasOwnProperty.call(params, name)) return String(params[name]);
    return match;
  });
}

export function normalizeLocale(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const primary = trimmed.split('.')[0] ?? '';
  const lang = primary.replace(/_/g, '-').split('-')[0]?.toLowerCase() ?? '';
  if (lang === '' || lang === 'c' || lang === 'posix') return undefined;
  return lang;
}

export function systemLocale(
  env: NodeJS.ProcessEnv = process.env,
  intlLocale?: string,
): string | undefined {
  for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG'] as const) {
    const normalized = normalizeLocale(env[key]);
    if (normalized) return normalized;
  }
  const fallback = intlLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;
  return normalizeLocale(fallback);
}

function firstSet(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    if (value !== undefined && value !== '') return value;
  }
  return undefined;
}

export function resolveLocale(sources: LocaleSources): Locale {
  const raw = firstSet(
    sources.flag,
    sources.env?.SDLC_LOCALE,
    sources.config,
    sources.system,
  );
  if (raw === undefined) return 'en';
  const normalized = normalizeLocale(raw);
  if (normalized && isLocale(normalized)) return normalized;
  return 'en';
}

export function setLocale(locale: Locale): void {
  current = locale;
}

export function currentLocale(): Locale {
  return current;
}

export function t(
  key: string,
  params?: Record<string, string | number>,
  locale?: Locale,
): string {
  const want = locale ?? current;
  const primary = loadCatalog(want)[key];
  if (primary !== undefined) return substitute(primary, params);
  if (want !== 'en') {
    const english = loadCatalog('en')[key];
    if (english !== undefined) return substitute(english, params);
  }
  return key;
}

/** The catalog of a locale (for tests and tools). */
export function catalog(locale: Locale): Record<string, string> {
  return { ...loadCatalog(locale) };
}
