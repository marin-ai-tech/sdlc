#!/usr/bin/env node
/**
 * Daily summary - an example shipped with sdlc (0.12.0, B25).
 *
 * Writes `daily-summary-<YYYY-MM-DD>.md` with what was done in the last day, what comes next, what is blocked and what
 * waits on people, from `sdlc report --format json --since <yesterday>`. It publishes nothing by itself: run it from a
 * scheduler, then send the file with whatever your team already uses.
 *
 *   node daily-summary.mjs [--out <folder>] [--since <YYYY-MM-DD>]
 *
 * Run it in the project folder. SDLC_BIN overrides how sdlc is called (default `sdlc`).
 *
 * Windows Task Scheduler (every day at 08:00):
 *   schtasks /Create /SC DAILY /ST 08:00 /TN sdlc-daily
 *     /TR "cmd /c cd /d C:\work\shop && node daily-summary.mjs --out reports"
 * cron:
 *   0 8 * * 1-5 cd /work/shop && node daily-summary.mjs --out reports
 */
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

/** The local date, YYYY-MM-DD. */
function day(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function report(since) {
  const bin = process.env.SDLC_BIN || 'sdlc';
  const output = execSync(`${bin} report --format json --since ${since}`, { encoding: 'utf-8' });
  return JSON.parse(output);
}

function done(model) {
  const finished = (event) => /^gate\.\w+\.approved$/.test(event.event) || event.event === 'change.archived';
  return model.events.filter(finished).map((event) => `${event.change ?? '-'}: ${event.event} (${event.by ?? '-'})`);
}

function blocked(change) {
  const rejected = change.gates.some((gate) => gate.status === 'rejected');
  return rejected || change.verification === 'failed' || (change.review?.blockingOpen ?? 0) > 0;
}

function nextLine(change) {
  const command = change.next.cli ? ` - \`${change.next.cli}\`` : '';
  return `${change.id} (${change.stage}): ${change.next.message}${command}`;
}

function section(title, lines) {
  const body = lines.length > 0 ? lines.map((text) => `- ${text}`) : ['- nothing'];
  return [`## ${title}`, '', ...body, ''];
}

function summary(model, today) {
  const active = model.changes.filter((change) => !change.archived);
  return [
    `# Daily summary ${today}`,
    '',
    `Project ${model.project.name}: ${model.summary.active} active, ${model.summary.awaitingHuman} waiting on people.`,
    '',
    ...section('Done', done(model)),
    ...section('Next', active.filter((change) => change.next.actor === 'agent').map(nextLine)),
    ...section('Blocked', active.filter(blocked).map(nextLine)),
    ...section('Waiting on people', active.filter((change) => change.next.actor === 'human').map(nextLine)),
  ].join('\n');
}

const now = new Date();
const since = option('--since', day(new Date(now.getTime() - 86_400_000)));
if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
  process.stderr.write('--since must be a date: YYYY-MM-DD\n');
  process.exit(1);
}
const out = option('--out', process.cwd());
fs.mkdirSync(out, { recursive: true });
const file = path.join(out, `daily-summary-${day(now)}.md`);
fs.writeFileSync(file, summary(report(since), day(now)), 'utf-8');
process.stdout.write(`${file}\n`);
