/**
 * BMAD `bmad-ticket` output: `tickets.toml` files and their epic / story Markdown.
 *
 * An initiative folder holds `tickets.toml` with `[[epic]]` tables (their order
 * is the build order; `slug` names the epic's folder). An epic folder holds
 * `epic-<slug>.md` (frontmatter `type: epic`, `## Outcome`) and `tickets.toml`
 * with `[[entry]]` tables: `id`, `type` (story | spike | bug), `title`,
 * `description`, `verify`, `after` (a sibling id, "<epic id>.<entry id>", or
 * "epic-<slug>"), `risk`. A story may have a leaf file (frontmatter `type: story`,
 * `id`) whose `## Acceptance Criteria` holds numbered **Given/When/Then** items.
 *
 * Only the TOML subset BMAD writes is supported: comments, `[[table]]` arrays,
 * `key = value` with strings (basic, with \" \\ \n escapes), integers,
 * booleans, arrays of those, and inline tables `{ k = v, … }` inside arrays.
 * Anything else is an `invalid_tickets` error naming the file and line.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { BacklogItemInput } from './backlog.js';
import type { ChangeKind, RiskLevel } from './change-state.js';
import { SdlcError } from './errors.js';
import { toPosix } from './fs-utils.js';
import {
  detectBmadDocs,
  requirementsFromPrd,
  requirementsFromSpec,
  sections,
  type BmadDoc,
} from './import-bmad.js';
import {
  parseTicketsToml as parseToml,
  type TomlTable,
  type TomlValue,
} from './bmad-tickets-toml.js';

export type { TomlValue, TomlTable };
export { parseToml as parseTicketsToml };

export interface BacklogImportPlan {
  /** New epics in order; `key` is the BMAD reference (e.g. "1" or the PRD/SPEC path). */
  epics: Array<{ key: string; title: string; goal?: string }>;
  /** New items in order, grouped by `epicKey`; dependencies by BMAD key ("1.2"). */
  items: Array<Omit<BacklogItemInput, 'epic' | 'dependsOn'> & { key: string; epicKey?: string; dependsOnKeys: string[] }>;
  unmapped: Array<{ doc: string; section: string }>;
  warnings: string[];
}

type PlanItem = BacklogImportPlan['items'][number];

const KIND_MAP: Record<string, ChangeKind> = {
  story: 'feature',
  bug: 'bugfix',
  spike: 'chore',
};

function readUtf8(file: string): string {
  return fs.readFileSync(file, 'utf8');
}

function isSymlink(target: string): boolean {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch {
    return false;
  }
}

function resolveInside(root: string, input: string): string {
  const start = path.resolve(root, input);
  const rootResolved = path.resolve(root);
  const rel = path.relative(rootResolved, start);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SdlcError('no_bmad_artifacts', 'No BMAD artifacts found.');
  }
  return start;
}

function frontmatter(body: string): { meta: Record<string, string>; rest: string } {
  if (!body.startsWith('---')) return { meta: {}, rest: body };
  const end = body.indexOf('\n---', 3);
  if (end < 0) return { meta: {}, rest: body };
  const block = body.slice(3, end).replace(/^\r?\n/, '');
  const rest = body.slice(end + 4).replace(/^\r?\n/, '');
  const meta: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!m) continue;
    meta[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  return { meta, rest };
}

function mdSection(body: string, name: string): string {
  const map = sections(body);
  return [...map].find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]?.trim() ?? '';
}

function parseAcceptanceCriteria(body: string): string[] {
  const block = mdSection(body, 'Acceptance Criteria');
  if (!block) return [];
  const items: string[] = [];
  const pattern = /^\d+\.\s+\*\*(.+?)\*\*\s*\n\s*\*\*Given\*\*\s+(.+?)\s*\n\s*\*\*When\*\*\s+(.+?)\s*\n\s*\*\*Then\*\*\s+(.+?)(?=\n\d+\.|\s*$)/gms;
  for (const match of block.matchAll(pattern)) {
    const title = match[1].trim();
    const given = match[2].trim();
    const when = match[3].trim();
    const then = match[4].trim();
    items.push(`${title} — Given ${given}, when ${when}, then ${then}`);
  }
  return items;
}

function findEpicMarkdown(dir: string): string | undefined {
  if (!fs.existsSync(dir) || isSymlink(dir) || !fs.statSync(dir).isDirectory()) return undefined;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(dir, name);
    if (isSymlink(full)) continue;
    const body = readUtf8(full);
    const { meta } = frontmatter(body);
    if (meta.type === 'epic') return full;
  }
  return undefined;
}

