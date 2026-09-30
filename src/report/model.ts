/**
 * Report model: one read-only snapshot of a project's SDLC progress, shared by
 * `sdlc report` (md, json, html) and `sdlc dashboard` (html). Everything here
 * is derived from what the CLI already computes (lifecycle views, change
 * metrics, the project log, the layout check); nothing new is stored.
 */
import type { ProjectContext } from '../cli/context.js';
import type { HarnessStamp } from '../core/license.js';
import type { LayoutReport } from '../core/layout.js';
import type { GateStatus, StageId } from '../core/lifecycle.js';
import type { LogEntry } from '../core/log.js';
import type { ChangeState } from '../core/change-state.js';
import type { ChangeRef } from '../core/changes.js';
import type { LifecycleView } from '../core/lifecycle.js';
import { SdlcError } from '../core/errors.js';
import * as path from 'node:path';
import { listActiveChanges, listArchivedChanges, resolveChange } from '../core/changes.js';
import { readChangeState } from '../core/change-state.js';
import { evaluateChange, sharedFingerprint, STAGES, STAGE_TITLES } from '../core/lifecycle.js';
import { aggregateMetrics, changeMetrics } from '../core/metrics.js';
import { readLog } from '../core/log.js';
import { detectLayout } from '../core/layout.js';
import { readText } from '../core/fs-utils.js';
import { readDeferred, type DeferredItem } from '../core/deferred.js';

export interface ReportOptions {
  /** ISO date (YYYY-MM-DD) or timestamp: events and "moved in period" start here. Unset = everything. */
  since?: string;
  /** Limit the report to one change (active or archived). */
  change?: string;
  /** Include archived changes (default true for reports: lead times need them). */
  archived?: boolean;
  /** Clock for tests. */
  now?: Date;
}

export interface ReportGate {
  id: string;
  status: GateStatus;
  required: boolean;
}

export interface ReportChange {
  id: string;
  archived: boolean;
  kind: string;
  risk: string;
  track: string;
  stage: StageId;
  stageTitle: string;
  gates: ReportGate[];
  tasks: { complete: number; total: number };
  verification: 'passed' | 'failed' | 'stale' | 'never';
  review?: { total: number; blockingOpen: number };
  next: { actor: 'human' | 'agent' | 'none'; message: string; cli?: string };
  warnings: string[];
  /** Hours from creation to archive (archived) or to now (active); undefined when unknown. */
  ageHours?: number;
  /** The change had at least one history event inside the period. */
  movedInPeriod: boolean;
}

export interface ReportModel {
  generatedAt: string;
  period: { since?: string; until: string };
  project: { name: string; root: string };
  harness: HarnessStamp;
  summary: {
    active: number;
    archived: number;
    /** Active changes per stage, every stage present (0 when empty), in lifecycle order. */
    byStage: Array<{ stage: StageId; title: string; count: number }>;
    /** Active changes whose next step belongs to a person (an approval, a decision). */
    awaitingHuman: number;
    /** Active changes with a gate `rejected`, a failed verification or blocking review findings. */
    blocked: number;
  };
  metrics: {
    medianLeadTimeHours: {
      intentToSpecApproval?: number;
      specToPlanApproval?: number;
      planToVerified?: number;
      verifiedToReviewApproval?: number;
      createdToArchived?: number;
    };
    verifyFirstPassRate?: number;
    rejections: number;
    waivers: number;
  };
  changes: ReportChange[];
  /** Project log entries inside the period, oldest first, at most 200 (newest kept). */
  events: LogEntry[];
  layout: LayoutReport;
  deferred: { open: number; items: DeferredItem[] };
}

function deferredWork(root: string): ReportModel['deferred'] {
  const items = readDeferred(root).filter((item) => item.status === 'open').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { open: items.length, items };
}

function parseSince(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  if (!iso.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new SdlcError('invalid_option', '--since must be a YYYY-MM-DD date or ISO timestamp.');
  }
  return new Date(value).toISOString();
}

