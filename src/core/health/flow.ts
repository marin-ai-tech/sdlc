import { awaitedGate, type AwaitedGate } from '../awaiting.js';
import { readDeferred } from '../deferred.js';
import type { MessageRef } from '../i18n.js';
import type { LogEntry } from '../log.js';
import { daysSince, hoursSince, HOUR_MS, windowMetrics, type HealthContext } from './context.js';
import type { FindingDraft } from './model.js';

/** Flow findings: gates that wait for people, changes that stand still, deferred work nobody revisits. */

function waiting(ctx: HealthContext): AwaitedGate[] {
  const out: AwaitedGate[] = [];
  for (const info of ctx.active) {
    const gate = info.view ? awaitedGate(info.view) : undefined;
    if (gate) out.push(gate);
  }
  return out;
}

function sameWait(entry: LogEntry, event: string, wait: AwaitedGate): boolean {
  return entry.event === event && entry.change === wait.change && entry.detail === wait.digest;
}

function firstAwaiting(ctx: HealthContext, wait: AwaitedGate): LogEntry | undefined {
  return ctx.log.find((entry) => sameWait(entry, `gate.${wait.gate}.awaiting`, wait));
}

/** flow.overdue: the log has `gate.<g>.overdue` for the digest the gate still waits on. */
export function overdueFinding(ctx: HealthContext): FindingDraft {
  const facts: MessageRef[] = [];
  for (const wait of waiting(ctx)) {
    const overdue = ctx.log.find((entry) => sameWait(entry, `gate.${wait.gate}.overdue`, wait));
    if (!overdue) continue;
    const listed = Array.isArray(overdue.waitingFor) ? overdue.waitingFor : wait.people ?? [];
    const people = listed.join(', ') || '-';
    const hours = hoursSince(ctx, firstAwaiting(ctx, wait)?.ts) ?? '-';
    facts.push({ key: 'health.fact.overdue', params: { change: wait.change, gate: wait.gate, hours, people } });
  }
  return { id: 'flow.overdue', area: 'flow', level: 'bad', facts };
}

function stillWaiting(ctx: HealthContext): MessageRef[] {
  const facts: MessageRef[] = [];
  for (const wait of waiting(ctx)) {
    const hours = hoursSince(ctx, firstAwaiting(ctx, wait)?.ts);
    if (hours === undefined || hours <= ctx.thresholds.waitHours) continue;
    facts.push({ key: 'health.fact.waiting', params: { change: wait.change, gate: wait.gate, hours } });
  }
  return facts;
}

function pastWaits(ctx: HealthContext): MessageRef[] {
  const facts: MessageRef[] = [];
  for (const row of windowMetrics(ctx)) {
    for (const [gate, wait] of Object.entries(row.metrics.waits)) {
      const hours = Math.round(wait.seconds / 3600 * 10) / 10;
      if (wait.seconds * 1000 <= ctx.thresholds.waitHours * HOUR_MS) continue;
      facts.push({ key: 'health.fact.waited', params: { change: row.info.ref.id, gate, hours } });
    }
  }
  return facts;
}

/** flow.wait: a gate waited for a person longer than `wait_hours`, until approved or still. */
export function waitFinding(ctx: HealthContext): FindingDraft {
  const facts = [...pastWaits(ctx), ...stillWaiting(ctx)];
  const params = { hours: ctx.thresholds.waitHours };
  return { id: 'flow.wait', area: 'flow', level: 'warn', params, facts };
}

/** flow.stalled: an active change with no history event for `stalled_days`. */
export function stalledFinding(ctx: HealthContext): FindingDraft {
  const facts: MessageRef[] = [];
  for (const info of ctx.active) {
    const last = info.state.history.at(-1);
    const days = daysSince(ctx, last?.at ?? info.state.created);
    if (days === undefined || days < ctx.thresholds.stalledDays) continue;
    const event = last?.event ?? 'change.created';
    facts.push({ key: 'health.fact.stalled', params: { change: info.ref.id, days, event } });
  }
  return { id: 'flow.stalled', area: 'flow', level: 'warn', params: { days: ctx.thresholds.stalledDays }, facts };
}

function createdDate(created: string | undefined): string | undefined {
  return /^\s*(\d{4}-\d{2}-\d{2})/.exec(created ?? '')?.[1];
}

/** flow.deferred: an open deferred item older than `deferred_days`. */
export function deferredFinding(ctx: HealthContext): FindingDraft {
  const facts: MessageRef[] = [];
  for (const item of readDeferred(ctx.root).filter((entry) => entry.status === 'open')) {
    const date = createdDate(item.created);
    const days = date ? daysSince(ctx, `${date}T00:00:00Z`) : undefined;
    if (days === undefined || days < ctx.thresholds.deferredDays) continue;
    facts.push({ key: 'health.fact.deferred', params: { id: item.id, title: item.title, days } });
  }
  return { id: 'flow.deferred', area: 'flow', level: 'warn', params: { days: ctx.thresholds.deferredDays }, facts };
}
