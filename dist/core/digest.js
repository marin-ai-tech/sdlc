import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin, normalizeNewlines, readText } from './fs-utils.js';
import { stripProvenance } from './license.js';
import { SdlcError } from './errors.js';
function digestText(baseDir, relative) {
    const target = path.resolve(baseDir, relative);
    if (!isWithin(baseDir, target)) {
        throw new SdlcError('unsafe_path', { key: 'error.digestArtifactUnsafe', params: { file: relative } });
    }
    if (!fs.existsSync(target)) {
        throw new SdlcError('artifact_unreadable', { key: 'error.digestArtifactUnreadable', params: { file: relative } });
    }
    if (!isWithin(fs.realpathSync(baseDir), fs.realpathSync(target))) {
        throw new SdlcError('unsafe_path', { key: 'error.digestArtifactUnsafe', params: { file: relative } });
    }
    const text = readText(target);
    if (text === undefined) {
        throw new SdlcError('artifact_unreadable', { key: 'error.digestArtifactUnreadable', params: { file: relative } });
    }
    return text;
}
/**
 * Content digest of a set of files, used to bind a gate approval to exactly
 * what the approver read. Paths are relative to `baseDir`; line endings and
 * trailing whitespace at end of file are normalized so a Windows checkout of
 * the same commit produces the same digest. The provenance line the CLI
 * stamps into artifacts is not content, so stamping never changes a digest.
 */
export function digestFiles(baseDir, relativePaths, transform, capture) {
    const hash = createHash('sha256');
    const files = [];
    for (const rel of [...new Set(relativePaths)].sort()) {
        const raw = digestText(baseDir, rel);
        const normalized = stripProvenance(normalizeNewlines(raw));
        const content = (transform ? transform(rel, normalized) : normalized).replace(/\s+$/u, '');
        const name = rel.replace(/\\/g, '/');
        files.push({ path: name, text: content });
        hash.update(`${name}\0`);
        hash.update(content);
        hash.update('\0');
    }
    const digest = `sha256:${hash.digest('hex')}`;
    capture?.set(digest, { digest, files });
    return digest;
}
/**
 * Checkbox progress is not part of what a plan approval covers: ticking
 * `- [ ]` to `- [x]` in the tracked tasks file must not make the plan gate
 * stale, while editing, adding or removing a task must.
 */
export function withoutCheckboxState(content) {
    return content.replace(/^(\s*(?:[-*+]|\d{1,9}[.)])\s*)\[[^\]\n]?\s*\]/gm, '$1[ ]');
}
