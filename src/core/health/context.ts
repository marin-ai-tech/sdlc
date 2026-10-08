import { readChangeState, type ChangeState, type HistoryEvent } from '../change-state.js';
import { listActiveChanges, listArchivedChanges, type ChangeRef } from '../changes.js';
import type { SdlcConfig } from '../config.js';
import type { Locale } from '../i18n.js';
import { evaluateChange, type LifecycleView } from '../lifecycle.js';
import { readLog, type LogEntry } from '../log.js';
import { changeMetrics, type ChangeMetrics } from '../metrics.js';
import type { ProjectPaths } from '../project.js';
import { changeLog } from '../awaiting.js';
import { healthThresholds, type HealthThresholds } from './thresholds.js';

/** Everything the collectors read, loaded once. Reading never writes. */
export interface ChangeInfo {
  ref: ChangeRef;
  state: ChangeState;
  /** The lifecycle view of an active change; undefined when it cannot be evaluated. */
  view?: LifecycleView;
}

export interface HealthOptions {
  /** Skip the expensive collectors (doctor, plan drift, trace), e.g. on the dashboard. */
  light?: boolean;
  /** Only the cheap collectors that can report a bad finding, without archived changes (the session start). */
  badOnly?: boolean;
  /** The project log when the caller has read it already. */
  log?: LogEntry[];
  now?: Date;
  /** Locale of the facts collectors take from other modules (doctor messages). */
  locale?: Locale;
}

export interface HealthContext {
  root: string;
  paths: ProjectPaths;
  config: SdlcConfig;
  thresholds: HealthThresholds;
  light: boolean;
  badOnly: boolean;
  locale: Locale;
  now: number;
  /** Start of the window (ms): `health.window_days` before now. */
  since: number;
  /** The whole project log. */
  log: LogEntry[];
  /** Log entries inside the window. */
  recent: LogEntry[];
  active: ChangeInfo[];
  archived: ChangeInfo[];
}

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;

function inWindow(at: string | undefined, since: number): boolean {
  const ms = Date.parse(at ?? '');
  return Number.isFinite(ms) && ms >= since;
}

function readInfo(ref: ChangeRef): ChangeInfo | undefined {
  try {
    return { ref, state: readChangeState(ref.dir) };
  } catch {
    return undefined;
  }
}

function withView(root: string, config: SdlcConfig, info: ChangeInfo): ChangeInfo {
  try {
    const view = evaluateChange(root, info.ref, config, { skipFingerprint: true, skipPeople: true });
    return { ...info, view };
  } catch {
    return info;
  }
}

function loadChanges(root: string, paths: ProjectPaths, config: SdlcConfig, archived: boolean) {
  const read = (refs: ChangeRef[]) => refs.map(readInfo).filter((info): info is ChangeInfo => info !== undefined);
  const active = read(listActiveChanges(paths)).map((info) => withView(root, config, info));
  return { active, archived: archived ? read(listArchivedChanges(paths)) : [] };
}

export function loadHealthContext(
  root: string, paths: ProjectPaths, config: SdlcConfig, options: HealthOptions = {},
): HealthContext {
  const thresholds = healthThresholds(config);
  const now = (options.now ?? new Date()).getTime();
  const since = now - thresholds.windowDays * DAY_MS;
  const log = options.log ?? readLog(root);
  const recent = log.filter((entry) => inWindow(entry.ts, since));
  const badOnly = options.badOnly === true;
  const light = badOnly || options.light === true;
  const locale = options.locale ?? 'en';
  const changes = loadChanges(root, paths, config, !badOnly);
  return { root, paths, config, thresholds, light, badOnly, locale, now, since, log, recent, ...changes };
}

/** History events inside the window. */
export function recentHistory(ctx: HealthContext, state: ChangeState): HistoryEvent[] {
  return state.history.filter((event) => inWindow(event.at, ctx.since));
}

/** Changes with any history event inside the window: the active ones and the archived ones. */
export function windowChanges(ctx: HealthContext): ChangeInfo[] {
  const all = [...ctx.active, ...ctx.archived];
  return all.filter((info) => recentHistory(ctx, info.state).length > 0);
}

export interface ChangeRow {
  info: ChangeInfo;
  metrics: ChangeMetrics;
}

/** Metrics of the changes in the window, from their history and log entries inside the window. */
export function windowMetrics(ctx: HealthContext): ChangeRow[] {
  return windowChanges(ctx).map((info) => {
    const state = { ...info.state, history: recentHistory(ctx, info.state) };
    const metrics = changeMetrics(state, changeLog(ctx.recent, info.ref.id));
    return { info, metrics };
  });
}

/** Whole days (rounded down) from `at` to now; undefined for a missing or bad timestamp. */
export function daysSince(ctx: HealthContext, at: string | undefined): number | undefined {
  const ms = Date.parse(at ?? '');
  if (!Number.isFinite(ms)) return undefined;
  return Math.floor((ctx.now - ms) / DAY_MS);
}

export function hoursSince(ctx: HealthContext, at: string | undefined): number | undefined {
  const ms = Date.parse(at ?? '');
  if (!Number.isFinite(ms)) return undefined;
  return Math.round((ctx.now - ms) / HOUR_MS * 10) / 10;
}
