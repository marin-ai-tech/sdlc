import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { sha256 } from '../integrations/manifest.js';
import type { PackSource } from './pack-config.js';
import { ROLE_ID } from './role-file.js';

/**
 * Where the agent team lives (B69, B70, B71, B74): accepted roles in `docs/agents/<role>.md`, drafts in
 * `docs/agents/drafts/<role>.md`, and the record of what a person accepted in `openspec/.sdlc/team.json`, written
 * only by the CLI: `{ version: 1, roles: { <id>: { digest, source, version?, server?, checksum?, by, at } },
 * skills: { <id>: { version, checksum, source, server, by, at, dir, files: { <path>: <sha256> }, scripts } },
 * drafts: { <id>: { kind, server?, version?, checksum?, text } } }`. `drafts` keeps each draft as its source gave
 * it, so accepting shows what was changed in it since. A role, a skill or a draft from a pack (B76) also keeps
 * `pack: { pack, git | npm, ref, commit | version, integrity? }`.
 */
export const AGENTS_DIR = 'docs/agents';
export const DRAFTS_DIR = 'docs/agents/drafts';
export const TEAM_PATH = 'openspec/.sdlc/team.json';

export interface TeamEntry {
  digest: string;
  source: string;
  version?: string;
  server?: string;
  checksum?: string;
  pack?: PackSource;
  by: string;
  at: string;
}

export interface SkillEntry {
  version: string;
  checksum: string;
  source: string;
  server: string;
  by: string;
  at: string;
  /** The skill's folder, root-relative (`.claude/skills/<id>`). */
  dir: string;
  /** Each file, relative to `dir`, and the sha256 of its content (newlines normalized) as installed. */
  files: Record<string, string>;
  /** The files that are not Markdown. */
  scripts: string[];
  pack?: PackSource;
}

export interface DraftRecord {
  kind: 'registry' | 'builtin' | 'pack';
  pack?: PackSource;
  server?: string;
  version?: string;
  checksum?: string;
  /** The draft as sdlc wrote it. */
  text: string;
}

export interface TeamRecord {
  version: 1;
  roles: Record<string, TeamEntry>;
  skills: Record<string, SkillEntry>;
  drafts: Record<string, DraftRecord>;
}

export function acceptedPath(id: string): string {
  return `${AGENTS_DIR}/${id}.md`;
}

export function draftPath(id: string): string {
  return `${DRAFTS_DIR}/${id}.md`;
}

/** `sha256:<hex>` of the text with its newlines normalized, as team.json records it. */
export function roleDigest(text: string): string {
  return `sha256:${sha256(text)}`;
}

type Raw = Record<string, unknown>;
/** Where an installed skill may live: a folder of a skills root. */
const SKILL_DIR = /^\.(?:claude|opencode)\/skills\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function object(value: unknown): Raw | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined;
}

function optional(raw: Raw, key: string): Record<string, string> {
  return typeof raw[key] === 'string' ? { [key]: raw[key] as string } : {};
}

const PACK_KEYS = ['pack', 'git', 'npm', 'ref', 'commit', 'version', 'integrity'];

function packField(value: unknown): { pack?: PackSource } {
  const raw = object(value);
  if (!raw || typeof raw.pack !== 'string') return {};
  const fields = PACK_KEYS.flatMap((key) => (typeof raw[key] === 'string' ? [[key, raw[key] as string]] : []));
  return { pack: Object.fromEntries(fields) as unknown as PackSource };
}

function entry(value: unknown): TeamEntry | undefined {
  const raw = object(value);
  if (!raw || typeof raw.digest !== 'string' || typeof raw.source !== 'string') return undefined;
  return {
    digest: raw.digest,
    source: raw.source,
    ...optional(raw, 'version'),
    ...optional(raw, 'server'),
    ...optional(raw, 'checksum'),
    ...packField(raw.pack),
    by: typeof raw.by === 'string' ? raw.by : '',
    at: typeof raw.at === 'string' ? raw.at : '',
  };
}

function fileMap(value: unknown): Record<string, string> {
  const raw = object(value) ?? {};
  const pairs = Object.entries(raw).filter((pair): pair is [string, string] => typeof pair[1] === 'string');
  return Object.fromEntries(pairs);
}

function skillEntry(value: unknown): SkillEntry | undefined {
  const raw = object(value);
  const text = (key: string) => (typeof raw?.[key] === 'string' ? (raw[key] as string) : '');
  if (!raw || !text('checksum') || !SKILL_DIR.test(text('dir'))) return undefined;
  const scripts = Array.isArray(raw.scripts) ? raw.scripts.filter((item) => typeof item === 'string') : [];
  return {
    version: text('version'), checksum: text('checksum'), source: text('source'), server: text('server'),
    by: text('by'), at: text('at'), dir: text('dir'), files: fileMap(raw.files), scripts, ...packField(raw.pack),
  };
}

function draftRecord(value: unknown): DraftRecord | undefined {
  const raw = object(value);
  const kinds = ['registry', 'builtin', 'pack'];
  if (!raw || typeof raw.text !== 'string' || !kinds.includes(String(raw.kind))) return undefined;
  const kind = raw.kind as DraftRecord['kind'];
  return { kind, ...packField(raw.pack), ...optional(raw, 'server'), ...optional(raw, 'version'),
    ...optional(raw, 'checksum'), text: raw.text };
}

function entries<T>(value: unknown, parse: (item: unknown) => T | undefined): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [id, item] of Object.entries(object(value) ?? {})) {
    const parsed = parse(item);
    if (parsed && ROLE_ID.test(id)) out[id] = parsed;
  }
  return out;
}

/** The record; an absent or unreadable file is an empty team (nothing accepted). */
export function readTeam(root: string): TeamRecord {
  const team: TeamRecord = { version: 1, roles: {}, skills: {}, drafts: {} };
  const text = readText(path.join(root, TEAM_PATH));
  if (!text) return team;
  try {
    const raw = object(JSON.parse(text)) ?? {};
    return { version: 1, roles: entries(raw.roles, entry), skills: entries(raw.skills, skillEntry),
      drafts: entries(raw.drafts, draftRecord) };
  } catch {
    return team;
  }
}

function sorted<T>(map: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.keys(map).sort().map((id) => [id, map[id]]));
}

export function writeTeam(root: string, team: TeamRecord): void {
  const skills = Object.keys(team.skills).length > 0 ? { skills: sorted(team.skills) } : {};
  const drafts = Object.keys(team.drafts).length > 0 ? { drafts: sorted(team.drafts) } : {};
  const record = { version: 1, roles: sorted(team.roles), ...skills, ...drafts };
  writeTextAtomic(path.join(root, TEAM_PATH), `${JSON.stringify(record, null, 2)}\n`);
}

/** Role ids of the `*.md` files directly in `dir` (root-relative), sorted. */
export function roleIdsIn(root: string, dir: string): string[] {
  try {
    const found = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
    const names = found.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.slice(0, -3));
    return names.filter((name) => ROLE_ID.test(name)).sort();
  } catch {
    return [];
  }
}
