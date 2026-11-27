import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin } from '../core/fs-utils.js';
import { ROLE_ID } from './role-file.js';
/**
 * The rules SkillForge installed, read from its lock files (`<agent dir>/.skillforge-lock.json`, `artifacts` keyed
 * `rule/<id>`). The files are written by another tool and may be edited by hand: each is parsed at this boundary, a
 * file that is missing, not a regular file, too large, outside the project's real path or not the expected JSON gives
 * no rules, and only ids of the registry's id form are kept. The runtime comes from the folder, never from the file.
 */
const LOCK_FILE = '.skillforge-lock.json';
const MAX_LOCK = 1024 * 1024;
const LOCK_DIRS = [
    ['.claude', 'claude-code'],
    ['.cursor', 'cursor'],
    ['.opencode', 'opencode'],
    ['.codex', 'codex'],
    ['.qwen', 'qwen'],
];
/** Review F2: a lock file whose real path leaves the project (a linked agent folder) is not read. */
function insideProject(realRoot, file) {
    return isWithin(realRoot, fs.realpathSync(file));
}
/** At most MAX_LOCK + 1 bytes of one open regular file; undefined when it is not one or is larger than the limit. */
function readBounded(fd) {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_LOCK)
        return undefined;
    const buffer = Buffer.alloc(MAX_LOCK + 1);
    let length = 0;
    while (length < buffer.length) {
        const read = fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (read === 0)
            break;
        length += read;
    }
    return length > MAX_LOCK ? undefined : buffer.toString('utf8', 0, length);
}
/** Review F2: one handle, no link followed at the last step (not on win32), the size from the open file. */
function lockText(realRoot, file) {
    const flags = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK
        | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW);
    try {
        if (!insideProject(realRoot, file))
            return undefined;
        const fd = fs.openSync(file, flags);
        try {
            return readBounded(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        return undefined;
    }
}
/** The rule ids of one lock file's `artifacts`; none when the file is not the expected shape. */
export function lockRuleIds(text) {
    let parsed;
    try {
        parsed = JSON.parse(text.replace(/^﻿/, ''));
    }
    catch {
        return [];
    }
    const artifacts = parsed && typeof parsed === 'object' ? parsed.artifacts : undefined;
    if (!artifacts || typeof artifacts !== 'object' || Array.isArray(artifacts))
        return [];
    return Object.keys(artifacts)
        .filter((key) => key.startsWith('rule/'))
        .map((key) => key.slice('rule/'.length))
        .filter((id) => ROLE_ID.test(id));
}
/** Every rule SkillForge recorded as installed in this project, with the runtime of its folder. */
export function installedSkillforgeRules(root) {
    const out = [];
    let realRoot;
    try {
        realRoot = fs.realpathSync(root);
    }
    catch {
        return out;
    }
    for (const [dir, runtime] of LOCK_DIRS) {
        const text = lockText(realRoot, path.join(root, dir, LOCK_FILE));
        if (text === undefined)
            continue;
        for (const id of lockRuleIds(text))
            out.push({ id, runtime });
    }
    return out;
}
