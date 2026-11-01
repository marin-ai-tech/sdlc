import * as path from 'node:path';
import picomatch from 'picomatch';
import { isFile, readText } from './fs-utils.js';
import { readWorkingChangedPaths } from './changed-paths.js';
import { stripProvenance } from './license.js';
const PATH_TOKEN = /(?:`([^`\r\n]+)`)|(?:^|[\s(])((?:[\w.@-]+\/)+[\w.@*-]+\/?)/gm;
/** Path-like tokens in plan.md: backticked tokens with a slash or extension, and bare a/b/c paths. */
export function plannedPaths(planText) {
    const out = new Set();
    for (const m of planText.matchAll(PATH_TOKEN)) {
        const raw = (m[1] ?? m[2] ?? '').replace(/[),.;:]+$/, '');
        if (!raw || raw.startsWith('http') || raw.startsWith('-') || raw.includes('<'))
            continue;
        if (m[1] !== undefined && !raw.includes('/') && !/\.[A-Za-z0-9]{1,8}$/.test(raw))
            continue;
        if (m[1] === undefined && /\s/.test(raw))
            continue;
        out.add(raw.replace(/^\.\//, ''));
    }
    return [...out].sort();
}
function matchesPlan(file, planned) {
    return planned.some((p) => {
        if (p === file)
            return true;
        if (p.endsWith('/'))
            return file.startsWith(p);
        if (/[*?[]/.test(p))
            return picomatch(p, { dot: true })(file);
        // A bare file name in the plan matches that file anywhere in the tree.
        if (!p.includes('/'))
            return path.posix.basename(file) === p;
        return false;
    });
}
export function changedFiles(root, base, exclude = ['openspec/']) {
    return readWorkingChangedPaths(root, base).filter((file) => !exclude.some((prefix) => file.startsWith(prefix)));
}
/**
 * @param ignore files that are not part of the change's own work, such as the
 *   agent integration files the harness generated (tracked in its manifest)
 */
export function computePlanDrift(root, changeDir, base, ignore = []) {
    const planFile = path.join(changeDir, 'plan.md');
    const planned = isFile(planFile) ? plannedPaths(stripProvenance(readText(planFile) ?? '')) : [];
    const ignored = new Set(ignore);
    const changed = changedFiles(root, base).filter((f) => !ignored.has(f));
    const unplanned = planned.length > 0 ? changed.filter((f) => !matchesPlan(f, planned)) : [];
    const untouched = planned.filter((p) => !p.endsWith('/') && !/[*?[]/.test(p) && p.includes('/') && !changed.includes(p));
    return { ...(base ? { base } : {}), changedFiles: changed, plannedPaths: planned, unplanned, untouched };
}
