import type { ChangeState, HistoryEvent } from './change-state.js';
import { AWAITING_EVENT } from './awaiting.js';
import { AUTO_WAIVED_EVENT } from './auto-waive.js';
import type { LogEntry } from './log.js';
import { defaultConfig, type SdlcConfig } from './config.js';
import { participationOf, sumParticipation, type Participation, type ParticipationTotals } from './participation.js';

interface Milestones {
  created?: string;
  intent?: string;
  spec?: string;
  plan?: string;
  verified?: string;
  review?: string;
  release?: string;
  archived?: string;
}

export interface ChangeMetrics {
  milestones: Milestones;
  leadTimeHours: {
    intentToSpecApproval?: number;
    specToPlanApproval?: number;
    planToVerified?: number;
    verifiedToReviewApproval?: number;
    createdToArchived?: number;
  };
  verifyRuns: number;
  verifyFirstPass?: boolean;
  rejections: number;
  waivers: number;
  /** Gates an auto_waive policy waived (B59; `gate.<g>.auto_waived` in the project log), apart from people's. */
  policyWaivers: number;
  /** Per approval gate: seconds from the first `awaiting` with the approved digest to the latest approval. */
  waits: Record<string, { seconds: number }>;
  /** Every rework (`gate.<g>.rework`) with its reason category, oldest first. */
  reworks: Array<{ gate: string; reason: string; at: string }>;
  /** How many times each gate was approved. */
  approvals: Record<string, number>;
  /** Verify runs up to and including the first pass; undefined while none passed. */
  verifyAttemptsToPass?: number;
  /** People's decisions the track plans against what happened (B63). */
  participation: Participation;
}

export interface FlowAggregate {
  medianWaitSeconds: Record<string, number>;
  reworkReasons: Array<{ reason: string; count: number }>;
}

function milestones(history: HistoryEvent[], created: string): Milestones {
  const last = (event: string) => [...history].reverse().find((h) => h.event === event)?.at;
  const firstAfter = (event: string, after?: string) =>
    history.find((h) => h.event === event && (!after || h.at >= after))?.at;
  const plan = last('gate.plan.approved');
  return {
    created: created || firstAfter('change.created'),
    intent: last('gate.intent.approved'),
    spec: last('gate.spec.approved'),
    plan,
    verified: firstAfter('verify.passed', plan),
    review: last('gate.review.approved'),
    release: last('gate.release.approved'),
    archived: last('change.archived') ?? last('change.archived.forced'),
  };
}

function hours(from?: string, to?: string): number | undefined {
  if (!from || !to) return undefined;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 36e5 * 10) / 10 : undefined;
}

/** The first `gate.<g>.awaiting` of a digest, at or before the moment it was approved. */
function firstAwaiting(log: LogEntry[], gate: string, digest: string, until: string): string | undefined {
  const waits = log.filter((e) => AWAITING_EVENT.exec(e.event)?.[1] === gate && e.detail === digest);
  return waits.map((e) => e.ts).filter((ts) => ts && ts <= until).sort()[0];
}

function waitsOf(state: ChangeState, log: LogEntry[]): ChangeMetrics['waits'] {
  const out: ChangeMetrics['waits'] = {};
  for (const [gate, record] of Object.entries(state.gates)) {
    const approval = [...(record?.approvals ?? [])].sort((a, b) => a.at.localeCompare(b.at)).at(-1);
    if (!approval?.digest) continue;
    const since = firstAwaiting(log, gate, approval.digest, approval.at);
    const ms = since ? Date.parse(approval.at) - Date.parse(since) : NaN;
    if (Number.isFinite(ms) && ms >= 0) out[gate] = { seconds: Math.round(ms / 1000) };
  }
  return out;
}

function reworksOf(history: HistoryEvent[]): ChangeMetrics['reworks'] {
  return history.flatMap((h) => {
    const gate = /^gate\.(\w+)\.rework$/.exec(h.event)?.[1];
    if (!gate) return [];
    const reason = /^([^:]+):/.exec(h.detail ?? '')?.[1]?.trim() ?? (h.detail ?? '').trim();
    return [{ gate, reason, at: h.at }];
  });
}

function approvalsOf(history: HistoryEvent[]): ChangeMetrics['approvals'] {
  const out: ChangeMetrics['approvals'] = {};
  for (const h of history) {
    const gate = /^gate\.(\w+)\.approved$/.exec(h.event)?.[1];
    if (gate) out[gate] = (out[gate] ?? 0) + 1;
  }
  return out;
}

