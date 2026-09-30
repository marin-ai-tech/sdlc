import type { ChangeState, HistoryEvent } from './change-state.js';

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

export function changeMetrics(state: ChangeState): ChangeMetrics {
  const m = milestones(state.history, state.created);
  const verifyRuns = state.history.filter((h) => h.event.startsWith('verify.'));
  const firstRun = verifyRuns[0]?.event;
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
  };
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2 * 10) / 10;
}

export function aggregateMetrics(rows: ChangeMetrics[]): {
  medianLeadTimeHours: ChangeMetrics['leadTimeHours'];
  verifyFirstPassRate?: number;
  rejections: number;
  waivers: number;
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
  };
}