function projectName(root: string): string {
  const content = readText(path.join(root, 'package.json'));
  if (!content) return path.basename(root);
  try {
    const pkg = JSON.parse(content) as { name?: string };
    return pkg.name || path.basename(root);
  } catch {
    return path.basename(root);
  }
}

function toReportChange(ref: ChangeRef, view: LifecycleView, state: ChangeState, since: string | undefined, now: Date): ReportChange {
  const ageHours = state.created
    ? Math.round((now.getTime() - Date.parse(state.created)) / 36e5 * 10) / 10
    : undefined;
  const next = { actor: view.next.actor, message: view.next.message, ...(view.next.cli ? { cli: view.next.cli } : {}) };
  return {
    id: ref.id,
    archived: ref.archived,
    kind: view.kind,
    risk: view.risk,
    track: view.track,
    stage: view.stage,
    stageTitle: view.stageTitle,
    gates: view.gates.map((gate) => ({ id: gate.id, status: gate.status, required: gate.required })),
    tasks: { complete: view.tasks.complete, total: view.tasks.total },
    verification: view.verification?.status ?? 'never',
    ...(view.review ? { review: { total: view.review.total, blockingOpen: view.review.blocking.length } } : {}),
    next,
    warnings: view.warnings,
    ...(ageHours !== undefined && Number.isFinite(ageHours) && ageHours >= 0 ? { ageHours } : {}),
    movedInPeriod: !since || state.history.some((event) => event.at >= since),
  };
}

function summarize(changes: ReportChange[]): ReportModel['summary'] {
  const active = changes.filter((change) => !change.archived);
  const blocked = (change: ReportChange) => change.gates.some((gate) => gate.status === 'rejected')
    || change.verification === 'failed'
    || (change.review?.blockingOpen ?? 0) > 0;
  return {
    active: active.length,
    archived: changes.length - active.length,
    byStage: STAGES.map((stage) => ({
      stage,
      title: STAGE_TITLES[stage],
      count: active.filter((change) => change.stage === stage).length,
    })),
    awaitingHuman: active.filter((change) => change.next.actor === 'human').length,
    blocked: active.filter(blocked).length,
  };
}

function periodEvents(root: string, since?: string, change?: string): LogEntry[] {
  return readLog(root)
    .filter((event) => (!since || event.ts >= since) && (!change || event.change === change))
    .sort((a, b) => a.ts.localeCompare(b.ts))
    .slice(-200);
}

/** Builds the model for a loaded project. Read-only. */
export function buildReport(ctx: ProjectContext, opts: ReportOptions = {}): ReportModel {
  const since = parseSince(opts.since);
  const now = opts.now ?? new Date();
  const active = listActiveChanges(ctx.paths);
  const archived = opts.archived === false ? [] : listArchivedChanges(ctx.paths);
  const refs = opts.change
    ? [resolveChange(ctx.paths, opts.change, { allowArchived: true })]
    : [...active, ...archived];
  const fingerprint = sharedFingerprint(ctx.root);
  const rows = refs.map((ref) => {
    const state = readChangeState(ref.dir);
    const view = evaluateChange(ctx.root, ref, ctx.config, { fingerprint });
    return {
      change: toReportChange(ref, view, state, since, now),
      metrics: changeMetrics(state),
    };
  });
  const changes = rows.map((row) => row.change);
  return {
    generatedAt: now.toISOString(),
    period: { ...(since ? { since } : {}), until: now.toISOString() },
    project: { name: projectName(ctx.root), root: ctx.root.replace(/\\/g, '/') },
    harness: ctx.stamp,
    summary: summarize(changes),
    metrics: aggregateMetrics(rows.map((row) => row.metrics)),
    changes,
    events: periodEvents(ctx.root, since, opts.change),
    layout: detectLayout(ctx.root, ctx.config.layout),
    deferred: deferredWork(ctx.root),
  };
}
