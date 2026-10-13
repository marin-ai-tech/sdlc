import type { ProjectContext } from '../cli/context.js';
import { readLog } from '../core/log.js';
import { buildReport, parseSince, type ReportChange, type ReportModel } from '../report/model.js';
import { localDayOf, type EventSummary } from '../mcp/outbox.js';

/**
 * Daily summary payload for `summary.daily` (B99): counts from buildReport, done from period
 * events (same rule as assets/examples/daily-summary.mjs), waiting list from human next steps.
 */

/** Local calendar day YYYY-MM-DD: the same day the summary id uses. */
export const localDay = localDayOf;

/** Default --since: yesterday in the local calendar. */
export function defaultSinceDay(now = new Date()): string {
  const day = new Date(now.getTime());
  day.setDate(day.getDate() - 1);
  return localDay(day);
}

/** True when the project log already has summary.daily for today's local date. */
export function summaryAlreadySent(root: string, now = new Date()): boolean {
  const day = localDay(now);
  return readLog(root).some((entry) =>
    entry.event === 'summary.daily' && localDay(new Date(entry.ts)) === day);
}

function isDoneEvent(event: string): boolean {
  return /^gate\.\w+\.approved$/.test(event) || event === 'change.archived';
}

function waitingOf(change: ReportChange): EventSummary['waiting'][number] {
  const gate = change.page.deciders?.gate
    ?? change.gates.find((item) => item.status === 'pending')?.id
    ?? '';
  const fromNow = change.page.now.people;
  const people = fromNow.length > 0 ? fromNow : (change.page.deciders?.people ?? []);
  return {
    id: change.id,
    gate,
    waitingFor: people.map((person) => person.id),
  };
}

/** Counts from buildReport.summary; done from report.events; waiting from human next. */
export function buildDailySummary(model: ReportModel): EventSummary {
  const done = model.events.filter((event) => isDoneEvent(event.event)).length;
  const waiting = model.changes
    .filter((change) => !change.archived && change.next.actor === 'human')
    .map(waitingOf);
  const activeIds = model.changes.filter((change) => !change.archived).map((change) => change.id);
  return {
    done,
    active: model.summary.active,
    awaitingHuman: model.summary.awaitingHuman,
    blocked: model.summary.blocked,
    waiting,
    activeIds,
  };
}

/** Report for the summary period; `since` defaults to yesterday (local YYYY-MM-DD). */
export function reportForSummary(ctx: ProjectContext, since?: string): ReportModel {
  const sinceDay = since ?? defaultSinceDay();
  parseSince(sinceDay);
  return buildReport(ctx, { since: sinceDay });
}
