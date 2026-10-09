import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { normalizeNewlines, readText } from './fs-utils.js';
import { stripProvenance } from './license.js';
/**
 * Content digest of a set of files, used to bind a gate approval to exactly
 * what the approver read. Paths are relative to `baseDir`; line endings and
 * trailing whitespace at end of file are normalized so a Windows checkout of
 * the same commit produces the same digest. The provenance line the CLI
 * stamps into artifacts is not content, so stamping never changes a digest.
 */
export function digestFiles(baseDir, relativePaths, transform) {
    const hash = createHash('sha256');
    for (const rel of [...new Set(relativePaths)].sort()) {
        const raw = readText(path.join(baseDir, rel));
        if (raw === undefined)
            continue;
        const normalized = stripProvenance(normalizeNewlines(raw));
        const content = transform ? transform(rel, normalized) : normalized;
        hash.update(`${rel.replace(/\\/g, '/')}\0`);
        hash.update(content.replace(/\s+$/u, ''));
        hash.update('\0');
    }
    return `sha256:${hash.digest('hex')}`;
}
/**
 * Checkbox progress is not part of what a plan approval covers: ticking
 * `- [ ]` to `- [x]` in the tracked tasks file must not make the plan gate
 * stale, while editing, adding or removing a task must.
 */
export function withoutCheckboxState(content) {
    return content.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s*)\[[^\]\n]?\s*\]/gm, '$1[ ]');
}
