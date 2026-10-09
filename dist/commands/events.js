import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { recordAwaiting } from '../core/awaiting.js';
import { listActiveChanges } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { evaluateChange } from '../core/lifecycle.js';
import { deliverPending, FLUSH_CALL_MS } from '../mcp/events.js';
import { readOutbox } from '../mcp/outbox.js';
function receiverViews(ctx) {
    return (ctx.config.events ?? []).map((receiver) => ({ server: receiver.server, tool: receiver.tool,
        on: receiver.on }));
}
function printList(pending, receivers) {
    if (receivers.length === 0)
        line(t('events.noReceivers'));
    for (const receiver of receivers) {
        line(t('events.receiver', { server: receiver.server, tool: receiver.tool, on: receiver.on.join(', ') }));
    }
    if (pending.length === 0) {
        line(t('events.noPending'));
        return;
    }
    line(t('events.pendingCount', { count: pending.length }));
    for (const event of pending)
        line(`  ${c.dim(event.at)}  ${event.event}${event.change ? `  ${event.change}` : ''}`);
}
/** `sdlc events list [--json]`: `{ pending: [event bodies], receivers }`, oldest event first. */
export async function eventsListCommand(opts) {
    try {
        const ctx = loadProject();
        const pending = readOutbox(ctx.root).map((queued) => queued.item.event);
        const receivers = receiverViews(ctx);
        if (opts.json)
            return printJson({ pending, receivers });
        printList(pending, receivers);
    }
    catch (error) {
        reportFailure(error, opts.json, { pending: [], receivers: [] });
    }
}
/** Records waiting and overdue gates of the active changes (B55), as status and next do. */
function recordWaits(ctx) {
    const views = listActiveChanges(ctx.paths).flatMap((ref) => {
        try {
            return [evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true })];
        }
        catch {
            return [];
        }
    });
    recordAwaiting(ctx.root, ctx.config, views, ctx.stamp);
}
/** `sdlc events flush [--json]`: delivers now, 10 s per call, `{ delivered, failed }`; exit 0 either way. */
export async function eventsFlushCommand(opts) {
    try {
        const ctx = loadProject();
        recordWaits(ctx);
        const result = await deliverPending(ctx.root, ctx.config, { callMs: FLUSH_CALL_MS });
        if (opts.json)
            return printJson(result);
        line(t('events.flushed', { delivered: result.delivered, failed: result.failed }));
    }
    catch (error) {
        reportFailure(error, opts.json, { delivered: 0, failed: 0 });
    }
}
