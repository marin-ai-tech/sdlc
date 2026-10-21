import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { line } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { t } from '../core/i18n.js';
/** How often the fallback watcher compares modification times. */
const POLL_MS = 1000;
const REFRESH_TAG = '<meta http-equiv="refresh" content="5">';
/** sdlc's own temporary files under .sdlc/ are not a change worth a rebuild. */
export function isNoise(file) {
    return /\.sdlc[\\/].*\.tmp$/.test(String(file ?? ''));
}
/** Debounced rebuilds, never two at once; a change during a build queues exactly one more. */
export class Rebuilder {
    build;
    timing;
    timer;
    building = false;
    again = false;
    stopped = false;
    lastBuildEnd = Number.NEGATIVE_INFINITY;
    constructor(build, timing) {
        this.build = build;
        this.timing = timing;
    }
    /** A change arrived: rebuild after the debounce; each new change restarts the wait. */
    schedule() {
        if (this.stopped)
            return;
        if (this.building) {
            this.again = true;
            return;
        }
        this.arm(this.timing.debounceMs);
    }
    /** Builds now, or as soon as the minimum interval since the last build allows. */
    async run() {
        if (this.stopped)
            return;
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
    stop() {
        this.stopped = true;
        clearTimeout(this.timer);
    }
    arm(ms) {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.run(), ms);
    }
    async buildOnce() {
        this.building = true;
        try {
            await this.build();
        }
        finally {
            this.lastBuildEnd = Date.now();
            this.building = false;
        }
        if (!this.again)
            return;
        this.again = false;
        this.schedule();
    }
}
/** Every file under `dir` (noise left out) with its modification time. */
function snapshot(dir, out = new Map()) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory())
            snapshot(file, out);
        else if (!isNoise(file))
            out.set(file, fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? -1);
    }
    return out;
}
function byPath(a, b) {
    return a[0].localeCompare(b[0]);
}
function fingerprint(dir) {
    const files = [...snapshot(dir)].sort(byPath);
    return JSON.stringify(files);
}
/** The fallback watcher: compares modification times every second; returns the function that stops it. */
export function pollTree(dir, onChange, everyMs = POLL_MS) {
    let before = fingerprint(dir);
    const timer = setInterval(() => {
        const now = fingerprint(dir);
        if (now !== before)
            onChange();
        before = now;
    }, everyMs);
    return () => clearInterval(timer);
}
function watchRecursive(dir, onChange) {
    const watcher = fs.watch(dir, { recursive: true }, (_event, file) => {
        if (!isNoise(file))
            onChange();
    });
    // A watcher error (openspec/ removed, for example) must not end the process: rebuild, so the log shows why.
    watcher.on('error', () => onChange());
    return () => watcher.close();
}
/** fs.watch is recursive on Windows and macOS; elsewhere modification times are polled every second. */
export function watchTree(dir, onChange) {
    if (process.platform === 'win32' || process.platform === 'darwin')
        return watchRecursive(dir, onChange);
    return pollTree(dir, onChange);
}
/** The page as served: the auto-refresh tag goes into the response only, never into the file. */
export function withAutoRefresh(html) {
    return html.replace(/<head[^>]*>/i, (head) => `${head}\n${REFRESH_TAG}`);
}
function readPage(page) {
    try {
        return fs.readFileSync(page, 'utf-8');
    }
    catch {
        return undefined;
    }
}
function answerPage(page, res) {
    const html = readPage(page);
    if (html === undefined) {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '2' });
        res.end(`${t('watch.notBuiltYet')}\n`);
        return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(withAutoRefresh(html));
}
function pageUrl(host, port) {
    const shownHost = host.includes(':') ? `[${host}]` : host;
    return `http://${shownHost}:${port}/`;
}
function listeningPort(server) {
    const info = server.address();
    return typeof info === 'object' && info !== null ? info.port : 0;
}
function serveFailure(address, error) {
    const params = { address: `${address.host}:${address.port}`, reason: error.message };
    return new SdlcError('serve_failed', { key: 'error.serve_failed', params });
}
/** A server error after it listens: logged; the watch goes on rebuilding the file. */
function logServeError(address, error) {
    process.stderr.write(`${serveFailure(address, error).localizedMessage()}\n`);
}
function closeServer(server) {
    server.close();
    server.closeAllConnections();
}
/** Serves `page` at `address` and prints its URL; resolves to the function that closes the server. */
export function servePage(address, page) {
    const server = http.createServer((_req, res) => answerPage(page, res));
    return new Promise((resolve, reject) => {
        const failToStart = (error) => reject(serveFailure(address, error));
        server.once('error', failToStart);
        server.listen(address.port, address.host, () => {
            server.off('error', failToStart);
            server.on('error', (error) => logServeError(address, error));
            line(t('watch.serving', { url: pageUrl(address.host, listeningPort(server)) }));
            resolve(() => closeServer(server));
        });
    });
}
/** Resolves on the first SIGINT or SIGTERM. */
function stopSignal() {
    let stop = () => undefined;
    const stopped = new Promise((resolve) => {
        stop = resolve;
    });
    const onSignal = () => stop();
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    const dispose = () => {
        process.off('SIGINT', onSignal);
        process.off('SIGTERM', onSignal);
    };
    return { stopped, dispose };
}
async function firstBuildAndServe(plan, rebuilder, closers) {
    await rebuilder.run();
    if (plan.serve)
        closers.push(await servePage(plan.serve, plan.page));
}
/** Builds the page, then rebuilds it after openspec/ changes until SIGINT or SIGTERM. */
export async function watchDashboard(plan) {
    const signal = stopSignal();
    const rebuilder = new Rebuilder(plan.build, plan);
    const closers = [() => rebuilder.stop()];
    try {
        closers.push(watchTree(path.join(plan.root, 'openspec'), () => rebuilder.schedule()));
        line(t('watch.watching', { dir: 'openspec/' }));
        await firstBuildAndServe(plan, rebuilder, closers);
        await signal.stopped;
        line(t('watch.stopped'));
    }
    finally {
        signal.dispose();
        for (const close of closers)
            close();
    }
}