function findStoryLeaf(dir: string, entryId: number): string | undefined {
  if (!fs.existsSync(dir) || isSymlink(dir) || !fs.statSync(dir).isDirectory()) return undefined;
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith('.md')) continue;
    const full = path.join(dir, name);
    if (isSymlink(full)) continue;
    const body = readUtf8(full);
    const { meta } = frontmatter(body);
    if (meta.type === 'story' && String(meta.id) === String(entryId)) return full;
  }
  return undefined;
}

function asString(value: TomlValue | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: TomlValue | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function expandAfter(
  after: TomlValue | undefined,
  epicId: string,
  epicEntries: Map<string, string[]>,
): string[] {
  if (!Array.isArray(after)) return [];
  const keys: string[] = [];
  for (const item of after) {
    if (typeof item === 'number') {
      keys.push(`${epicId}.${item}`);
      continue;
    }
    if (typeof item !== 'string') continue;
    if (/^\d+\.\d+$/.test(item)) {
      keys.push(item);
      continue;
    }
    if (item.startsWith('epic-') || epicEntries.has(item)) {
      // "epic-<slug>" expands to every entry key of that epic (matched by slug).
      const bySlug = epicEntries.get(item);
      if (bySlug) keys.push(...bySlug);
      continue;
    }
    // bare sibling id as string
    if (/^\d+$/.test(item)) keys.push(`${epicId}.${item}`);
  }
  return keys;
}

function planFromTickets(root: string, start: string): BacklogImportPlan {
  const rootTicketsPath = fs.statSync(start).isFile() ? start : path.join(start, 'tickets.toml');
  if (!fs.existsSync(rootTicketsPath) || isSymlink(rootTicketsPath)) {
    throw new SdlcError('no_bmad_artifacts', 'No BMAD artifacts found.');
  }
  const baseDir = fs.statSync(start).isFile() ? path.dirname(start) : start;
  const relativeTickets = (abs: string) => toPosix(path.relative(root, abs));
  const parsed = parseToml(readUtf8(rootTicketsPath), relativeTickets(rootTicketsPath));
  const epicsToml = parsed.epic ?? [];
  const entriesToml = parsed.entry ?? [];

  type EpicSpec = {
    key: string;
    title: string;
    goal?: string;
    slug?: string;
    dir: string;
    ticketsPath: string;
    entries: TomlTable[];
  };

  const epicSpecs: EpicSpec[] = [];

  if (epicsToml.length) {
    for (const epic of epicsToml) {
      const id = asNumber(epic.id);
      if (id === undefined) continue;
      const slug = asString(epic.slug);
      const dir = slug ? path.join(baseDir, slug) : baseDir;
      const ticketsPath = path.join(dir, 'tickets.toml');
      const entries = fs.existsSync(ticketsPath) && !isSymlink(ticketsPath)
        ? (parseToml(readUtf8(ticketsPath), relativeTickets(ticketsPath)).entry ?? [])
        : [];
      const epicMd = findEpicMarkdown(dir);
      const mdBody = epicMd ? readUtf8(epicMd) : '';
      const { meta } = epicMd ? frontmatter(mdBody) : { meta: {} as Record<string, string> };
      const title = asString(epic.title) || meta.title || (epicMd ? path.basename(epicMd, '.md') : `Epic ${id}`);
      const goal = mdSection(mdBody, 'Outcome') || undefined;
      epicSpecs.push({
        key: String(id),
        title,
        goal,
        slug,
        dir,
        ticketsPath: fs.existsSync(ticketsPath) ? ticketsPath : rootTicketsPath,
        entries,
      });
    }
  } else if (entriesToml.length) {
    const epicMd = findEpicMarkdown(baseDir);
    const mdBody = epicMd ? readUtf8(epicMd) : '';
    const { meta } = epicMd ? frontmatter(mdBody) : { meta: {} as Record<string, string> };
    epicSpecs.push({
      key: '1',
      title: meta.title || (epicMd ? path.basename(epicMd, '.md') : 'Epic 1'),
      goal: mdSection(mdBody, 'Outcome') || undefined,
      dir: baseDir,
      ticketsPath: rootTicketsPath,
      entries: entriesToml,
    });
  } else {
    throw new SdlcError('no_bmad_artifacts', 'No BMAD artifacts found.');
  }

  const epicEntries = new Map<string, string[]>();
  for (const epic of epicSpecs) {
    const keys = epic.entries
      .map((e) => asNumber(e.id))
      .filter((id): id is number => id !== undefined)
      .map((id) => `${epic.key}.${id}`);
    epicEntries.set(epic.key, keys);
    if (epic.slug) epicEntries.set(epic.slug, keys);
  }

  const epics = epicSpecs.map((e) => ({ key: e.key, title: e.title, ...(e.goal ? { goal: e.goal } : {}) }));
  const items: PlanItem[] = [];

  for (const epic of epicSpecs) {
    for (const entry of epic.entries) {
      const entryId = asNumber(entry.id);
      if (entryId === undefined) continue;
      const key = `${epic.key}.${entryId}`;
      const type = asString(entry.type) ?? 'story';
      const kind = KIND_MAP[type] ?? 'feature';
      const title = asString(entry.title) ?? key;
      const outcome = asString(entry.description);
      const risk = asString(entry.risk) as RiskLevel | undefined;
      const leaf = findStoryLeaf(epic.dir, entryId);
      const leafCriteria = leaf ? parseAcceptanceCriteria(readUtf8(leaf)) : [];
      const verify = asString(entry.verify);
      const acceptance = leafCriteria.length ? leafCriteria : (verify ? [verify] : []);
      const dependsOnKeys = expandAfter(entry.after, epic.key, epicEntries);
      items.push({
        key,
        epicKey: epic.key,
        title,
        kind,
        ...(risk ? { risk } : {}),
        ...(outcome ? { outcome } : {}),
        acceptance,
        dependsOnKeys,
        source: `bmad ${relativeTickets(epic.ticketsPath)}#${key}`,
      });
    }
  }

  return { epics, items, unmapped: [], warnings: [] };
}

function planFromDocs(root: string, input: string): BacklogImportPlan {
  const docs = detectBmadDocs(root, input);
  const spec = docs.find((d) => d.kind === 'spec');
  const prd = docs.find((d) => d.kind === 'prd');
  const origin: BmadDoc | undefined = spec ?? prd;
  if (!origin) throw new SdlcError('no_bmad_artifacts', 'No BMAD artifacts found.');
  const body = readUtf8(path.resolve(root, origin.path));
  const requirements = spec
    ? requirementsFromSpec(sections(body))
    : requirementsFromPrd(body);
  const epicKey = origin.path;
  const epics = [{ key: epicKey, title: origin.title }];
  const items: PlanItem[] = requirements.map((req) => ({
    key: req.id,
    epicKey,
    title: req.name,
    kind: 'feature' as ChangeKind,
    outcome: req.intent,
    acceptance: req.successes.length ? req.successes : [req.intent],
    dependsOnKeys: [],
    source: `bmad ${origin.path}#${req.id}`,
  }));
  return { epics, items, unmapped: [], warnings: [] };
}

function hasTicketsToml(start: string): boolean {
  try {
    if (isSymlink(start)) return false;
    if (fs.statSync(start).isFile()) return path.basename(start) === 'tickets.toml';
    const candidate = path.join(start, 'tickets.toml');
    return fs.existsSync(candidate) && !isSymlink(candidate);
  } catch {
    return false;
  }
}

/**
 * Plans backlog items from BMAD artifacts under `input`:
 * - tickets (`tickets.toml`, initiative or single epic) → one epic per BMAD epic,
 *   one item per entry: story → feature, bug → bugfix, spike → chore;
 *   outcome = description; acceptance = the leaf's criteria when a leaf exists,
 *   else `verify`; `after` → dependencies ("epic-<slug>" = every entry of that epic);
 *   source = `bmad <tickets.toml path>#<epic id>.<entry id>`;
 * - otherwise a SPEC (CAP-N → items, acceptance = success) or a PRD
 *   (features → items, acceptance = testable consequences), one epic named
 *   after the document.
 * Nothing is written. No BMAD artifacts → `no_bmad_artifacts`.
 */
export function planBmadBacklog(root: string, input: string): BacklogImportPlan {
  const start = resolveInside(root, input);
  try {
    if (hasTicketsToml(start)) return planFromTickets(root, start);
  } catch (error) {
    if (error instanceof SdlcError && error.code === 'invalid_tickets') throw error;
    // fall through to docs when tickets path is broken / empty
    if (!(error instanceof SdlcError && error.code === 'no_bmad_artifacts')) throw error;
  }
  return planFromDocs(root, input);
}