function attemptsToPass(runs: HistoryEvent[]): number | undefined {
  const index = runs.findIndex((h) => h.event === 'verify.passed');
  return index < 0 ? undefined : index + 1;
}

/**
 * Metrics of one change; `log` holds its project-log entries, where the waits for a person are recorded, and
 * `config` the gates the participation plan is read from.
 */
export function changeMetrics(state: ChangeState, log: LogEntry[] = [], config?: SdlcConfig): ChangeMetrics {
  const m = milestones(state.history, state.created);
  const verifyRuns = state.history.filter((h) => h.event.startsWith('verify.'));
  const firstRun = verifyRuns[0]?.event;
  const waits = waitsOf(state, log);
  return {
    milestones: m,
    leadTimeHours: {
      intentToSpecApproval: hours(m.intent, m.spec),
      specToPlanApproval: hours(m.spec, m.plan),
      planToVerified: hours(m.plan, m.verified),
      verifiedToReviewApproval: hours(m.verified, m.review),
      createdToArchived: hours(m.created, m.archived),
    },
    verifyRuns: verifyRuns.length,
    verifyFirstPass: firstRun === undefined ? undefined : firstRun === 'verify.passed',
    rejections: state.history.filter((h) => /^gate\.\w+\.rejected$/.test(h.event)).length,
    waivers: state.history.filter((h) => /^gate\.\w+\.waived$/.test(h.event)).length,
    policyWaivers: log.filter((e) => AUTO_WAIVED_EVENT.test(e.event)).length,
    waits,
    reworks: reworksOf(state.history),
    approvals: approvalsOf(state.history),
    verifyAttemptsToPass: attemptsToPass(verifyRuns),
    participation: participationOf(config ?? defaultConfig(), state, log, waits),
  };
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 10) / 10;
}

function medianWaits(rows: ChangeMetrics[]): FlowAggregate['medianWaitSeconds'] {
  const byGate = new Map<string, number[]>();
  for (const row of rows) {
    for (const [gate, wait] of Object.entries(row.waits ?? {})) {
      byGate.set(gate, [...(byGate.get(gate) ?? []), wait.seconds]);
    }
  }
  const out: FlowAggregate['medianWaitSeconds'] = {};
  for (const [gate, values] of byGate) out[gate] = median(values)!;
  return out;
}

function reworkReasons(rows: ChangeMetrics[]): FlowAggregate['reworkReasons'] {
  const counts = new Map<string, number>();
  for (const rework of rows.flatMap((row) => row.reworks ?? [])) {
    counts.set(rework.reason, (counts.get(rework.reason) ?? 0) + 1);
  }
  const out = [...counts].map(([reason, count]) => ({ reason, count }));
  return out.sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export function aggregateMetrics(rows: ChangeMetrics[]): FlowAggregate & {
  medianLeadTimeHours: ChangeMetrics['leadTimeHours'];
  verifyFirstPassRate?: number;
  rejections: number;
  waivers: number;
  policyWaivers: number;
  participation: ParticipationTotals;
} {
  const pick = (key: keyof ChangeMetrics['leadTimeHours']) =>
    median(rows.map((row) => row.leadTimeHours[key]).filter((value): value is number => value !== undefined));
  const firstPass = rows.filter((row) => row.verifyFirstPass !== undefined);
  return {
    medianLeadTimeHours: {
      intentToSpecApproval: pick('intentToSpecApproval'),
      specToPlanApproval: pick('specToPlanApproval'),
      planToVerified: pick('planToVerified'),
      verifiedToReviewApproval: pick('verifiedToReviewApproval'),
      createdToArchived: pick('createdToArchived'),
    },
    verifyFirstPassRate: firstPass.length > 0
      ? Math.round(firstPass.filter((row) => row.verifyFirstPass).length / firstPass.length * 100) / 100
      : undefined,
    rejections: rows.reduce((total, row) => total + row.rejections, 0),
    waivers: rows.reduce((total, row) => total + row.waivers, 0),
    policyWaivers: rows.reduce((total, row) => total + (row.policyWaivers ?? 0), 0),
    medianWaitSeconds: medianWaits(rows),
    reworkReasons: reworkReasons(rows),
    participation: sumParticipation(rows.map((row) => row.participation)),
  };
}
