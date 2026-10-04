#!/usr/bin/env node
/**
 * Example background process: keeps the sdlc dashboard page up to date.
 * Watches openspec/ and runs `<cli> dashboard --out <file>` after changes.
 * Optionally serves the page on localhost with an auto-refresh.
 * Everything stays local. How to run it in the background: README.md next to this file.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const USAGE = `Usage: node dashboard-watch.mjs [options]

  --out <file>          page to write, relative to the project root (default reports/dashboard.html)
  --cli <command>       sdlc command line (default sdlc), e.g. "npx --no-install sdlc"
  --debounce <ms>       wait after the last change before rebuilding (default 1000)
  --min-interval <ms>   fewest ms between two rebuilds (default 5000)
  --once                build once and exit
  --serve <host:port>   serve the page with auto-refresh (port 0 = any free port)
  --help                show this help
`;

const OPTIONS = {
  '--out': { key: 'out' },
  '--cli': { key: 'cli' },
  '--debounce': { key: 'debounce', number: true },
  '--min-interval': { key: 'minInterval', number: true },
  '--serve': { key: 'serve' },
  '--once': { key: 'once', flag: true },
  '--help': { key: 'help', flag: true },
};

function fail(message, code) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { out: 'reports/dashboard.html', cli: 'sdlc', debounce: 1000, minInterval: 5000 };
  for (let i = 0; i < argv.length; i++) {
    const spec = OPTIONS[argv[i]];
    if (!spec) fail(`Unknown option: ${argv[i]}\n\n${USAGE}`, 2);
    if (spec.flag) {
      opts[spec.key] = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) fail(`Missing value for ${argv[i - 1]}\n\n${USAGE}`, 2);
    const number = Number(value);
    if (spec.number && !(number >= 0)) fail(`Not a number of ms: ${argv[i - 1]} ${value}\n\n${USAGE}`, 2);
    opts[spec.key] = spec.number ? number : value;
  }
  return opts;
}

function findProjectRoot(dir) {
  if (fs.existsSync(path.join(dir, 'openspec', 'sdlc.yaml'))) return dir;
  const parent = path.dirname(dir);
  return parent === dir ? null : findProjectRoot(parent);
}

/** Runs one dashboard build; resolves to true on success. Logs one line either way. */
function build(root, opts) {
  const started = Date.now();
  const command = `${opts.cli} dashboard --out "${opts.out}"`;
  const child = spawn(command, { cwd: root, shell: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  return new Promise((resolve) => {
    child.on('error', (err) => (stderr += err.message));
    child.on('close', (code) => {
      const time = new Date().toLocaleTimeString();
      if (code === 0) process.stdout.write(`${time} rebuilt ${opts.out} in ${Date.now() - started} ms\n`);
      else process.stderr.write(`${time} rebuild failed (exit ${code}): ${stderr.trim()}\n`);
      resolve(code === 0);
    });
  });
}

/** Debounced, never two builds at once; changes during a build queue exactly one more. */
function rebuilder(root, opts) {
  let timer = null;
  let building = false;
  let again = false;
  let last = 0;
  const run = async () => {
    if (building) return void (again = true);
    const wait = last + opts.minInterval - Date.now();
    if (wait > 0) return void (timer = setTimeout(run, wait));
    building = true;
    await build(root, opts);
    last = Date.now();
    building = false;
    if (again) {
      again = false;
      schedule();
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(run, opts.debounce);
  };
  return { run, schedule, stop: () => clearTimeout(timer) };
}

const isNoise = (file) => /\.sdlc[\\/].*\.tmp$/.test(String(file ?? ''));

function snapshot(dir, out = new Map()) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) snapshot(file, out);
    else if (!isNoise(file)) out.set(file, fs.statSync(file, { throwIfNoEntry: false })?.mtimeMs);
  }
  return out;
}

/** fs.watch is recursive on Windows and macOS; elsewhere poll mtimes every second. */
function watch(dir, onChange) {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    const watcher = fs.watch(dir, { recursive: true }, (_event, file) => isNoise(file) || onChange());
    return () => watcher.close();
  }
  let before = JSON.stringify([...snapshot(dir)]);
  const timer = setInterval(() => {
    const now = JSON.stringify([...snapshot(dir)]);
    if (now !== before) onChange();
    before = now;
  }, 1000);
  return () => clearInterval(timer);
}

/** Serves the page (started after the first build); the refresh tag goes into the response, never the file. */
function serve(address, page) {
  const at = address.lastIndexOf(':');
  const host = address.slice(0, at);
  const port = Number(address.slice(at + 1));
  if (at <= 0 || !(port >= 0)) fail(`--serve expects host:port, got ${address}`, 2);
  const server = http.createServer((_req, res) => {
    if (!fs.existsSync(page)) return void res.writeHead(503).end('The dashboard is being built, retry in a moment.\n');
    const html = fs.readFileSync(page, 'utf-8').replace(/<head[^>]*>/i, '$&\n<meta http-equiv="refresh" content="5">');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  });
  server.listen(port, host, () => process.stdout.write(`serving http://${host}:${server.address().port}/\n`));
  return () => server.close();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return void process.stdout.write(USAGE);
  const root = findProjectRoot(process.cwd());
  if (!root) fail('Not inside an sdlc project: no openspec/sdlc.yaml here or above. Run `sdlc init` first.', 1);
  if (opts.once) process.exit((await build(root, opts)) ? 0 : 1);
  const rebuild = rebuilder(root, opts);
  const stops = [watch(path.join(root, 'openspec'), rebuild.schedule), rebuild.stop];
  const stop = () => {
    stops.forEach((s) => s());
    process.stdout.write('stopped\n');
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await rebuild.run();
  if (opts.serve) stops.push(serve(opts.serve, path.resolve(root, opts.out)));
}

main();
