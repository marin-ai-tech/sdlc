import * as path from 'node:path';
import { digestFiles } from './digest.js';
import { isDirectory, isFile, listFilesRecursive, readText } from './fs-utils.js';
import type { ProjectPaths } from './project.js';

/**
 * Lightweight reader for OpenSpec delta specs, used for checks OpenSpec does
 * not make before a merge: every MODIFIED/REMOVED/RENAMED header must name a
 * requirement that exists in the living spec, ADDED must not collide, and two
 * open changes must not silently rewrite the same requirement. Merging itself
 * stays OpenSpec's job (`openspec archive`).
 */
export type DeltaOp = 'added' | 'modified' | 'removed' | 'renamed';

export interface DeltaEntry {
  capability: string;
  op: DeltaOp;
  requirement: string;
  /** For renames: the new name. */
  to?: string;
  line: number;
}

export interface DeltaFile {
  capability: string;
  file: string;
  entries: DeltaEntry[];
  scenarios: string[];
}

const SECTION = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/i;
const REQUIREMENT = /^###\s+Requirement:\s*(.+?)\s*$/;
const SCENARIO = /^####\s+Scenario:\s*(.+?)\s*$/;
const FROM = /^\s*[-*]?\s*FROM:\s*`?(?:###\s+Requirement:\s*)?(.+?)`?\s*$/i;
const TO = /^\s*[-*]?\s*TO:\s*`?(?:###\s+Requirement:\s*)?(.+?)`?\s*$/i;

export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function parseDeltaFile(content: string, capability: string, file: string): DeltaFile {
  const entries: DeltaEntry[] = [];
  const scenarios: string[] = [];
  let op: DeltaOp | undefined;
  let pendingFrom: { name: string; line: number } | undefined;
  let inFence = false;
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) return;
    const section = line.match(SECTION);
    if (section) {
      op = section[1].toLowerCase() as DeltaOp;
      pendingFrom = undefined;
      return;
    }
    if (/^##\s/.test(line)) {
      op = undefined;
      return;
    }
    const scenario = line.match(SCENARIO);
    if (scenario) scenarios.push(normalizeName(scenario[1]));
    if (!op) return;
    if (op === 'renamed') {
      const from = line.match(FROM);
      if (from) {
        pendingFrom = { name: normalizeName(from[1]), line: index + 1 };
        return;
      }
      const to = line.match(TO);
      if (to && pendingFrom) {
        entries.push({ capability, op, requirement: pendingFrom.name, to: normalizeName(to[1]), line: pendingFrom.line });
        pendingFrom = undefined;
      }
      return;
    }
    const req = line.match(REQUIREMENT);
    if (req) entries.push({ capability, op, requirement: normalizeName(req[1]), line: index + 1 });
  });
  return { capability, file, entries, scenarios };
}

/** Every delta spec in a change folder (`specs/<capability-path>/spec.md`). */
export function readChangeDeltas(changeDir: string): DeltaFile[] {
  const specsDir = path.join(changeDir, 'specs');
  if (!isDirectory(specsDir)) return [];
  return listFilesRecursive(specsDir)
    .filter((rel) => rel.endsWith('.md'))
    .map((rel) => {
      const capability = path.posix.dirname(rel) === '.' ? rel.replace(/\.md$/, '') : path.posix.dirname(rel);
      return parseDeltaFile(readText(path.join(specsDir, rel)) ?? '', capability, `specs/${rel}`);
    });
}

export function mainSpecFile(paths: ProjectPaths, capability: string): string {
  return path.join(paths.specsDir, ...capability.split('/'), 'spec.md');
}

export function mainRequirements(paths: ProjectPaths, capability: string): Set<string> | undefined {
  const file = mainSpecFile(paths, capability);
  if (!isFile(file)) return undefined;
  const names = new Set<string>();
  let inFence = false;
  for (const line of (readText(file) ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const m = line.match(REQUIREMENT);
    if (m) names.add(normalizeName(m[1]).toLowerCase());
  }
  return names;
}

export interface DeltaIssue {
  level: 'error' | 'warning';
  file: string;
  line: number;
  message: string;
}

/** Checks a change's deltas against the current living specs. */
export function checkDeltaTargets(paths: ProjectPaths, deltas: DeltaFile[]): DeltaIssue[] {
  const issues: DeltaIssue[] = [];
  for (const delta of deltas) {
    const existing = mainRequirements(paths, delta.capability);
    for (const e of delta.entries) {
      const has = existing?.has(e.requirement.toLowerCase()) ?? false;
      const where = { file: delta.file, line: e.line };
      if (e.op === 'modified' && !has) {
        issues.push({ level: 'error', ...where, message: existing
          ? `MODIFIED "${e.requirement}" does not match any requirement in openspec/specs/${delta.capability}/spec.md (check the exact header, or use ADDED).`
          : `MODIFIED "${e.requirement}" targets capability '${delta.capability}', which has no main spec yet; use ADDED for a new capability.` });
      } else if (e.op === 'renamed' && !has) {
        issues.push({ level: 'error', ...where, message: `RENAMED FROM "${e.requirement}" does not exist in openspec/specs/${delta.capability}/spec.md.` });
      } else if (e.op === 'removed' && !has) {
        issues.push({ level: 'warning', ...where, message: `REMOVED "${e.requirement}" is not in openspec/specs/${delta.capability}/spec.md; OpenSpec will treat it as already removed.` });
      } else if (e.op === 'added' && has) {
        issues.push({ level: 'error', ...where, message: `ADDED "${e.requirement}" already exists in openspec/specs/${delta.capability}/spec.md; use MODIFIED with the full requirement block instead.` });
      }
    }
  }
  return issues;
}

export interface Overlap {
  capability: string;
  requirement: string;
  changes: Array<{ change: string; op: DeltaOp }>;
}

/**
 * Requirements that more than one open change adds, modifies, removes or
 * renames. MODIFIED replaces the whole block at archive time, so the change
 * archived second silently wins unless someone reconciles them.
 */
export function findOverlaps(changes: Array<{ id: string; deltas: DeltaFile[] }>): Overlap[] {
  const byKey = new Map<string, Overlap>();
  for (const change of changes) {
    for (const delta of change.deltas) {
      for (const e of delta.entries) {
        const key = `${delta.capability}\u0000${e.requirement.toLowerCase()}`;
        const entry = byKey.get(key) ?? { capability: delta.capability, requirement: e.requirement, changes: [] };
        if (!entry.changes.some((c) => c.change === change.id)) entry.changes.push({ change: change.id, op: e.op });
        byKey.set(key, entry);
      }
    }
  }
  return [...byKey.values()].filter((o) => o.changes.length > 1);
}

/** Digest of each living spec a change modifies/removes/renames (base snapshot for drift checks). */
export function baseDigests(paths: ProjectPaths, deltas: DeltaFile[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const delta of deltas) {
    if (!delta.entries.some((e) => e.op !== 'added')) continue;
    const file = mainSpecFile(paths, delta.capability);
    if (isFile(file)) out[delta.capability] = digestFiles(path.dirname(file), ['spec.md']);
  }
  return out;
}

export function changedBases(paths: ProjectPaths, recorded: Record<string, string> | undefined): string[] {
  if (!recorded) return [];
  return Object.entries(recorded)
    .filter(([capability, digest]) => {
      const file = mainSpecFile(paths, capability);
      return !isFile(file) || digestFiles(path.dirname(file), ['spec.md']) !== digest;
    })
    .map(([capability]) => capability);
}
