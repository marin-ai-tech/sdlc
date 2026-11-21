import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isWithin } from './fs-utils.js';
import { t } from './i18n.js';
function invalid(where) {
    throw new SdlcError('invalid_config', { key: 'error.verify_unstable', params: { where } });
}
function validFile(file, root) {
    if (!file || file.trim() !== file || /[\\*?\[\]{}]/.test(file))
        return false;
    if (path.isAbsolute(file) || path.win32.isAbsolute(file) || /^[a-zA-Z]:/.test(file))
        return false;
    if (file.split('/').some((part) => !part || part === '.' || part === '..'))
        return false;
    return isWithin(root, path.resolve(root, file));
}
function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function parseUnstable(value, root, where) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        invalid(where('verify.unstable'));
    const entries = [];
    const files = new Set();
    for (const [index, raw] of value.entries()) {
        const key = `verify.unstable[${index}]`;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw))
            invalid(where(key));
        const entry = raw;
        for (const field of Object.keys(entry)) {
            if (!['file', 'item', 'since'].includes(field))
                invalid(where(`${key}.${field}`));
        }
        if (typeof entry.file !== 'string' || !validFile(entry.file, root) || files.has(entry.file)) {
            invalid(where(`${key}.file`));
        }
        if (typeof entry.item !== 'string' || !/^B\d+$/.test(entry.item))
            invalid(where(`${key}.item`));
        if (typeof entry.since !== 'string' || !validDate(entry.since))
            invalid(where(`${key}.since`));
        entries.push({ file: entry.file, item: entry.item, since: entry.since });
        files.add(entry.file);
    }
    return entries;
}
export function serializeUnstable(entries) {
    return entries.length > 0 ? { unstable: entries } : {};
}
export function unstableEnvironment(entries) {
    return entries.map((entry) => entry.file).join('\n');
}
function byFile(a, b) {
    if (a.file !== b.file)
        return a.file < b.file ? -1 : 1;
    if (a.item !== b.item)
        return a.item < b.item ? -1 : 1;
    return a.since < b.since ? -1 : a.since > b.since ? 1 : 0;
}
/** B183: the digest of the unstable list a run used; the order in sdlc.yaml does not change it. */
export function unstableDigest(entries) {
    const sorted = entries.map(({ file, item, since }) => ({ file, item, since })).sort(byFile);
    return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
export function unstableWeakeningWarnings(before, after) {
    const existing = new Set(before.map((entry) => entry.file));
    return after.filter((entry) => !existing.has(entry.file))
        .map((entry) => t('config.warning.unstable', { file: entry.file, item: entry.item }));
}
