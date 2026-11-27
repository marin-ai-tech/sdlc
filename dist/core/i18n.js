/**
 * Localized text for people: help, Next hints, stage and gate labels, the init wizard, hook reasons, the report
 * and the dashboard. JSON output, the project log and change records never depend on the locale: they are read
 * by agents, CI and later versions.
 *
 * Contract (the lead's; implementation by the executor):
 * - Catalogs: `assets/locales/<locale>.json`, flat { "key": "text" }; `{name}` placeholders take params.
 *   `en` is complete for every key the code uses; every shipped locale has every key of `en`.
 * - `normalizeLocale('xx_XX.UTF-8') === 'xx'`, `'xx-XX' → 'xx'`, `'EN' → 'en'`; `'C'`, `'POSIX'`, `''`,
 *   undefined → undefined.
 * - `resolveLocale(sources)`: the first source that is set wins, in this order — `flag` (`--locale`),
 *   `env.SDLC_LOCALE`, `config` (`locale:` in openspec/sdlc.yaml), `system`. The winner normalized; when it is
 *   without an installed catalog the result is `en`. An explicit choice without a translation means English;
 *   it does not fall through to the next source. Nothing set → `en`.
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
/** Catalogs installed beside the English catalog, in stable display order. */
export function localesIn(dir) {
    if (!fs.existsSync(dir))
        return ['en'];
    return ['en', ...fs.readdirSync(dir)
            .filter((name) => name.endsWith('.json') && name !== 'en.json'
            && fs.statSync(path.join(dir, name)).isFile())
            .map((name) => path.basename(name, '.json'))
            .sort()];
}
export function installedLocales() {
    return localesIn(path.join(assetsDir(), 'locales'));
}
const cache = new Map();
let current = 'en';
function isLocale(value) {
    return installedLocales().includes(value);
}
function loadCatalog(locale) {
    const hit = cache.get(locale);
    if (hit)
        return hit;
    const file = path.join(assetsDir(), 'locales', `${locale}.json`);
    const raw = fs.readFileSync(file, 'utf8');
    const data = JSON.parse(raw);
    cache.set(locale, data);
    return data;
}
function renderParam(value, locale) {
    if (Array.isArray(value))
        return value.map((ref) => t(ref.key, ref.params, locale)).join(' ');
    if (typeof value === 'object')
        return t(value.key, value.params, locale);
    return String(value);
}
/**
 * A value right before the template's own period loses its trailing periods: a person's note or a judge's text that
 * ends a sentence ("…the till.") would otherwise read "…the till.." (a defect found by the 0.20.0 course audit).
 */
function beforePeriod(value, text, end) {
    return text[end] === '.' ? value.replace(/\.+$/, '') : value;
}
function substitute(text, params, locale) {
    if (!params)
        return text;
    return text.replace(/\{(\w+)\}/g, (match, name, offset) => {
        if (!Object.prototype.hasOwnProperty.call(params, name))
            return match;
        return beforePeriod(renderParam(params[name], locale), text, offset + match.length);
    });
}
export function normalizeLocale(value) {
    if (value === undefined)
        return undefined;
    const trimmed = value.trim();
    if (trimmed === '')
        return undefined;
    const primary = trimmed.split('.')[0] ?? '';
    const lang = primary.replace(/_/g, '-').split('-')[0]?.toLowerCase() ?? '';
    if (lang === '' || lang === 'c' || lang === 'posix')
        return undefined;
    return lang;
}
export function systemLocale(env = process.env, intlLocale) {
    for (const key of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
        const normalized = normalizeLocale(env[key]);
        if (normalized)
            return normalized;
    }
    const fallback = intlLocale ?? Intl.DateTimeFormat().resolvedOptions().locale;
    return normalizeLocale(fallback);
}
function firstSet(...values) {
    for (const value of values) {
        if (value !== undefined && value !== '')
            return value;
    }
    return undefined;
}
export function resolveLocale(sources) {
    const raw = firstSet(sources.flag, sources.env?.SDLC_LOCALE, sources.config, sources.system);
    if (raw === undefined)
        return 'en';
    const normalized = normalizeLocale(raw);
    if (normalized && isLocale(normalized))
        return normalized;
    return 'en';
}
export function setLocale(locale) {
    current = locale;
}
export function currentLocale() {
    return current;
}
export function t(key, params, locale) {
    const want = locale ?? current;
    const primary = loadCatalog(want)[key];
    if (primary !== undefined)
        return substitute(primary, params, want);
    if (want !== 'en') {
        const english = loadCatalog('en')[key];
        if (english !== undefined)
            return substitute(english, params, want);
    }
    return key;
}
/** The catalog of a locale (for tests and tools). */
export function catalog(locale) {
    return { ...loadCatalog(locale) };
}
