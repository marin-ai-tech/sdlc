import { changeLog } from '../awaiting.js';
import type { LogEntry } from '../log.js';
import { knownSource, readLoops, spentLoop } from '../loop-budget.js';
import type { MessageRef } from '../i18n.js';
import { countReviewRounds } from '../review-rounds.js';
import { summarizeVerifyRuns } from '../verify-runs.js';
import type { HealthContext } from './context.js';
import { recentHistory } from './context.js';
import type { FindingDraft } from './model.js';

/**
 * discipline.loop_budget: every active change whose budget is spent. The budget counts a change's whole life, as
 * `next` and `status` do, so the change is chosen from the active ones and counted on the full log, not from the
 * changes with history inside the health window (review rounds live in the log only; review of B224, F2).
 */
export function loopBudgetFinding(ctx: HealthContext): FindingDraft {
  const { budget } = readLoops(ctx.root);
  const facts: MessageRef[] = [];
  if (budget.reviewRounds === undefined && budget.verifyRuns === undefined) {
    return { id: 'discipline.loop_budget', area: 'discipline', level: 'warn', facts };
  }
  for (const info of ctx.active) {
    const change = info.ref.id;
    const spent = spentLoop(budget, ctx.log.filter((entry) => entry.change === change));
    if (!spent) continue;
    const params = { change, kind: spent.kind, count: spent.count, budget: spent.budget };
    facts.push({ key: 'health.fact.loopBudget', params });
  }
  return { id: 'discipline.loop_budget', area: 'discipline', level: 'warn', facts };
}

interface LoopRow {
  change: string;
  entries: LogEntry[];
}

/**
 * The changes with history or log entries inside the window, each with its log entries inside the window. Review
 * rounds are written to the log only, so the history alone would miss a change that only went through review.
 */
function windowLoopRows(ctx: HealthContext): LoopRow[] {
  const rows: LoopRow[] = [];
  for (const info of [...ctx.active, ...ctx.archived]) {
    const entries = changeLog(ctx.recent, info.ref.id);
    if (entries.length === 0 && recentHistory(ctx, info.state).length === 0) continue;
    rows.push({ change: info.ref.id, entries });
  }
  return rows;
}

/** quality.repeat_runs: finished full runs on one source fingerprint inside the window. */
export function repeatRunsFinding(ctx: HealthContext): FindingDraft {
  const { repeatRuns } = readLoops(ctx.root).thresholds;
  const facts: MessageRef[] = [];
  for (const row of windowLoopRows(ctx)) {
    for (const source of summarizeVerifyRuns(row.entries).bySource) {
      const count = source.passed + source.failed;
      if (!knownSource(source.fingerprint) || count < repeatRuns) continue;
      const fingerprint = source.fingerprint.replace(/^git-tree:/, '').slice(0, 12);
      const params = { change: row.change, fingerprint, count, passed: source.passed, failed: source.failed };
      facts.push({ key: 'health.fact.repeatRuns', params });
    }
  }
  return { id: 'quality.repeat_runs', area: 'quality', level: 'warn', facts };
}

/** quality.review_rounds: recorded review rounds of a change inside the window. */
export function reviewRoundsFinding(ctx: HealthContext): FindingDraft {
  const { roundWarn } = readLoops(ctx.root).thresholds;
  const facts: MessageRef[] = [];
  for (const row of windowLoopRows(ctx)) {
    const count = countReviewRounds(row.entries);
    if (count < roundWarn) continue;
    facts.push({ key: 'health.fact.reviewRounds', params: { change: row.change, count } });
  }
  return { id: 'quality.review_rounds', area: 'quality', level: 'warn', facts };
}
