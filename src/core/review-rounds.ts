import { createHash } from 'node:crypto';
import type { SdlcConfig } from './config.js';
import { worktreeFingerprint } from './git.js';
import { FINGERPRINT_EXCLUDES } from './lifecycle.js';
import { appendLog, readLog, type LogEntry } from './log.js';
import type { FindingSummary } from './review.js';

export interface ReviewRoundFacts {
  n: number;
  fingerprint?: string;
  review: string;
  counts: {
    total: number;
    open: number;
    blocking: number;
    open_by_severity: Record<string, number>;
  };
}

/** The identity of a round fact: its source and its review, not its number, which merged branches can repeat. */
export function roundKey(round: Pick<ReviewRoundFacts, 'fingerprint' | 'review'>): string {
  return JSON.stringify([round.fingerprint ?? null, round.review]);
}

/** Count distinct facts, since merged logs can contain the same round more than once. */
export function countReviewRounds(entries: LogEntry[]): number {
  const keys = entries
    .filter((entry) => entry.event === 'review.round' && entry.round)
    .map((entry) => roundKey(entry.round!));
  return new Set(keys).size;
}

function roundCounts(summary: FindingSummary, blockOn: string[]): ReviewRoundFacts['counts'] {
  const known = new Set(['important', 'nit', 'pre-existing', ...blockOn.map((severity) => severity.toLowerCase())]);
  const open_by_severity: Record<string, number> = {};
  for (const [severity, counts] of Object.entries(summary.bySeverity)) {
    if (counts.open === 0) continue;
    const key = known.has(severity) ? severity : 'other';
    open_by_severity[key] = (open_by_severity[key] ?? 0) + counts.open;
  }
  return { total: summary.total, open: summary.open, blocking: summary.blocking.length, open_by_severity };
}

/** Record only a new source and normalized review pair; no finding text enters the log. */
export function recordReviewRound(
  root: string, config: SdlcConfig, change: string, content: string, summary: FindingSummary,
): void {
  const review = createHash('sha256').update(content.replace(/\r\n?|\n/g, '\n')).digest('hex');
  const fingerprint = worktreeFingerprint(root, FINGERPRINT_EXCLUDES);
  const previous = readLog(root).filter((entry) => entry.event === 'review.round' && entry.change === change);
  const key = roundKey({ fingerprint, review });
  if (previous.some((entry) => entry.round && roundKey(entry.round) === key)) return;
  const round: ReviewRoundFacts = {
    n: countReviewRounds(previous) + 1,
    ...(fingerprint ? { fingerprint } : {}),
    review,
    counts: roundCounts(summary, config.review.blockOn),
  };
  appendLog(root, config, { event: 'review.round', change, round });
}
