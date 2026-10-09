import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { formatNextLine, resolveNext } from '../cli/next-hint.js';
import { addDeferred, closeDeferred, readDeferred } from '../core/deferred.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { appendLog } from '../core/log.js';
import { t } from '../core/i18n.js';
function deferStatus(status) {
    const key = `defer.status.${status}`;
    const text = t(key);
    return text === key ? status : text;
}
function formatDeferredTable(items) {
    const headers = [t('defer.colId'), t('defer.colStatus'), t('defer.colTitle'), t('defer.colChange')];
    const rows = items.map((item) => {
        const change = item.change ?? '-';
        return [item.id, deferStatus(item.status), item.title, change];
    });
    const widths = headers.map((header, index) => {
        let width = header.length;
        for (const row of rows) {
            const cellWidth = row[index].length;
            if (cellWidth > width) {
                width = cellWidth;
            }
        }
        return width;
    });
    const lines = [headers, ...rows].map((cells) => {
        const padded = cells.map((cell, index) => cell.padEnd(widths[index]));
        return padded.join('  ').trimEnd();
    });
    return lines.join('\n');
}
export function deferAdd(title, opts) {
    try {
        const ctx = loadProject();
        if (!opts.why)
            throw new SdlcError('invalid_option', { key: 'error.why_is_required' });
        const by = formatIdentity(gitIdentity(ctx.root));
        const item = addDeferred(ctx.root, { title, why: opts.why, change: opts.change, finding: opts.finding, revisit: opts.revisit, by });
        appendLog(ctx.root, ctx.config, { event: 'deferred.added', change: item.change, by, detail: `${item.id} ${item.title}` }, ctx.stamp);
        let next;
        if (opts.change) {
            try {
                next = resolveNext(ctx, opts.change);
            }
            catch {
                next = undefined;
            }
        }
        if (opts.json)
            printJson({ item, harness: ctx.stamp, ...(next ? { next } : {}) });
        else {
            line(`${item.id} ${item.title}`);
            const hint = next ? formatNextLine(ctx, next) : undefined;
            if (hint)
                line(hint);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function deferList(opts) {
    try {
        const ctx = loadProject();
        const items = readDeferred(ctx.root).filter((item) => (!opts.open || item.status === 'open') && (!opts.change || item.change === opts.change));
        if (opts.json) {
            printJson({ items, harness: ctx.stamp });
            return;
        }
        if (items.length === 0) {
            line(t('defer.none'));
            return;
        }
        line(formatDeferredTable(items));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function deferClose(id, opts) {
    try {
        const ctx = loadProject();
        if (opts.status !== 'done' && opts.status !== 'dropped')
            throw new SdlcError('invalid_option', { key: 'error.status_must_be_done_or_dropped' });
        if (!opts.note)
            throw new SdlcError('invalid_option', { key: 'error.note_is_required' });
        const item = closeDeferred(ctx.root, id, opts.status, opts.note);
        appendLog(ctx.root, ctx.config, { event: 'deferred.closed', change: item.change, detail: `${item.id} ${item.title}` }, ctx.stamp);
        if (opts.json)
            printJson({ item, harness: ctx.stamp });
        else
            line(`${item.id} ${deferStatus(item.status)} ${item.title}`);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
