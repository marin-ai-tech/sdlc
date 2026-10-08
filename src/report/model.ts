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
import { agentCommits, type AgentCommits } from '../core/agent-commits.js';
import type { Participation, ParticipationTotals } from '../core/participation.js';
import { changeLog } from '../core/awaiting.js';
import { readLog } from '../core/log.js';
import { detectLayout } from '../core/layout.js';
import { readText } from '../core/fs-utils.js';
import { readDeferred, type DeferredItem } from '../core/deferred.js';
import { epicProgress, readBacklog, type BacklogItem } from '../core/backlog.js';
import { buildChangePage, type ChangePage } from './change-page.js';
import { collectHealth, healthReport, type FindingDraft, type HealthReport } from '../core/health/index.js';

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
  /** People's decisions the track plans against what happened (B63). */
  participation: Participation;
  /** The dashboard page of the change: timeline, waits, reworks, trace gaps, who acts now. */
  page: ChangePage;
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
    /** Planned and actual participation of people, summed over the changes (B63). */
    participation?: ParticipationTotals;
    /** Commits reachable from HEAD in the period and those made in agent sessions (B24). */
    agentCommits?: AgentCommits;
  };
  changes: ReportChange[];
  /** Project log entries inside the period, oldest first, at most 200 (newest kept). */
  events: LogEntry[];
  layout: LayoutReport;
  deferred: { open: number; items: DeferredItem[] };
  /**
   * Project health (B67), light evaluation: the findings in English, and their drafts (catalog references) so the
   * HTML page renders them in the reader's language. `sdlc health` has every finding.
   */
  health: HealthReport & { drafts: FindingDraft[] };
  backlog: {
    counts: { open: number; 'in-progress': number; done: number; dropped: number };
    epics: Array<{ id: string; title: string; goal?: string; total: number; open: number; inProgress: number; done: number; dropped: number }>;
    /** Up to 5 open ready items in priority order. */
    next: BacklogItem[];
    /** Open items whose blockedBy is not empty. */
    blocked: BacklogItem[];
  };
}

function deferredWork(root: string): ReportModel['deferred'] {
  const items = readDeferred(root).filter((item) => item.status === 'open').sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  return { open: items.length, items };
}

function backlogWork(root: string): ReportModel['backlog'] {
  const backlog = readBacklog(root);
  const counts = {
    open: backlog.items.filter((item) => item.status === 'open').length,
    'in-progress': backlog.items.filter((item) => item.status === 'in-progress').length,
    done: backlog.items.filter((item) => item.status === 'done').length,
    dropped: backlog.items.filter((item) => item.status === 'dropped').length,
  };
  const epics = epicProgress(backlog).map(({ epic, total, open, inProgress, done, dropped }) => ({
    id: epic.id,
    title: epic.title,
    ...(epic.goal ? { goal: epic.goal } : {}),
    total,
    open,
    inProgress,
    done,
    dropped,
  }));
  const next = backlog.items.filter((item) => item.ready).slice(0, 5);
  const blocked = backlog.items.filter((item) => item.status === 'open' && item.blockedBy.length > 0);
  return { counts, epics, next, blocked };
}

export function parseSince(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/;
  if (!iso.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new SdlcError('invalid_option', { key: 'error.since_must_be_a_yyyy_mm_dd_date_or_iso_timestamp' });
  }
  return new Date(value).toISOString();
}

export function projectName(root: string): string {
  const content = readText(path.join(root, 'package.json'));
  if (!content) return path.basename(root);
  try {
    const pkg = JSON.parse(content) as { name?: string };
    return pkg.name || path.basename(root);
  } catch {
    return path.basename(root);
  }
}

function toReportChange(ref: ChangeRef, view: LifecycleView, state: ChangeState, since: string | undefined, now: Date,
  page: ChangePage): ReportChange {
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
    participation: page.participation,
    page,
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

function projectHealth(ctx: ProjectContext): ReportModel['health'] {
  const drafts = collectHealth(ctx.root, ctx.paths, ctx.config, { light: true });
  return { ...healthReport(drafts, 'en'), drafts };
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
  const log = readLog(ctx.root);
  const rows = refs.map((ref) => {
    const state = readChangeState(ref.dir);
    const view = evaluateChange(ctx.root, ref, ctx.config, { fingerprint });
    const metrics = changeMetrics(state, changeLog(log, ref.id), ctx.config);
    const page = buildChangePage({ root: ctx.root, config: ctx.config, ref, state, view, metrics });
    return {
      change: toReportChange(ref, view, state, since, now, page),
      metrics,
    };
  });
  const changes = rows.map((row) => row.change);
  return {
    generatedAt: now.toISOString(),
    period: { ...(since ? { since } : {}), until: now.toISOString() },
    project: { name: projectName(ctx.root), root: ctx.root.replace(/\\/g, '/') },
    harness: ctx.stamp,
    summary: summarize(changes),
    metrics: { ...aggregateMetrics(rows.map((row) => row.metrics)), agentCommits: agentCommits(ctx.root, since) },
    changes,
    events: periodEvents(ctx.root, since, opts.change),
    layout: detectLayout(ctx.root, ctx.config.layout),
    deferred: deferredWork(ctx.root),
    backlog: backlogWork(ctx.root),
    health: projectHealth(ctx),
  };
}
