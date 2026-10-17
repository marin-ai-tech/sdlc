import * as fs from 'node:fs';
import * as path from 'node:path';
import { changeDirs, inboxFiles } from './policy-shell.js';
import { STATE_FILES } from './state-files.js';
/** Device and inode of a file with more than one link; undefined for anything else. */
function linkedId(abs) {
    try {
        const stat = fs.statSync(abs, { bigint: true });
        if (!stat.isFile() || stat.nlink <= 1n)
            return undefined;
        return { dev: stat.dev, ino: stat.ino };
    }
    catch {
        return undefined;
    }
}
/** The state files of the project, root-relative: the fixed ones, each change's `.sdlc.yaml`, the inbox files. */
function stateFiles(root) {
    return [...STATE_FILES, ...changeDirs(root).map((dir) => `${dir}/.sdlc.yaml`), ...inboxFiles(root)];
}
function sameFile(id, abs) {
    const other = linkedId(abs);
    return other !== undefined && other.dev === id.dev && other.ino === id.ino;
}
/** Edit targets that are hard links to a state file: the state files they share an inode with, root-relative. */
export function hardLinkedStateFiles(files, root, cwd) {
    return hardLinkedFiles(files, root, cwd, stateFiles);
}
/**
 * Edit targets that are hard links to one of `candidates` (root-relative, listed only when a target has more than
 * one link): the candidates they share an inode with, root-relative.
 */
export function hardLinkedFiles(files, root, cwd, candidates) {
    const ids = files.map((file) => linkedId(path.resolve(cwd, file)));
    const linked = ids.filter((id) => id !== undefined);
    if (linked.length === 0)
        return [];
    const hit = (rel) => linked.some((id) => sameFile(id, path.join(root, rel)));
    return candidates(root).filter(hit);
}
