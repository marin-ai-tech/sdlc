import type { SdlcConfig } from '../config.js';
import type { Locale } from '../i18n.js';
import type { ProjectPaths } from '../project.js';
import {
  contextStaleFinding, doctorFinding, enforcementFinding, noVerifyFinding, signingFinding, singlePersonFinding,
} from './config-findings.js';
import { loadHealthContext, type HealthContext, type HealthOptions } from './context.js';
import {
  denialsFinding, forcedArchiveFinding, liteBehaviourFinding, restaleFinding, testLockFinding, waiversFinding,
} from './discipline.js';
import { deferredFinding, overdueFinding, stalledFinding, waitFinding } from './flow.js';
import {
  countFindings, orderFindings, renderFinding, type Finding, type FindingDraft, type HealthCounts,
} from './model.js';
import {
  firstPassFinding, openFindingsFinding, planDriftFinding, reworkReasonFinding, traceFinding,
} from './quality.js';

/**
 * `sdlc health` (0.11.3, B65, B68): collects the findings of every area. A collector that fails is skipped, so
 * health never fails on the data it reads; only an invalid configuration fails, earlier, when it is loaded.
 * Nothing is written.
 */
export type { Finding, FindingDraft, HealthCounts } from './model.js';
export type { HealthOptions } from './context.js';

type Collector = (ctx: HealthContext) => FindingDraft;

/**
 * `cost`: `bad` collectors are cheap and are the only ones that can report a bad finding (the session start runs
 * only them, `badOnly`); `expensive` ones run git diffs, git log or subprocesses (`light` skips them).
 */
interface CollectorEntry {
  id: string;
  run: Collector;
  cost: 'bad' | 'normal' | 'expensive';
}

const COLLECTORS: CollectorEntry[] = [
  { id: 'flow.overdue', run: overdueFinding, cost: 'bad' },
  { id: 'flow.wait', run: waitFinding, cost: 'normal' },
  { id: 'flow.stalled', run: stalledFinding, cost: 'normal' },
  { id: 'flow.deferred', run: deferredFinding, cost: 'normal' },
  { id: 'quality.first_pass', run: firstPassFinding, cost: 'normal' },
  { id: 'quality.rework_reason', run: reworkReasonFinding, cost: 'normal' },
  { id: 'quality.open_findings', run: openFindingsFinding, cost: 'normal' },
  { id: 'quality.plan_drift', run: planDriftFinding, cost: 'expensive' },
  { id: 'quality.trace', run: traceFinding, cost: 'expensive' },
  { id: 'discipline.waivers', run: waiversFinding, cost: 'normal' },
  { id: 'discipline.lite_behaviour', run: liteBehaviourFinding, cost: 'normal' },
  { id: 'discipline.forced_archive', run: forcedArchiveFinding, cost: 'normal' },
  { id: 'discipline.restale', run: restaleFinding, cost: 'normal' },
  { id: 'discipline.denials', run: denialsFinding, cost: 'normal' },
  { id: 'discipline.test_lock', run: testLockFinding, cost: 'normal' },
  { id: 'config.no_verify', run: noVerifyFinding, cost: 'bad' },
  { id: 'config.enforcement', run: enforcementFinding, cost: 'bad' },
  { id: 'config.single_person', run: singlePersonFinding, cost: 'normal' },
  { id: 'config.signing', run: signingFinding, cost: 'normal' },
  { id: 'config.context_stale', run: contextStaleFinding, cost: 'normal' },
  { id: 'config.doctor', run: doctorFinding, cost: 'expensive' },
];

function selected(ctx: HealthContext): CollectorEntry[] {
  if (ctx.badOnly) return COLLECTORS.filter((entry) => entry.cost === 'bad');
  if (ctx.light) return COLLECTORS.filter((entry) => entry.cost !== 'expensive');
  return COLLECTORS;
}

/** One evaluation: the findings, and the ids that were looked at and did not fail. */
export interface HealthRun {
  drafts: FindingDraft[];
  evaluated: string[];
}

/**
 * Runs the selected collectors. A collector that fails is left out of `evaluated` as well as of the findings, so a
 * failure is never read as a finding that went away.
 */
export function runHealth(
  root: string, paths: ProjectPaths, config: SdlcConfig, options: HealthOptions = {},
): HealthRun {
  const ctx = loadHealthContext(root, paths, config, options);
  const drafts: FindingDraft[] = [];
  const evaluated: string[] = [];
  for (const entry of selected(ctx)) {
    try {
      drafts.push(entry.run(ctx));
      evaluated.push(entry.id);
    } catch {
      // Health never fails on the data it reads.
    }
  }
  return { drafts: orderFindings(drafts), evaluated };
}

/** Every finding with facts, ordered bad, warn, info, then by id. */
export function collectHealth(
  root: string, paths: ProjectPaths, config: SdlcConfig, options: HealthOptions = {},
): FindingDraft[] {
  return runHealth(root, paths, config, options).drafts;
}

export interface HealthReport {
  findings: Finding[];
  counts: HealthCounts;
}

/** The findings rendered in a locale, with their counts per level. */
export function healthReport(drafts: FindingDraft[], locale: Locale): HealthReport {
  const findings = drafts.map((draft) => renderFinding(draft, locale));
  return { findings, counts: countFindings(findings) };
}
