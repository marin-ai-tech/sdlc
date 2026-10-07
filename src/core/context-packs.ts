import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { GateId } from './config.js';
import { isDirectory, isWithin } from './fs-utils.js';
import { t } from './i18n.js';
import { GATE_STAGE, STAGES, type StageId } from './lifecycle.js';

/**
 * Context packs (B15): the knowledge a team keeps for its agents (domain rules, an API's quirks, deploy windows)
 * as `docs/context/*.md`, each opening with a YAML header between `---` lines: `owner`, `source`, `updated`
 * (YYYY-MM-DD), `fresh_days` (positive integer) and `stages` (stage ids). `sdlc instructions` hands the agent the
 * sources of the artifact's stage and marks the ones older than their `fresh_days` as stale.
 * Parse, don't validate: a file without a usable header is skipped and named in `contextSkipped`, never fatal.
 */

export const CONTEXT_DIR = 'docs/context';
/** Files above this size are skipped (reason: too large). */
export const MAX_SOURCE_BYTES = 256 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_STAGES: readonly string[] = STAGES;

/** Record artifacts and the gate that holds each of them. */
const RECORD_GATE = new Map<string, GateId>([
  ['verification', 'verify'],
  ['review', 'review'],
  ['release', 'release'],
]);

export interface ContextSource {
  path: string;
  owner: string;
  source: string;
  updated: string;
  freshDays: number;
  stale: boolean;
  content: string;
}

export interface ContextSkipped {
  path: string;
  reason: string;
}

export interface ContextPack {
  sources: ContextSource[];
  skipped: ContextSkipped[];
}

interface Header {
  owner: string;
  source: string;
  updated: string;
  freshDays: number;
  stages: string[];
}

interface LoadedFile {
  header: Header;
  body: string;
}

/** The stage of the gate that holds the artifact: records by their own gate, planning artifacts by `artifacts`. */
export function artifactStage(
  artifact: string,
  gates: ReadonlyArray<{ id: GateId; artifacts: string[] }>
): StageId | undefined {
  const record = RECORD_GATE.get(artifact);
  if (record) return GATE_STAGE[record];
  const gate = gates.find((g) => g.artifacts.includes(artifact));
  return gate ? GATE_STAGE[gate.id] : undefined;
}

function nonEmptyText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function isoDate(value: unknown): string | undefined {
  const text = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof text !== 'string' || !ISO_DATE.test(text)) return undefined;
  const time = Date.parse(`${text}T00:00:00Z`);
  if (Number.isNaN(time)) return undefined;
  return new Date(time).toISOString().slice(0, 10) === text ? text : undefined;
}

function stageList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ok = value.every((s) => typeof s === 'string' && SOURCE_STAGES.includes(s));
  return ok ? (value as string[]) : undefined;
}

function invalid(field: string): string {
  return `invalid header: ${field}`;
}

function headerFields(data: Record<string, unknown>): Header | string {
  const owner = nonEmptyText(data.owner);
  if (owner === undefined) return invalid('owner');
  const source = nonEmptyText(data.source);
  if (source === undefined) return invalid('source');
  const updated = isoDate(data.updated);
  if (updated === undefined) return invalid('updated');
  const freshDays = data.fresh_days;
  if (typeof freshDays !== 'number' || !Number.isInteger(freshDays) || freshDays <= 0) return invalid('fresh_days');
  const stages = stageList(data.stages);
  if (stages === undefined) return invalid('stages');
  return { owner, source, updated, freshDays, stages };
}

function parseHeader(raw: string): Header | string {
  let data: unknown;
  try {
    data = parse(raw);
  } catch {
    return invalid('not valid YAML');
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return invalid('not a mapping');
  return headerFields(data as Record<string, unknown>);
}

/** Splits `---` header lines from the body; `undefined` when the file does not open with a closed header. */
function splitHeader(text: string): { header: string; body: string } | undefined {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() !== '---') return undefined;
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return undefined;
  return { header: lines.slice(1, end).join('\n'), body: lines.slice(end + 1).join('\n') };
}

