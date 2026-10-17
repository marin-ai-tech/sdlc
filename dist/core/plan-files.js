import * as path from 'node:path';
import picomatch from 'picomatch';
import { isFile, readText } from './fs-utils.js';
/**
 * The files a plan says it changes, under "## Files that change" up to the next level-one or level-two heading.
 * Read every backticked path and the first path-like token of each list item (-, *, +, or numbered). Normalize
 * backslashes and leading ./; exclude URLs, flags, placeholders, parent traversal and absolute paths. Readers
 * that need matching patterns may include globs; audit readers keep plain paths only.
 */
const HEADING = /^(#{1,6})\s+(.*)$/;
const FILES_TITLE = /^files\s+that\s+change\s*$/i;
const BACKTICKED = /`([^`\s]+)`/g;
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s+(?:`[^`]+`\s*)?([^\s`]+)/;
const GLOB_CHARS = /[*?[{]/;
/** One spelling per planned path: forward slashes, no leading `./`. */
function cleanPath(raw) {
    return raw.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '');
}
/** A token that names a path rather than a flag, a URL or a placeholder. */
function looksLikePath(token, includeGlobs) {
    if (!token || token.startsWith('-') || token.includes('<') || token.includes('://'))
        return false;
    if (token.startsWith('/') || /^[A-Za-z]:\//.test(token) || token.split('/').includes('..'))
        return false;
    if ((!includeGlobs && GLOB_CHARS.test(token)) || token.includes(':'))
        return false;
    if (!includeGlobs && token.includes(']'))
        return false;
    return token.includes('/') || /\.[A-Za-z0-9]{1,8}$/.test(token);
}
function collect(line, files, includeGlobs) {
    for (const match of line.matchAll(BACKTICKED)) {
        const file = cleanPath(match[1]);
        if (looksLikePath(file, includeGlobs)) {
            files.add(file);
        }
    }
    const item = LIST_ITEM.exec(line);
    if (!item)
        return;
    const file = cleanPath(item[1].replace(/[),;]+$/, ''));
    if (looksLikePath(file, includeGlobs))
        files.add(file);
}
/** Planned paths in the "Files that change" section; [] when the section is missing. */
export function filesThatChange(planText, includeGlobs = false) {
    const files = new Set();
    let inSection = false;
    for (const line of planText.split(/\r?\n/)) {
        const heading = HEADING.exec(line.trim());
        if (heading && (heading[1].length <= 2 || !inSection)) {
            inSection = heading[1].length === 2 && FILES_TITLE.test(heading[2]);
            continue;
        }
        if (inSection) {
            collect(line, files, includeGlobs);
        }
    }
    return [...files];
}
/** The planned files of a change, or undefined when the change has no plan.md. */
export function readPlanFiles(changeDir, includeGlobs = false) {
    const file = path.join(changeDir, 'plan.md');
    if (!isFile(file)) {
        return undefined;
    }
    return filesThatChange(readText(file) ?? '', includeGlobs);
}
const PROOF_TITLE = /^proof\s*$/i;
const HTML_COMMENT = /^\s*<!--/;
/** The lines of a "## <title>" section, up to the next level-one/two heading: non-empty, comments dropped. */
function sectionLines(planText, title) {
    const lines = [];
    let inSection = false;
    for (const line of planText.split(/\r?\n/)) {
        const heading = HEADING.exec(line.trim());
        if (heading && (heading[1].length <= 2 || !inSection)) {
            inSection = heading[1].length === 2 && title.test(heading[2]);
            continue;
        }
        if (inSection && line.trim() !== '' && !HTML_COMMENT.test(line))
            lines.push(line.trim());
    }
    return lines;
}
/** What the plan's "## Proof" section says proves the change; [] without plan.md or the section. */
export function readPlanProof(changeDir) {
    const file = path.join(changeDir, 'plan.md');
    if (!isFile(file)) {
        return [];
    }
    return sectionLines(readText(file) ?? '', PROOF_TITLE);
}
/**
 * True when a project file (posix, relative to the root) is a planned one: the same path, a file under a planned
 * directory (`src/payments/`) or a match of a planned glob. Case-insensitive, as Windows and macOS paths are.
 */
export function matchesPlanFile(planned, rel) {
    const want = planned.toLowerCase();
    const file = rel.toLowerCase();
    if (want === file) {
        return true;
    }
    if (want.endsWith('/')) {
        return file.startsWith(want);
    }
    if (GLOB_CHARS.test(want)) {
        return picomatch(want, { dot: true, nocase: true })(file);
    }
    return false;
}
