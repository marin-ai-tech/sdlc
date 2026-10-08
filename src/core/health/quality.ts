import * as path from 'node:path';
import { readText } from '../fs-utils.js';
import { defaultBaseRef } from '../git.js';
import type { MessageRef } from '../i18n.js';
import { aggregateMetrics } from '../metrics.js';
import { computePlanDrift } from '../plan-drift.js';
import { parseFindings, summarizeFindings } from '../review.js';
import { buildTrace } from '../trace.js';
import { readManifest } from '../../integrations/manifest.js';
import { windowMetrics, type ChangeInfo, type HealthContext } from './context.js';
import type { FindingDraft } from './model.js';

/** Quality findings: verify first-pass rate, why work comes back, drift from the plan, open findings, trace gaps. */

const MIN_CHANGES = 3;
const MIN_REWORKS = 3;

function percent(share: number): number {
  return Math.round(share * 100);
}

/** quality.first_pass: the verify first-pass rate is below `first_pass_rate`, over 3 or more changes. */
export function firstPassFinding(ctx: HealthContext): FindingDraft {
  const rows = windowMetrics(ctx).map((row) => row.metrics);
  const ran = rows.filter((row) => row.verifyFirstPass !== undefined);
  const rate = aggregateMetrics(rows).verifyFirstPassRate;
  const params = { rate: percent(rate ?? 0), threshold: percent(ctx.thresholds.firstPassRate) };
  const facts: MessageRef[] = [];
  if (ran.length >= MIN_CHANGES && rate !== undefined && rate < ctx.thresholds.firstPassRate) {
    const passed = ran.filter((row) => row.verifyFirstPass).length;
    facts.push({ key: 'health.fact.firstPass', params: { passed, total: ran.length, rate: params.rate } });
  }
  return { id: 'quality.first_pass', area: 'quality', level: 'warn', params, facts };
}

const KNOWN_REASONS = [
  'missing-requirement', 'wrong-assumption', 'design-flaw', 'implementation-bug', 'test-gap', 'scope-change',
];

function reasonAdvice(reason: string): MessageRef {
  const known = KNOWN_REASONS.includes(reason) ? reason : 'other';
  return { key: `health.quality.rework_reason.recommendation.${known}` };
}

/** quality.rework_reason: one reason is `rework_share` or more of 3 or more reworks. */
export function reworkReasonFinding(ctx: HealthContext): FindingDraft {
  const reasons = aggregateMetrics(windowMetrics(ctx).map((row) => row.metrics)).reworkReasons;
  const total = reasons.reduce((sum, entry) => sum + entry.count, 0);
  const top = reasons[0];
  const base = { id: 'quality.rework_reason', area: 'quality', level: 'warn' } as const;
  if (!top || total < MIN_REWORKS || top.count / total < ctx.thresholds.reworkShare) return { ...base, facts: [] };
  const params = { reason: top.reason, count: top.count, total, share: percent(top.count / total) };
  const facts = reasons.map((entry) => ({
    key: 'health.fact.reworkReason', params: { reason: entry.reason, count: entry.count, total },
  }));
  return { ...base, params, facts, recommendation: reasonAdvice(top.reason) };
}

function approvedPlan(info: ChangeInfo): boolean {
  return (info.state.gates.plan?.approvals?.length ?? 0) > 0;
}

/** quality.plan_drift: an active change with an approved plan has unplanned or untouched files. */
export function planDriftFinding(ctx: HealthContext): FindingDraft {
  const base = ctx.config.review.base ?? defaultBaseRef(ctx.root);
  const ignore = Object.keys(readManifest(ctx.root).files);
  const facts: MessageRef[] = [];
  for (const info of ctx.active.filter(approvedPlan)) {
    const drift = computePlanDrift(ctx.root, info.ref.dir, base, ignore);
    if (drift.unplanned.length === 0 && drift.untouched.length === 0) continue;
    const params = { change: info.ref.id, unplanned: drift.unplanned.length, untouched: drift.untouched.length };
    facts.push({ key: 'health.fact.planDrift', params });
  }
  return { id: 'quality.plan_drift', area: 'quality', level: 'info', facts };
}

/** quality.open_findings: an active change has open review findings of a blocking severity. */
export function openFindingsFinding(ctx: HealthContext): FindingDraft {
  const facts: MessageRef[] = [];
  for (const info of ctx.active) {
    const text = readText(path.join(info.ref.dir, 'review.md'));
    if (text === undefined) continue;
    const blocking = summarizeFindings(parseFindings(text), ctx.config.review.blockOn).blocking;
    if (blocking.length === 0) continue;
    const ids = blocking.map((finding) => finding.id ?? finding.title).join(', ');
    facts.push({ key: 'health.fact.openFindings', params: { change: info.ref.id, count: blocking.length, ids } });
  }
  return { id: 'quality.open_findings', area: 'quality', level: 'warn', facts };
}

/** quality.trace: verify passed, but spec scenarios have no row in the behavioral verification table. */
export function traceFinding(ctx: HealthContext): FindingDraft {
  const facts: MessageRef[] = [];
  for (const info of ctx.active.filter((entry) => entry.state.verify?.status === 'passed')) {
    const gaps = buildTrace(ctx.root, info.ref).gaps.filter((gap) => gap.kind === 'scenario-without-evidence');
    if (gaps.length === 0) continue;
    const scenarios = gaps.map((gap) => gap.ref).join('; ');
    facts.push({ key: 'health.fact.trace', params: { change: info.ref.id, count: gaps.length, scenarios } });
  }
  return { id: 'quality.trace', area: 'quality', level: 'warn', facts };
}
