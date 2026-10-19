import { loadProject, type ProjectContext } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { recordAwaiting } from '../core/awaiting.js';
import { listActiveChanges } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { appendLog } from '../core/log.js';
import { evaluateChange, sharedFingerprint, type LifecycleView } from '../core/lifecycle.js';
import { deliverPending, FLUSH_CALL_MS } from '../mcp/events.js';
import { missingEventVariables } from '../mcp/event-args.js';
import { readOutbox, type EventBody } from '../mcp/outbox.js';
import { dropStaleWaits } from '../mcp/stale-waits.js';
import {
  buildDailySummary,
  reportForSummary,
  summaryAlreadySent,
} from './summary-daily.js';

/** `sdlc events list|flush` (B45): the event queue and its receivers. Any actor may run both; they decide nothing. */
interface ReceiverView {
  server: string;
  tool: string;
  on: string[];
  missing: string[];
}

function receiverViews(ctx: ProjectContext): ReceiverView[] {
  return (ctx.config.events ?? []).map((receiver) => ({ server: receiver.server, tool: receiver.tool,
    on: receiver.on, missing: missingEventVariables(receiver.args, process.env) }));
}

function printList(pending: EventBody[], receivers: ReceiverView[]): void {
  if (receivers.length === 0) line(t('events.noReceivers'));
  for (const receiver of receivers) {
    line(t('events.receiver', { server: receiver.server, tool: receiver.tool, on: receiver.on.join(', ') }));
    if (receiver.missing.length) line(`  ${receiver.missing.join(', ')} is unset`);
  }
  if (pending.length === 0) {
    line(t('events.noPending'));
    return;
  }
  line(t('events.pendingCount', { count: pending.length }));
  for (const event of pending) line(`  ${c.dim(event.at)}  ${event.event}${event.change ? `  ${event.change}` : ''}`);
}

/** `sdlc events list [--json]`: `{ pending: [event bodies], receivers }`, oldest event first. */
export async function eventsListCommand(opts: { json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    const pending = dropStaleWaits(ctx.root, ctx.config, readOutbox(ctx.root))
      .map((queued) => queued.item.event);
    const receivers = receiverViews(ctx);
    if (opts.json) return printJson({ pending, receivers });
    printList(pending, receivers);
  } catch (error) {
    reportFailure(error, opts.json, { pending: [], receivers: [] });
  }
}

/** Records waiting and overdue gates of the active changes (B55), as status and next do. */
function recordWaits(ctx: ProjectContext): void {
  // As fresh as `sdlc next` (B88): one real worktree fingerprint for every change, not the fast mode.
  const fingerprint = sharedFingerprint(ctx.root);
  const views = listActiveChanges(ctx.paths).flatMap((ref): LifecycleView[] => {
    try {
      return [evaluateChange(ctx.root, ref, ctx.config, { fingerprint })];
    } catch {
      return [];
    }
  });
  recordAwaiting(ctx.root, ctx.config, views, ctx.stamp);
}

/** `sdlc events flush [--json]`: delivers now, 10 s per call, `{ delivered, failed }`; exit 0 either way. */
export async function eventsFlushCommand(opts: { json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    recordWaits(ctx);
    const result = await deliverPending(ctx.root, ctx.config, { callMs: FLUSH_CALL_MS });
    for (const receiver of receiverViews(ctx)) {
      if (receiver.missing.length) warn(`${receiver.missing.join(', ')} is unset`);
    }
    if (opts.json) return printJson(result);
    line(t('events.flushed', { delivered: result.delivered, failed: result.failed }));
  } catch (error) {
    reportFailure(error, opts.json, { delivered: 0, failed: 0 });
  }
}


/** `sdlc events summary [--since <date>] [--json]`: one `summary.daily` per project and day (B99). */
export async function eventsSummaryCommand(opts: { since?: string; json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    if (summaryAlreadySent(ctx.root)) {
      if (opts.json) return printJson({ sent: false, alreadySent: true });
      line(t('events.summary.alreadySent'));
      return;
    }
    const model = reportForSummary(ctx, opts.since);
    const summary = buildDailySummary(model);
    appendLog(ctx.root, ctx.config, { event: 'summary.daily', summary }, ctx.stamp);
    if (opts.json) return printJson({ sent: true, alreadySent: false, summary });
    const waiting = summary.waiting.map((item) => item.id).join(', ')
      || t('events.message.noneWaiting');
    line(t('events.summary.sent', {
      done: summary.done,
      active: summary.active,
      awaitingHuman: summary.awaitingHuman,
      blocked: summary.blocked,
      waiting,
    }));
  } catch (error) {
    reportFailure(error, opts.json, { sent: false, alreadySent: false });
  }
}
