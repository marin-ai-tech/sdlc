import * as fs from 'node:fs';
import * as path from 'node:path';
import { git } from './git.js';
import { readText } from './fs-utils.js';
import { SdlcError } from './errors.js';
function literalPattern(value) {
    if (/[\r\n]/.test(value))
        throw new SdlcError('local_ignore', 'Local state exclusion needs a single-line project path');
    return value.replace(/[\\*?\[\]#! ]/g, '\\$&');
}
function samePath(first, second) {
    return process.platform === 'win32' ? first.toLowerCase() === second.toLowerCase() : first === second;
}
/** Reject links that switch Git trees before choosing an exclude file. */
function checkLinkBoundaries(root, physicalTop) {
    const absolute = path.resolve(root);
    const parsed = path.parse(absolute);
    let current = parsed.root;
    for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
        const parent = current;
        current = path.join(current, part);
        if (!fs.lstatSync(current).isSymbolicLink())
            continue;
        const parentTop = git(parent, ['rev-parse', '--show-toplevel']);
        if (!parentTop.ok || !samePath(fs.realpathSync.native(parentTop.stdout), physicalTop)) {
            throw new SdlcError('local_ignore', 'Cannot establish the original Git boundary through a link');
        }
    }
}
/** Reading commands add missing state-file rules to Git's local exclude file. */
export function ensureLocalIgnore(root, entries) {
    const tracked = readText(path.join(root, 'openspec/.sdlc/.gitignore')) ?? '';
    const present = new Set(tracked.split(/\r?\n/).map((line) => line.trim()));
    const missing = entries.filter((entry) => !present.has(entry));
    if (missing.length === 0)
        return;
    const physicalRoot = fs.realpathSync.native(root);
    const result = git(physicalRoot, ['rev-parse', '--git-path', 'info/exclude']);
    if (!result.ok)
        return;
    const file = path.resolve(physicalRoot, result.stdout);
    const top = git(physicalRoot, ['rev-parse', '--show-toplevel']);
    if (!top.ok)
        return;
    const physicalTop = fs.realpathSync.native(top.stdout);
    const relative = path.relative(physicalTop, physicalRoot);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new SdlcError('local_ignore', 'Project is outside its Git tree');
    }
    checkLinkBoundaries(root, physicalTop);
    const project = relative.split(path.sep).join('/');
    const prefix = project ? `${project}/` : '';
    const existing = readText(file) ?? '';
    const local = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
    const additions = missing.map(entry => literalPattern(`${prefix}openspec/.sdlc/${entry}`))
        .filter(entry => !local.has(entry));
    if (additions.length === 0)
        return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(file, `${separator}${additions.join('\n')}\n`);
}
