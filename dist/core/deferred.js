/**
 * The deferred-work registry: `openspec/deferred-work.md`, one place for work
 * that was consciously postponed (a review finding accepted for later, a
 * design decision deferred, an imported "Deferred" section), so it is not
 * scattered across notes and forgotten.
 *
 * People and agents both edit the file; the CLI parses it tolerantly. Each
 * item is a level-3 heading followed by bullet fields:
 *
 *   ### D3 [open] Rate-limit the export endpoint
 *   - **Change**: add-export
 *   - **Finding**: F2
 *   - **Why**: not needed for the pilot tenant; revisit before GA
 *   - **Revisit when**: before general availability
 *   - **Created**: 2026-09-30 by Pat Owner <pat@example.com>
 *   - **Closed**: 2026-10-12 done — shipped in add-rate-limits   (only when closed)
 */
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { readText, writeTextAtomic } from './fs-utils.js';
export const DEFERRED_PATH = 'openspec/deferred-work.md';
export const DEFERRED_STATUSES = ['open', 'done', 'dropped'];
function oneLine(value, name) {
    if (!value.trim() || /[\r\n]/.test(value))
        throw new SdlcError('invalid_option', { key: 'error.x_must_be_one_non_empty_line', params: { name: name } });
}
/** Parses the registry text. Unknown statuses read as `open`; malformed headings are skipped. */
export function parseDeferred(text) {
    const items = [];
    let current;
    let code = false;
    for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (/^\s*```/.test(line)) {
            code = !code;
            continue;
        }
        if (code)
            continue;
        const heading = /^### D(\d+) \[([^\]]+)\] (.+)$/.exec(line);
        if (heading) {
            current = { id: `D${heading[1]}`, status: DEFERRED_STATUSES.includes(heading[2]) ? heading[2] : 'open', title: heading[3], line: index + 1 };
            items.push(current);
            continue;
        }
        if (line.startsWith('### ')) {
            current = undefined;
            continue;
        }
        const field = /^\s*[-*] \*\*(Change|Finding|Why|Revisit when|Created|Closed)\*\*: (.*)$/.exec(line);
        if (current && field) {
            const key = { Change: 'change', Finding: 'finding', Why: 'why', 'Revisit when': 'revisit', Created: 'created', Closed: 'closed' }[field[1]];
            current[key] = field[2];
        }
    }
    return items;
}
/** Reads `openspec/deferred-work.md` under `root`; a missing file is an empty registry. */
export function readDeferred(root) {
    return parseDeferred(readText(path.join(root, DEFERRED_PATH)) ?? '');
}
/**
 * Appends an open item with the next free id (max existing + 1) and returns it.
 * Creates the file with a short header when missing. Title, why and every
 * field are one line (newlines are an `invalid_option` error).
 */
export function addDeferred(root, input, now = new Date()) {
    for (const [key, value] of Object.entries(input))
        if (value !== undefined)
            oneLine(value, key);
    const file = path.join(root, DEFERRED_PATH);
    const previous = readText(file) ?? '# Deferred work\n';
    const id = `D${Math.max(0, ...parseDeferred(previous).map((item) => Number(item.id.slice(1)))) + 1}`;
    const fields = [input.change && `- **Change**: ${input.change}`, input.finding && `- **Finding**: ${input.finding}`, `- **Why**: ${input.why}`, input.revisit && `- **Revisit when**: ${input.revisit}`, `- **Created**: ${now.toISOString().slice(0, 10)}${input.by ? ` by ${input.by}` : ''}`].filter(Boolean);
    writeTextAtomic(file, `${previous.trimEnd()}\n\n### ${id} [open] ${input.title}\n${fields.join('\n')}\n`);
    return readDeferred(root).find((item) => item.id === id);
}
/**
 * Closes an item as `done` or `dropped`: rewrites its heading status and adds
 * a **Closed** field with the date and note. Unknown id → `unknown_deferred`;
 * an item that is not open → `deferred_not_open`.
 */
export function closeDeferred(root, id, status, note, now = new Date()) {
    oneLine(note, 'note');
    if (status !== 'done' && status !== 'dropped')
        throw new SdlcError('invalid_option', { key: 'error.invalid_deferred_status_x', params: { status: status } });
    const file = path.join(root, DEFERRED_PATH);
    const lines = (readText(file) ?? '').split(/\r?\n/);
    const item = parseDeferred(lines.join('\n')).find((entry) => entry.id === id);
    if (!item)
        throw new SdlcError('unknown_deferred', { key: 'error.unknown_deferred_item_x', params: { id: id } });
    if (item.status !== 'open')
        throw new SdlcError('deferred_not_open', { key: 'error.x_is_not_open', params: { id: id } });
    lines[item.line - 1] = `### ${id} [${status}] ${item.title}`;
    let end = item.line;
    while (end < lines.length && !/^### /.test(lines[end]))
        end++;
    lines.splice(end, 0, `- **Closed**: ${now.toISOString().slice(0, 10)} ${status} — ${note}`);
    writeTextAtomic(file, `${lines.join('\n').trimEnd()}\n`);
    return readDeferred(root).find((entry) => entry.id === id);
}
