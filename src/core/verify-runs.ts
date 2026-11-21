import type { SdlcConfig } from './config.js';
import type { LogEntry } from './log.js';
import type { VerificationRun } from './verify.js';

export type VerifyTrigger = 'first' | 'repeat' | 'after_review' | 'after_rework' | 'changed' | 'reuse';

/** Log facts deliberately exclude commands, answers, output, and file paths. */
export interface VerifyRunFacts {
  id: string;
  started_at: string;
  finished_at?: string;
  duration_ms?: number;
  fingerprint?: string;
  commit?: string;
  trigger?: VerifyTrigger;
  /** Set when the run is another change's passing run recorded instead of run (B183). */
  reused_from?: { change: string; run_id: string };
  partial?: boolean;
  checks?: Array<{ name: string; duration_ms: number; exit_code: number | null; timed_out: boolean }>;
  mcp?: Array<{ name: string; ok: boolean; duration_ms: number; provider_ms?: number }>;
}

export interface VerifySourceSummary {
  fingerprint: string;
  runs: number;
  passed: number;
  failed: number;
  unfinished: number;
  minutes: number;
  longestPassedStreak: number;
}

export interface VerifyLogSummary {
  finished: number;
  passed: number;
  failed: number;
  unfinished: number;
  partial: number;
  minutes: number;
  bySource: VerifySourceSummary[];
}

export function verifyTrigger(entries: LogEntry[], startedAt: string, fingerprint?: string): VerifyTrigger {
  const earlier = entries.filter((entry) => entry.ts <= startedAt);
  // A reused record is no run (B183): the first real run after it is `first`, not a repeat.
  const finished = earlier.filter((entry) => /^verify\.(passed|failed)$/.test(entry.event)
    && entry.run?.trigger !== 'reuse');
  const previous = finished.sort((a, b) => b.ts.localeCompare(a.ts))[0];
  if (!previous) return 'first';
  if (fingerprint && previous.run?.fingerprint === fingerprint) return 'repeat';
  const between = earlier.filter((entry) => entry.ts > previous.ts);
  if (between.some((entry) => entry.event === 'review.round')) return 'after_review';
  if (between.some((entry) => /^gate\.[^.]+\.rework$/.test(entry.event))) return 'after_rework';
  return 'changed';
}

/** A run is partial when `--only` left out a configured command or MCP check (the verify gate's own rule). */
export function skipsChecks(config: Pick<SdlcConfig, 'verify'>, only: string[] | undefined): boolean {
  if (!only || only.length === 0) return false;
  const names = [...config.verify.commands, ...(config.verify.mcp ?? [])].map((check) => check.name);
  return names.some((name) => !only.includes(name));
}

export function finishedRunFacts(run: VerificationRun, trigger: VerifyTrigger, partial: boolean): VerifyRunFacts {
  return {
    id: run.id,
    started_at: run.started_at,
    finished_at: run.at,
    duration_ms: Math.max(0, Date.parse(run.at) - Date.parse(run.started_at)),
    ...(run.fingerprint ? { fingerprint: run.fingerprint } : {}),
    ...(run.commit ? { commit: run.commit } : {}),
    trigger,
    partial,
    checks: run.checks.map((check) => ({
      name: check.name, duration_ms: check.duration_ms,
      exit_code: check.exit_code, timed_out: check.timed_out === true,
    })),
    mcp: (run.mcp ?? []).map((check) => ({
      name: check.name, ok: check.ok, duration_ms: check.duration_ms,
      ...(check.provider_ms === undefined ? {} : { provider_ms: check.provider_ms }),
    })),
  };
}

function emptySource(fingerprint: string): VerifySourceSummary {
  return { fingerprint, runs: 0, passed: 0, failed: 0, unfinished: 0,
    minutes: 0, longestPassedStreak: 0 };
}

/** Pair start and finish by id; older finishes stand alone as completed runs. */
export function summarizeVerifyRuns(entries: LogEntry[]): VerifyLogSummary {
  const summary: VerifyLogSummary = { finished: 0, passed: 0, failed: 0, unfinished: 0,
    partial: 0, minutes: 0, bySource: [] };
  const ordered = [...entries].sort((a, b) => a.ts.localeCompare(b.ts));
  const starts = new Map<string, LogEntry>();
  const sources = new Map<string, VerifySourceSummary>();
  const streaks = new Map<string, number>();
  for (const entry of ordered) {
    if (entry.event === 'verify.started' && entry.run?.id) starts.set(entry.run.id, entry);
  }
  const finishedIds = new Set<string>();
  for (const entry of ordered) {
    if (!/^verify\.(passed|failed)$/.test(entry.event)) continue;
    // A reused record is no run: no count, no minutes, no streak.
    if (entry.run?.trigger === 'reuse') continue;
    const id = entry.run?.id;
    // The same finish twice (a re-applied or cherry-picked log line) is one run; old entries have no id.
    if (id && finishedIds.has(id)) continue;
    if (id) finishedIds.add(id);
    const fingerprint = entry.run?.fingerprint ?? starts.get(id ?? '')?.run?.fingerprint ?? 'unknown';
    const source = sources.get(fingerprint) ?? emptySource(fingerprint);
    sources.set(fingerprint, source);
    source.runs += 1;
    const minutes = (entry.run?.duration_ms ?? 0) / 60000;
    source.minutes += minutes;
    summary.minutes += minutes;
    if (entry.run?.partial) {
      summary.partial += 1;
      streaks.set(fingerprint, 0);
      continue;
    }
    summary.finished += 1;
    if (entry.event === 'verify.passed') {
      summary.passed += 1;
      source.passed += 1;
      const streak = (streaks.get(fingerprint) ?? 0) + 1;
      streaks.set(fingerprint, streak);
      source.longestPassedStreak = Math.max(source.longestPassedStreak, streak);
    } else {
      summary.failed += 1;
      source.failed += 1;
      streaks.set(fingerprint, 0);
    }
  }
  for (const [id, entry] of starts) {
    if (finishedIds.has(id)) continue;
    const fingerprint = entry.run?.fingerprint ?? 'unknown';
    const source = sources.get(fingerprint) ?? emptySource(fingerprint);
    sources.set(fingerprint, source);
    source.runs += 1;
    source.unfinished += 1;
    summary.unfinished += 1;
  }
  summary.bySource = [...sources.values()];
  return summary;
}
