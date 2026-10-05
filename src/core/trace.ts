/**
 * `sdlc trace <change>`: one view from intent to evidence. Requirements and scenarios come from the delta specs,
 * tasks from tasks.md, commits from git (trailers `SDLC-Change: <id>` and `SDLC-Task: <n.m>`; task numbers repeat
 * across changes, so both are needed), evidence from the "Behavioral verification" table of verification.md, and
 * findings from review.md. What is missing is listed as gaps.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ChangeRef } from './changes.js';
import { readText } from './fs-utils.js';
import { git } from './git.js';
import { parseFindings } from './review.js';
import { parseTasks } from './tasks.js';

export interface TraceEvidence { row: string; run: string; seen: string; result: string }
export interface TraceScenario { name: string; evidence: TraceEvidence[] }
export interface TraceRequirement { name: string; file: string; scenarios: TraceScenario[] }
export interface TraceTask { id: string; text: string; done: boolean; commits: string[] }
export interface TraceFinding { id: string; title: string; status?: string }
export type GapKind = 'requirement-without-scenario' | 'scenario-without-evidence' | 'task-without-commit'
  | 'finding-without-status';
export interface TraceGap { kind: GapKind; ref: string }

export interface Trace {
  change: string;
  archived: boolean;
  intent?: { path: string; title: string };
  requirements: TraceRequirement[];
  tasks: TraceTask[];
  findings: TraceFinding[];
  gaps: TraceGap[];
}

const REQUIREMENT = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCENARIO = /^####\s+Scenario:\s*(.+?)\s*$/;
const TASK_ID = /^(\d+(?:\.\d+)+)\s+(.*)$/;
const TRAILER = /^(SDLC-Change|SDLC-Task):\s*(\S+)\s*$/gim;

function specFiles(dir: string): string[] {
  const specs = path.join(dir, 'specs');
  if (!fs.existsSync(specs)) return [];
  return fs.readdirSync(specs, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.replace(/\\/g, '/').endsWith('spec.md'))
    .map((file) => path.join(specs, file))
    .sort();
}

function parseRequirements(dir: string): TraceRequirement[] {
  const requirements: TraceRequirement[] = [];
  for (const file of specFiles(dir)) {
    const relative = path.relative(dir, file).replace(/\\/g, '/');
    for (const line of (readText(file) ?? '').split(/\r?\n/)) {
      const requirement = REQUIREMENT.exec(line);
      if (requirement) requirements.push({ name: requirement[1], file: relative, scenarios: [] });
      const scenario = SCENARIO.exec(line);
      if (scenario && requirements.length > 0) requirements.at(-1)!.scenarios.push({ name: scenario[1], evidence: [] });
    }
  }
  return requirements;
}

function evidenceRows(dir: string): TraceEvidence[] {
  const text = readText(path.join(dir, 'verification.md')) ?? '';
  const section = text.split(/^## /m).find((part) => part.startsWith('Behavioral verification')) ?? '';
  return section.split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|') && !/^\|\s*-/.test(line.trim()))
    .map((line) => line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4 && !/^scenario/i.test(cells[0]))
    .map(([row, run, seen, result]) => ({ row, run, seen, result }));
}

function attachEvidence(requirements: TraceRequirement[], rows: TraceEvidence[]): void {
  for (const scenario of requirements.flatMap((requirement) => requirement.scenarios)) {
    const name = scenario.name.toLowerCase();
    scenario.evidence = rows.filter((row) => row.row.toLowerCase().includes(name));
  }
}

/** Commit hashes per task number, for commits whose trailers name this change. */
function commitsByTask(root: string, change: string): Map<string, string[]> {
  const byTask = new Map<string, string[]>();
  const log = git(root, ['log', '--format=%H%x1f%B%x1e']);
  if (!log.ok) return byTask;
  for (const entry of log.stdout.split('\x1e')) {
    const [hash, body = ''] = entry.trim().split('\x1f');
    const trailers = [...body.matchAll(TRAILER)].map((match) => [match[1].toLowerCase(), match[2]]);
    if (!hash || !trailers.some(([name, value]) => name === 'sdlc-change' && value === change)) continue;
    for (const [, task] of trailers.filter(([name]) => name === 'sdlc-task')) {
      byTask.set(task, [...(byTask.get(task) ?? []), hash]);
    }
  }
  return byTask;
}

function parseTraceTasks(root: string, ref: ChangeRef): TraceTask[] {
  const commits = commitsByTask(root, ref.id);
  const progress = parseTasks(readText(path.join(ref.dir, 'tasks.md')) ?? '');
  return progress.tasks.flatMap((task) => {
    const match = TASK_ID.exec(task.description);
    if (!match) return [];
    return [{ id: match[1], text: match[2], done: task.done, commits: commits.get(match[1]) ?? [] }];
  });
}

function hasStatusLine(lines: string[], from: number): boolean {
  for (let index = from; index < lines.length; index += 1) {
    if (/^#{1,3} /.test(lines[index])) return false;
    if (/^\s*[-*]\s*\*\*Status\*\*\s*:/i.test(lines[index])) return true;
  }
  return false;
}

function parseTraceFindings(dir: string): TraceFinding[] {
  const text = readText(path.join(dir, 'review.md')) ?? '';
  const lines = text.split(/\r?\n/);
  return parseFindings(text).map((finding, index) => ({
    id: finding.id ?? `F${index + 1}`,
    title: finding.title,
    ...(hasStatusLine(lines, finding.line) ? { status: finding.status } : {}),
  }));
}

function findGaps(trace: Omit<Trace, 'gaps'>): TraceGap[] {
  const gaps: TraceGap[] = [];
  for (const requirement of trace.requirements) {
    if (requirement.scenarios.length === 0) gaps.push({ kind: 'requirement-without-scenario', ref: requirement.name });
    for (const scenario of requirement.scenarios) {
      if (scenario.evidence.length === 0) gaps.push({ kind: 'scenario-without-evidence', ref: scenario.name });
    }
  }
  for (const task of trace.tasks.filter((entry) => entry.commits.length === 0)) {
    gaps.push({ kind: 'task-without-commit', ref: task.id });
  }
  for (const finding of trace.findings.filter((entry) => entry.status === undefined)) {
    gaps.push({ kind: 'finding-without-status', ref: finding.id });
  }
  return gaps;
}

function readIntent(dir: string): Trace['intent'] {
  const text = readText(path.join(dir, 'intent.md'));
  if (text === undefined) return undefined;
  const heading = /^#\s+(?:Intent:\s*)?(.+?)\s*$/m.exec(text);
  return { path: 'intent.md', title: heading?.[1] ?? '' };
}

export function buildTrace(root: string, ref: ChangeRef): Trace {
  const requirements = parseRequirements(ref.dir);
  attachEvidence(requirements, evidenceRows(ref.dir));
  const partial = {
    change: ref.id,
    archived: ref.archived,
    intent: readIntent(ref.dir),
    requirements,
    tasks: parseTraceTasks(root, ref),
    findings: parseTraceFindings(ref.dir),
  };
  return { ...partial, gaps: findGaps(partial) };
}
