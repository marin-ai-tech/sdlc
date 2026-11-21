import * as fs from 'node:fs';
import * as path from 'node:path';
import { assetsDir, readAsset, splitFrontmatter } from '../integrations/assets.js';
import { SdlcError } from './errors.js';
import { readText } from './fs-utils.js';
function stepFiles() {
    const dir = path.join(assetsDir(), 'guide', 'en', 'tour');
    return fs.readdirSync(dir).filter((name) => /^\d{2}-[\w-]+\.md$/.test(name)).sort();
}
function readStep(file, locale) {
    const local = readText(path.join(assetsDir(), 'guide', locale, 'tour', file));
    const chosen = local === undefined ? 'en' : locale;
    const raw = (local ?? readAsset('guide', 'en', 'tour', file)).replace(/\r\n?/g, '\n');
    const { data, body } = splitFrontmatter(raw);
    const title = typeof data.title === 'string' ? data.title : file;
    return { title, body, locale: chosen };
}
function unknownStep(step, count) {
    return new SdlcError('invalid_option', { key: 'error.tour_step_unknown', params: { step, count } }, { key: 'fix.tour_steps', params: { count } });
}
/** The tour in `locale`: every step's title, and the requested step (the first one by default). */
export function guideTour(locale, step) {
    const files = stepFiles();
    const n = step === undefined ? 1 : Number(step);
    if (!Number.isInteger(n) || n < 1 || n > files.length)
        throw unknownStep(step ?? '', files.length);
    const steps = files.map((file, index) => ({ n: index + 1, title: readStep(file, locale).title }));
    const current = readStep(files[n - 1], locale);
    return { steps, current: { n, ...current } };
}