function loadFile(realRoot: string, file: string): LoadedFile | string {
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return 'unreadable';
  }
  if (!isWithin(realRoot, real)) return 'outside the project root';
  const stat = fs.statSync(real);
  if (!stat.isFile()) return 'not a file';
  if (stat.size > MAX_SOURCE_BYTES) return 'too large';
  const parts = splitHeader(fs.readFileSync(real, 'utf8'));
  if (!parts) return 'missing header';
  const header = parseHeader(parts.header);
  if (typeof header === 'string') return header;
  return { header, body: parts.body };
}

/** True when today (UTC date) minus `updated` is more than `freshDays` days. */
export function isStale(updated: string, freshDays: number, now: Date = new Date()): boolean {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const age = (today - Date.parse(`${updated}T00:00:00Z`)) / DAY_MS;
  return age > freshDays;
}

function toSource(rel: string, loaded: LoadedFile, now: Date): ContextSource {
  const { owner, source, updated, freshDays } = loaded.header;
  const stale = isStale(updated, freshDays, now);
  return { path: rel, owner, source, updated, freshDays, stale, content: loaded.body };
}

/** `*.md` entries of the folder (one level), sorted by name, so by path. */
function contextFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = entries.filter((e) => e.name.endsWith('.md') && (e.isFile() || e.isSymbolicLink()));
  return files.map((e) => e.name).sort();
}

/**
 * The context pack for a stage: the sources whose `stages` include it and every skipped file.
 * `undefined` when the project has no `docs/context` folder; no stage means no sources (skips are still named).
 */
export function readContextPack(
  root: string,
  stage: StageId | undefined,
  now: Date = new Date()
): ContextPack | undefined {
  const dir = path.join(root, CONTEXT_DIR);
  if (!isDirectory(dir)) return undefined;
  const realRoot = fs.realpathSync(root);
  const pack: ContextPack = { sources: [], skipped: [] };
  for (const name of contextFiles(dir)) {
    const rel = `${CONTEXT_DIR}/${name}`;
    const loaded = loadFile(realRoot, path.join(dir, name));
    if (typeof loaded === 'string') {
      pack.skipped.push({ path: rel, reason: loaded });
      continue;
    }
    if (stage !== undefined && loaded.header.stages.includes(stage)) pack.sources.push(toSource(rel, loaded, now));
  }
  return pack;
}

/**
 * Every source with a valid header, whatever its stages, sorted by path: the context resources of `sdlc mcp serve`
 * (B48). A file without a valid header is left out; no `docs/context` folder means none.
 */
export function readContextSources(root: string, now: Date = new Date()): ContextSource[] {
  const dir = path.join(root, CONTEXT_DIR);
  if (!isDirectory(dir)) return [];
  const realRoot = fs.realpathSync(root);
  const sources: ContextSource[] = [];
  for (const name of contextFiles(dir)) {
    const loaded = loadFile(realRoot, path.join(dir, name));
    if (typeof loaded !== 'string') sources.push(toSource(`${CONTEXT_DIR}/${name}`, loaded, now));
  }
  return sources;
}

/** JSON keys for `sdlc instructions --json`: none without a pack, `contextSkipped` only when a file was skipped. */
export function contextPackJson(pack: ContextPack | undefined): Record<string, unknown> {
  if (!pack) return {};
  const skipped = pack.skipped.length > 0 ? { contextSkipped: pack.skipped } : {};
  return { contextSources: pack.sources, ...skipped };
}

function attr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function sourceLines(s: ContextSource): string[] {
  const mark = s.stale ? ' stale' : '';
  const open = `<context-source path="${attr(s.path)}" owner="${attr(s.owner)}" updated="${s.updated}"${mark}>`;
  const note = s.stale ? [t('context.staleNote', { owner: s.owner, updated: s.updated, days: s.freshDays })] : [];
  return [open, ...note, s.content.trim(), '</context-source>'];
}

/** Text output: one `<context-source>` block per source, then one line per skipped file. */
export function contextPackLines(pack: ContextPack | undefined): string[] {
  if (!pack) return [];
  const blocks = pack.sources.flatMap((s) => sourceLines(s));
  const skipped = pack.skipped.map((s) => t('context.skipped', { path: s.path, reason: s.reason }));
  return [...blocks, ...skipped];
}
