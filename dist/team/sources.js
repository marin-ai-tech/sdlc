import * as path from 'node:path';
import { isFile, normalizeNewlines, readText } from '../core/fs-utils.js';
import { currentLocale, LOCALES, normalizeLocale } from '../core/i18n.js';
import { harnessVersion } from '../core/version.js';
import { assetsDir } from '../integrations/assets.js';
import { builtinDraft, withoutSource } from './draft.js';
export const BUILTIN_ROLE_IDS = ['analyst', 'architect', 'developer', 'tester', 'reviewer'];
function isLocale(value) {
    return value !== undefined && LOCALES.includes(value);
}
/** The project's language: `locale` in sdlc.yaml, else the active locale. */
export function teamLocale(config) {
    const configured = normalizeLocale(config.locale);
    return isLocale(configured) ? configured : currentLocale();
}
function roleAsset(locale, id) {
    const file = path.join(assetsDir(), 'roles', locale, `${id}.md`);
    const text = isFile(file) ? readText(file) : undefined;
    return text === undefined ? undefined : normalizeNewlines(text);
}
/** The text of a built-in role in the locale, English when the locale has none; undefined for an unknown role. */
export function builtinRoleText(id, locale) {
    return roleAsset(locale, id) ?? roleAsset('en', id);
}
export function isBuiltinRole(id) {
    return BUILTIN_ROLE_IDS.includes(id);
}
/**
 * The sdlc version when `text` is a built-in role exactly as shipped (in any locale), apart from the `source` block
 * sync adds to the draft; otherwise undefined.
 */
export function builtinVersion(id, text) {
    const plain = withoutSource(text);
    const same = LOCALES.some((locale) => {
        const asset = roleAsset(locale, id);
        return asset !== undefined && withoutSource(asset) === plain;
    });
    return same ? harnessVersion() : undefined;
}
export const builtinSource = {
    id: 'builtin',
    drafts(locale) {
        return BUILTIN_ROLE_IDS.flatMap((id) => {
            const text = builtinRoleText(id, locale);
            if (text === undefined)
                return [];
            const version = harnessVersion();
            return [{ id, text: builtinDraft(text, version), source: 'builtin', version }];
        });
    },
};
/** The sources `sdlc team sync` reads, in order; the first source that has a role wins. */
export const ROLE_SOURCES = [builtinSource];
