import * as path from 'node:path';
import type { ChangeState } from './change-state.js';
import type { SdlcConfig } from './config.js';
import { readConfigObject } from './config-read.js';
import { t } from './i18n.js';
import type { LifecycleView, NextAction } from './lifecycle.js';
import { readLog, type LogEntry } from './log.js';
import { openGateDeciders } from './named-approvers.js';
import { countReviewRounds } from './review-rounds.js';
import { summarizeVerifyRuns, type VerifyLogSummary } from './verify-runs.js';

export interface LoopBudget {
  reviewRounds?: number;
  verifyRuns?: number;
}

export interface Loops {
  budget: LoopBudget;
  split: { verifyMinutes?: number; comparableMin: number };
  thresholds: { repeatRuns: number; roundWarn: number };
  invalid: string[];
}

const LOOPS_KEYS = ['loops.review_rounds', 'loops.verify_runs', 'loops.repeat_runs', 'loops.round_warn',
  'loops.verify_minutes', 'loops.comparable_min'];

function defaultLoops(): Loops {
  return { budget: {}, split: { comparableMin: 3 }, thresholds: { repeatRuns: 3, roundWarn: 3 }, invalid: [] };
}

/** A key `loops:` knows, as `loops.<name>`: a bad value of it is not an unknown key. */
export function isLoopsKey(key: string): boolean {
  return LOOPS_KEYS.includes(key);
}

/** The smallest value a key takes: 1 for a budget, 2 for a detector threshold (1 would flag every change). */
export function loopsMinimum(key: string): number {
  return key === 'loops.repeat_runs' || key === 'loops.round_warn' ? 2 : 1;
}

/** Parse each key independently so a bad hand edit cannot disable a valid sibling. */
export function parseLoops(raw: Record<string, unknown>): Loops {
  const result = defaultLoops();
  if (!Object.hasOwn(raw, 'loops')) return result;
  const loops = raw.loops;
  if (!loops || typeof loops !== 'object' || Array.isArray(loops)) {
    result.invalid.push('loops');
    return result;
  }
  for (const [key, value] of Object.entries(loops)) {
    const minimum = loopsMinimum(`loops.${key}`);
    if (!LOOPS_KEYS.includes(`loops.${key}`)) {
      result.invalid.push(`loops.${key}`);
    } else if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
      result.invalid.push(`loops.${key}`);
    } else if (key === 'review_rounds') {
      result.budget.reviewRounds = value;
    } else if (key === 'verify_runs') {
      result.budget.verifyRuns = value;
    } else if (key === 'repeat_runs') {
      result.thresholds.repeatRuns = value;
    } else if (key === 'round_warn') {
      result.thresholds.roundWarn = value;
    } else if (key === 'verify_minutes') {
      result.split.verifyMinutes = value;
    } else if (key === 'comparable_min') {
      result.split.comparableMin = value;
    }
  }
  return result;
}

/** A damaged or unreadable document is diagnosed elsewhere; budget advice must stay available. */
export function readLoops(root: string): Loops {
  try {
    const raw = readConfigObject(path.join(root, 'openspec/sdlc.yaml'));
    return parseLoops(raw ?? {});
  } catch {
    return defaultLoops();
  }
}

/** A fingerprint that names a source: not empty and not the summary's `unknown` (review of B230, F1). */
export function knownSource(fingerprint: string): boolean {
  return fingerprint !== '' && fingerprint !== 'unknown';
}

export function verifyRepeats(summary: VerifyLogSummary): number {
  return summary.bySource.reduce((sum, source) => !knownSource(source.fingerprint)
    ? sum : sum + Math.max(0, source.passed + source.failed - 1), 0);
}

export interface SpentLoop {
  kind: 'review_rounds' | 'verify_runs';
  count: number;
  budget: number;
  repeats: number;
}

export function spentLoop(budget: LoopBudget, entries: LogEntry[]): SpentLoop | undefined {
  if (budget.reviewRounds === undefined && budget.verifyRuns === undefined) return undefined;
  const rounds = budget.reviewRounds === undefined ? 0 : countReviewRounds(entries);
  const runs = summarizeVerifyRuns(entries);
  const repeats = verifyRepeats(runs);
  if (budget.reviewRounds !== undefined && rounds >= budget.reviewRounds) {
    return { kind: 'review_rounds', count: rounds, budget: budget.reviewRounds, repeats };
  }
  const count = runs.finished + runs.unfinished;
  if (budget.verifyRuns !== undefined && count >= budget.verifyRuns) {
    return { kind: 'verify_runs', count, budget: budget.verifyRuns, repeats };
  }
  return undefined;
}

function spentForChange(root: string, change: string, budget: LoopBudget): SpentLoop | undefined {
  if (budget.reviewRounds === undefined && budget.verifyRuns === undefined) return undefined;
  try {
    return spentLoop(budget, readLog(root).filter((entry) => entry.change === change));
  } catch {
    return undefined;
  }
}

export function loopBudgetNext(root: string, config: SdlcConfig, view: LifecycleView,
  state: ChangeState, advice: NextAction, skipPeople = false): NextAction {
  if (view.archived || advice.actor !== 'agent') return advice;
  const spent = spentForChange(root, view.change, readLoops(root).budget);
  if (!spent) return advice;
  const people = skipPeople ? '' : (openGateDeciders(root, config, view, state)?.people ?? [])
    .map((person) => person.name).join(', ');
  const reason = `Extend the ${spent.kind} budget of ${view.change}`;
  const cli = `sdlc config propose --set loops.${spent.kind}=${spent.budget + 1} --reason "${reason}"`;
  const key = people ? 'next.loopBudgetPeople' : 'next.loopBudget';
  const params = { change: view.change, ...spent, ...(people ? { people } : {}), cli };
  return { actor: 'human', action: 'loop-budget', cli, key, params, message: t(key, params, 'en') };
}

/** Warnings are visible even when another person's step has precedence over this signal. */
export function loopBudgetWarnings(root: string, view: LifecycleView): string[] {
  const loops = readLoops(root);
  const warnings = loops.invalid.map((key) => t('loops.invalid', { key }));
  if (view.next.actor !== 'human' || view.next.action === 'loop-budget') return warnings;
  const spent = spentForChange(root, view.change, loops.budget);
  if (spent) warnings.push(t('loops.spent', { key: `loops.${spent.kind}`, count: spent.count,
    budget: spent.budget }));
  return warnings;
}
