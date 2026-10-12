import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { line } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';

/**
 * B103 (0.16.1): `sdlc dashboard --watch` keeps the dashboard page up to date. It builds the page, watches
 * openspec/ and rebuilds after changes: debounced, at least `minIntervalMs` between two builds, never two builds at
 * once (a change during a build queues exactly one more). With `serve` it serves the page with an auto-refresh; the
 * refresh tag goes into the response, never into the file. It stops on SIGINT or SIGTERM.
 */

export interface WatchTiming {
  /** Wait this long after the last change before rebuilding. */
  debounceMs: number;
  /** The fewest ms between the end of one build and the start of the next. */
  minIntervalMs: number;
}

export interface ServeAddress {
  host: string;
  /** 0 means any free port. */
  port: number;
}

export interface WatchPlan extends WatchTiming {
  /** The project root: its openspec/ folder is watched. */
  root: string;
  /** The page file `build` writes; `serve` serves it. */
  page: string;
  serve?: ServeAddress;
  /** One build of the page; it reports its own outcome and does not throw (its result is not used). */
  build: () => unknown;
}

/** How often the fallback watcher compares modification times. */
const POLL_MS = 1000;
const REFRESH_TAG = '<meta http-equiv="refresh" content="5">';

/** sdlc's own temporary files under .sdlc/ are not a change worth a rebuild. */
export function isNoise(file: string | Buffer | null | undefined): boolean {
  return /\.sdlc[\\/].*\.tmp$/.test(String(file ?? ''));
}

/** Debounced rebuilds, never two at once; a change during a build queues exactly one more. */
export class Rebuilder {
  private timer: NodeJS.Timeout | undefined;
  private building = false;
  private again = false;
  private stopped = false;
  private lastBuildEnd = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly build: () => unknown,
    private readonly timing: WatchTiming
  ) {}

  /** A change arrived: rebuild after the debounce; each new change restarts the wait. */
  schedule(): void {
    if (this.stopped) return;
    if (this.building) {
      this.again = true;
      return;
    }
    this.arm(this.timing.debounceMs);
  }

  /** Builds now, or as soon as the minimum interval since the last build allows. */
  async run(): Promise<void> {
    if (this.stopped) return;
    if (this.building) {
      this.again = true;
      return;
    }
    const wait = this.lastBuildEnd + this.timing.minIntervalMs - Date.now();
    if (wait > 0) {
      this.arm(wait);
      return;
    }
    await this.buildOnce();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private arm(ms: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async buildOnce(): Promise<void> {
    this.building = true;
    try {
      await this.build();
    } finally {
      this.lastBuildEnd = Date.now();
      this.building = false;
    }
    if (!this.again) return;
    this.again = false;
    this.schedule();
  }
}

/** Every file under `dir` (noise left out) with its modification time. */
function snapshot(dir: string, out: Map<string, number> = new Map()): Map<string, number> {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) snapshot(file, out);
    else if (!isNoise(file)) out.set(file, fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -1);
  }
  return out;
}

function byPath(a: [string, number], b: [string, number]): number {
  return a[0].localeCompare(b[0]);
}

function fingerprint(dir: string): string {
  const files = [...snapshot(dir)].sort(byPath);
  return JSON.stringify(files);
}

/** The fallback watcher: compares modification times every second; returns the function that stops it. */
export function pollTree(dir: string, onChange: () => void, everyMs: number = POLL_MS): () => void {
  let before = fingerprint(dir);
  const timer = setInterval(() => {
    const now = fingerprint(dir);
    if (now !== before) onChange();
    before = now;
  }, everyMs);
  return () => clearInterval(timer);
}

function watchRecursive(dir: string, onChange: () => void): () => void {
  const watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
    if (!isNoise(file)) onChange();
  });
  // A watcher error (openspec/ removed, for example) must not end the process: rebuild, so the log shows why.
  watcher.on('error', () => onChange());
  return () => watcher.close();
}

/** fs.watch is recursive on Windows and macOS; elsewhere modification times are polled every second. */
export function watchTree(dir: string, onChange: () => void): () => void {
  if (process.platform === 'win32' || process.platform === 'darwin') return watchRecursive(dir, onChange);
  return pollTree(dir, onChange);
}

/** The page as served: the auto-refresh tag goes into the response only, never into the file. */
export function withAutoRefresh(html: string): string {
  return html.replace(/<head[^>]*>/i, (head) => `${head}\n${REFRESH_TAG}`);
}

function readPage(page: string): string | undefined {
  try {
    return fs.readFileSync(page, 'utf-8');
  } catch {
    return undefined;
  }
}

function answerPage(page: string, res: http.ServerResponse): void {
  const html = readPage(page);
  if (html === undefined) {
    res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2' });
    res.end(`${t('watch.notBuiltYet')}\n`);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(withAutoRefresh(html));
}

function pageUrl(host: string, port: number): string {
  const shownHost = host.includes(':') ? `[${host}]` : host;
  return `http://${shownHost}:${port}/`;
}

function listeningPort(server: http.Server): number {
  const info = server.address();
  return typeof info === 'object' && info !== null ? info.port : 0;
}

function serveFailure(address: ServeAddress, error: Error): SdlcError {
  const params = { address: `${address.host}:${address.port}`, reason: error.message };
  return new SdlcError('serve_failed', { key: 'error.serve_failed', params });
}

/** A server error after it listens: logged; the watch goes on rebuilding the file. */
function logServeError(address: ServeAddress, error: Error): void {
  process.stderr.write(`${serveFailure(address, error).localizedMessage()}\n`);
}

function closeServer(server: http.Server): void {
  server.close();
  server.closeAllConnections();
}

/** Serves `page` at `address` and prints its URL; resolves to the function that closes the server. */
export function servePage(address: ServeAddress, page: string): Promise<() => void> {
  const server = http.createServer((_req, res) => answerPage(page, res));
  return new Promise((resolve, reject) => {
    const failToStart = (error: Error): void => reject(serveFailure(address, error));
    server.once('error', failToStart);
    server.listen(address.port, address.host, () => {
      server.off('error', failToStart);
      server.on('error', (error) => logServeError(address, error));
      line(t('watch.serving', { url: pageUrl(address.host, listeningPort(server)) }));
      resolve(() => closeServer(server));
    });
  });
}

interface StopSignal {
  stopped: Promise<void>;
  dispose: () => void;
}

/** Resolves on the first SIGINT or SIGTERM. */
function stopSignal(): StopSignal {
  let stop: () => void = () => undefined;
  const stopped = new Promise<void>((resolve) => {
    stop = resolve;
  });
  const onSignal = (): void => stop();
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const dispose = (): void => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
  return { stopped, dispose };
}

async function firstBuildAndServe(plan: WatchPlan, rebuilder: Rebuilder, closers: Array<() => void>): Promise<void> {
  await rebuilder.run();
  if (plan.serve) closers.push(await servePage(plan.serve, plan.page));
}

/** Builds the page, then rebuilds it after openspec/ changes until SIGINT or SIGTERM. */
export async function watchDashboard(plan: WatchPlan): Promise<void> {
  const signal = stopSignal();
  const rebuilder = new Rebuilder(plan.build, plan);
  const closers: Array<() => void> = [() => rebuilder.stop()];
  try {
    closers.push(watchTree(path.join(plan.root, 'openspec'), () => rebuilder.schedule()));
    line(t('watch.watching', { dir: 'openspec/' }));
    await firstBuildAndServe(plan, rebuilder, closers);
    await signal.stopped;
    line(t('watch.stopped'));
  } finally {
    signal.dispose();
    for (const close of closers) close();
  }
}
