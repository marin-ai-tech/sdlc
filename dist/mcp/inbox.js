import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { agentEnvironment } from '../core/agent-env.js';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
/**
 * The inbox (0.9.0): inside an agent session an MCP check's result goes back to the agent in the command's answer;
 * outside one (a person's or CI's `sdlc verify`) it is also kept for the agent, one file per result in
 * `openspec/.sdlc/inbox/<id>.json`. The next session start lists the open ones; `sdlc inbox done <id>` marks one
 * read (any actor: it decides nothing). The files are state only the CLI writes (the hook denies agents' edits).
 */
export const INBOX_DIR = 'openspec/.sdlc/inbox';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
function inboxDir(root) {
    return path.join(root, INBOX_DIR);
}
/** `<time>-<check>-<random>`: sorts by time, names the check, never collides within a run. */
function newId(at, check) {
    const time = at.replace(/[-:.]/g, '');
    const name = check.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'check';
    return `${time}-${name}-${randomBytes(3).toString('hex')}`;
}
function itemOf(change, outcome, at) {
    const reason = outcome.reason === undefined ? {} : { reason: outcome.reason };
    const { name, server, tool, ok, result } = outcome;
    return { id: newId(at, name), change, check: name, server, tool, ok, ...reason, result, at, done: false };
}
function writeItem(root, item) {
    writeTextAtomic(path.join(inboxDir(root), `${item.id}.json`), `${JSON.stringify(item, null, 2)}\n`);
}
/** Outside an agent session, keeps each MCP result of the run for the agent; returns the ids written. */
export function keepForAgent(root, change, run, env = process.env) {
    if (agentEnvironment(env) !== undefined || !run.mcp || run.mcp.length === 0)
        return [];
    const items = run.mcp.map((outcome) => itemOf(change, outcome, run.at));
    for (const item of items)
        writeItem(root, item);
    return items.map((item) => item.id);
}
function readItem(file) {
    try {
        const item = JSON.parse(readText(file) ?? '');
        return item && typeof item.id === 'string' && typeof item.change === 'string' ? item : undefined;
    }
    catch {
        return undefined;
    }
}
/** Every item, newest first; unreadable files are skipped. */
export function readInbox(root) {
    let names = [];
    try {
        names = fs.readdirSync(inboxDir(root)).filter((name) => name.endsWith('.json'));
    }
    catch {
        return [];
    }
    const items = names.map((name) => readItem(path.join(inboxDir(root), name)));
    const known = items.filter((item) => item !== undefined);
    return known.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
/** Marks an item read. An unknown id is an error naming it. */
export function markDone(root, id) {
    const file = path.join(inboxDir(root), `${id}.json`);
    const item = ID.test(id) ? readItem(file) : undefined;
    if (!item) {
        throw new SdlcError('inbox_item_not_found', { key: 'error.inbox_item_not_found', params: { id } }, { key: 'fix.inbox_list' });
    }
    if (!item.done)
        writeItem(root, { ...item, done: true });
    return { ...item, done: true };
}
/** One session-start line per open item: change, check, ok or failed, and how to mark it read. */
export function inboxSessionLines(root, cli = 'sdlc') {
    const open = readInbox(root).filter((item) => !item.done);
    return open.map((item) => t('session.inboxItem', {
        change: item.change,
        check: item.check,
        state: t(item.ok ? 'session.inboxOk' : 'session.inboxFailed'),
        cli,
        id: item.id,
    }));
}
