import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError, type LocParams } from '../core/errors.js';
import { toPosix } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { watchDashboard, type ServeAddress, type WatchTiming } from '../report/watch.js';
import { warnStaleOutput } from './out-inside-warning.js';
import { renderReport, reportTarget, writeReport, type ReportCommandOptions } from './report.js';

/** `sdlc dashboard` options; `watch`, `serve`, `debounce` and `minInterval` are B103's `--watch` mode. */
export interface DashboardOptions {
  since?: string;
  change?: string;
  out?: string;
  json?: boolean;
  watch?: boolean;
  serve?: string;
  debounce?: string;
  minInterval?: string;
}

export interface WatchSettings extends WatchTiming {
  serve?: ServeAddress;
}

/** The page `--watch` keeps up to date when `--out` is not given. */
export const DEFAULT_WATCH_OUT = 'reports/dashboard.html';
const DEFAULT_DEBOUNCE_MS = 1000;
const DEFAULT_MIN_INTERVAL_MS = 5000;
const MAX_PORT = 65535;

function refusal(key: string, params?: LocParams): SdlcError {
  return new SdlcError('invalid_option', { key, params });
}

/** A `--debounce` / `--min-interval` value: a whole number of milliseconds, 0 or more. */
function milliseconds(option: string, value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw refusal('error.watch_ms_x', { option, value });
  return Number(value);
}

/** The host without the brackets of an IPv6 address such as `[::1]`. */
function bareHost(host: string): string {
  const bracketed = host.startsWith('[') && host.endsWith(']');
  return bracketed ? host.slice(1, -1) : host;
}

/** A `--serve` value: `host:port`; port 0 means any free port. */
export function serveAddress(value: string): ServeAddress {
  const at = value.lastIndexOf(':');
  const host = bareHost(value.slice(0, Math.max(at, 0)));
  const port = value.slice(at + 1);
  const valid = at > 0 && host !== '' && /^\d+$/.test(port) && Number(port) <= MAX_PORT;
  if (!valid) throw refusal('error.serve_address_x', { value });
  return { host, port: Number(port) };
}

/** The `--watch` settings; refuses `--serve` without `--watch`, a bad address and a bad number of ms. */
export function watchSettings(opts: DashboardOptions): WatchSettings {
  if (opts.serve !== undefined && !opts.watch) throw refusal('error.serve_needs_watch');
  const settings: WatchSettings = {
    debounceMs: milliseconds('--debounce', opts.debounce, DEFAULT_DEBOUNCE_MS),
    minIntervalMs: milliseconds('--min-interval', opts.minInterval, DEFAULT_MIN_INTERVAL_MS),
  };
  if (opts.serve !== undefined) settings.serve = serveAddress(opts.serve);
  return settings;
}

function pageOptions(opts: DashboardOptions): ReportCommandOptions {
  return { since: opts.since, change: opts.change };
}

/** Local wall-clock time, HH:MM:SS, for the rebuild log. */
function clock(): string {
  return new Date().toTimeString().slice(0, 8);
}

function failureText(error: unknown): string {
  if (error instanceof SdlcError) return error.localizedMessage();
  return error instanceof Error ? error.message : String(error);
}

/** One in-process build of the page (the code `sdlc dashboard --out` runs); logs one line; true when written. */
function rebuildPage(root: string, opts: ReportCommandOptions & { out: string }, shown: string): boolean {
  const started = Date.now();
  try {
    writeReport(loadProject(root), opts, 'html');
    line(t('watch.rebuilt', { time: clock(), file: shown, ms: Date.now() - started }));
    return true;
  } catch (error) {
    process.stderr.write(`${t('watch.rebuildFailed', { time: clock(), reason: failureText(error) })}\n`);
    return false;
  }
}

/** `build`, then `then` once, after the first build that succeeds (the out-inside warning prints once). */
function onceAfterSuccess(build: () => boolean, then: () => void): () => boolean {
  let done = false;
  return () => {
    const written = build();
    if (written && !done) {
      done = true;
      then();
    }
    return written;
  };
}

/** `sdlc dashboard --watch`: the page is rebuilt after openspec/ changes until SIGINT or SIGTERM. */
async function watchCommand(opts: DashboardOptions, settings: WatchSettings): Promise<void> {
  const ctx = loadProject();
  const target = reportTarget(ctx.root, opts.out ?? DEFAULT_WATCH_OUT);
  const shown = toPosix(path.relative(ctx.root, target));
  const page = { ...pageOptions(opts), out: target };
  await watchDashboard({
    ...settings,
    root: ctx.root,
    page: target,
    build: onceAfterSuccess(() => rebuildPage(ctx.root, page, shown), () => warnStaleOutput(ctx.root, target)),
  });
}

/** `sdlc dashboard` without `--watch`: the page once, to `--out` or to stdout. */
function dashboardOnce(opts: DashboardOptions): void {
  const ctx = loadProject();
  if (!opts.out) {
    line(renderReport(ctx, pageOptions(opts), 'html'));
    return;
  }
  const target = writeReport(ctx, { ...pageOptions(opts), out: opts.out }, 'html');
  if (opts.json) printJson({ written: target });
  else line(t('report.written', { path: target }));
  warnStaleOutput(ctx.root, target, opts.json ? { locale: 'en' } : {});
}

export async function dashboardCommand(opts: DashboardOptions): Promise<void> {
  try {
    const settings = watchSettings(opts);
    if (opts.watch) await watchCommand(opts, settings);
    else dashboardOnce(opts);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
