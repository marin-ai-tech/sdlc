import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { normalizeNewlines } from '../core/fs-utils.js';
import type { Locale } from '../core/i18n.js';
import { packDraft, withoutSource } from './draft.js';
import { isGitPack, npmSpecFloats, type PackConfig, type PackSource } from './pack-config.js';
import { cachedPack, fetchPack, type FetchedPack } from './pack-fetch.js';
import { failure } from './registry-client.js';
import { parseRoleFile, ROLE_ID } from './role-file.js';
import type { RoleDraft } from './sources.js';
import type { Refused } from './sync.js';
import {
  isSkillId, LIMITS, roleChecksum, skillChecksum, vetSkill, type RegistrySkill, type SkillFile, type Vetted,
} from './vetting.js';

/**
 * Packs (B76): roles and skills a company keeps in a git repository or an npm package, read by `sdlc team sync`
 * after the team registry and before the built-ins. A pack holds `roles/<id>.md` (or `roles/<locale>/<id>.md`, which
 * wins for the project's locale) in the format of the built-in roles, and `skills/<id>/...`. Everything is read from
 * the cache as plain files: symlinks are not followed, sizes, ids and skill paths are vetted as for the registry
 * (`vetting.ts`), and a role that fails its check is refused so the next source takes its place.
 */
export interface PackReport {
  name: string;
  roles: string[];
  skills: string[];
  source?: PackSource;
  error?: string;
  warning?: string;
}

export interface PackDrafts {
  drafts: RoleDraft[];
  reports: PackReport[];
  refused: Refused[];
}

export interface PackSkill {
  skill: Vetted<RegistrySkill>;
  source: PackSource;
}

interface Loaded {
  report: PackReport;
  fetched?: FetchedPack;
}

const FLOATING = 'the npm spec is a bare name, a range or a dist-tag: pin an exact version';

/** True for a real folder; a symlink to one is not followed. */
function realDir(dir: string): boolean {
  try {
    return fs.lstatSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/** The entries of a real folder, sorted; none for a missing folder or a link. */
function entries(dir: string): fs.Dirent[] {
  if (!realDir(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

function skillIds(dir: string): string[] {
  return entries(path.join(dir, 'skills')).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

function loadPack(root: string, pack: PackConfig, fresh: boolean): Loaded {
  const floats = !isGitPack(pack) && npmSpecFloats(pack.npm);
  const report: PackReport = { name: pack.name, roles: [], skills: [], ...(floats ? { warning: FLOATING } : {}) };
  try {
    const fetched = (fresh ? undefined : cachedPack(root, pack)) ?? fetchPack(root, pack);
    report.source = fetched.source;
    report.skills = skillIds(fetched.dir);
    return { report, fetched };
  } catch (error) {
    report.error = failure(error);
    return { report };
  }
}

/** The role files of the pack: `roles/<id>.md`, replaced by `roles/<locale>/<id>.md` where the locale has one. */
function roleFiles(dir: string, locale: Locale): Map<string, string> {
  const files = new Map<string, string>();
  for (const folder of [path.join(dir, 'roles'), path.join(dir, 'roles', locale)]) {
    const found = entries(folder).filter((entry) => entry.isFile() && entry.name.endsWith('.md'));
    for (const entry of found) files.set(entry.name.slice(0, -3), path.join(folder, entry.name));
  }
  return files;
}

function roleProblem(id: string, text: string): string | undefined {
  if (!/^---\n[\s\S]*?\n---\n/.test(text)) return 'no front matter';
  const role = parseRoleFile(id, text);
  if (role.declaredId !== undefined && role.declaredId !== id) return `declares the role id ${role.declaredId}`;
  if (role.skills.some((skill) => !isSkillId(skill))) return 'skills must be skill ids';
  return undefined;
}

/** A role file of a pack as a draft recording the pack, or the reason it is refused. */
function packRole(id: string, file: string, source: PackSource): RoleDraft | Refused {
  const refuse = (reason: string): Refused => ({ id: id.slice(0, 64), reason: `pack ${source.pack}: ${reason}` });
  if (!ROLE_ID.test(id)) return refuse('not a role id');
  if (fs.lstatSync(file).size > LIMITS.roleBytes) return refuse(`larger than ${LIMITS.roleBytes} bytes`);
  const raw = normalizeNewlines(fs.readFileSync(file, 'utf8')).replace(/^\uFEFF/, '');
  const text = withoutSource(raw);
  const problem = roleProblem(id, text);
  if (problem) return refuse(problem);
  const version = source.commit ?? source.version;
  return { id, text: packDraft(text, source), source: 'pack', version, checksum: roleChecksum(text), pack: source };
}

function addRoles(loaded: Loaded, locale: Locale, out: PackDrafts, seen: Set<string>): void {
  if (!loaded.fetched) return;
  const { dir, source } = loaded.fetched;
  for (const [id, file] of roleFiles(dir, locale)) {
    if (seen.has(id)) continue;
    const draft = packRole(id, file, source);
    if ('reason' in draft) {
      out.refused.push(draft);
      continue;
    }
    seen.add(id);
    out.drafts.push(draft);
    loaded.report.roles.push(id);
  }
}

/** Every pack fetched afresh, in the order of the config; the first pack that has a role id wins. */
export function packDrafts(root: string, config: SdlcConfig, locale: Locale): PackDrafts {
  const out: PackDrafts = { drafts: [], reports: [], refused: [] };
  const seen = new Set<string>();
  for (const pack of config.packs ?? []) {
    const loaded = loadPack(root, pack, true);
    out.reports.push(loaded.report);
    addRoles(loaded, locale, out, seen);
  }
  return out;
}

/** The plain files under a skill folder (links and anything else skipped), or why there are too many. */
function walkFiles(folder: string): Vetted<Array<{ rel: string; abs: string }>> {
  const found: Array<{ rel: string; abs: string }> = [];
  const stack = [{ abs: folder, rel: '' }];
  while (stack.length > 0) {
    const current = stack.pop() as { abs: string; rel: string };
    for (const entry of entries(current.abs)) {
      const rel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const item = { abs: path.join(current.abs, entry.name), rel };
      if (entry.isDirectory()) stack.push(item);
      else if (entry.isFile()) found.push(item);
    }
    if (found.length > LIMITS.files) return { reason: `more than ${LIMITS.files} files` };
  }
  return { ok: found };
}

/** A skill folder of a pack, checked like a registry skill (ids, paths, sizes, SKILL.md). */
function packSkill(id: string, folder: string, version: string): Vetted<RegistrySkill> {
  if (!isSkillId(id)) return { reason: 'not a skill id (lower-case words joined by -, not sdlc-*)' };
  const walked = walkFiles(folder);
  if (!('ok' in walked)) return walked;
  const big = walked.ok.find((file) => fs.lstatSync(file.abs).size > LIMITS.fileBytes);
  if (big) return { reason: `${big.rel} larger than ${LIMITS.fileBytes} bytes` };
  const files: SkillFile[] = walked.ok.map((file) => ({ path: file.rel, content: fs.readFileSync(file.abs, 'utf8') }));
  return vetSkill({ id, version, title: id, files, checksum: skillChecksum(files) }, id);
}

function addSkills(loaded: Loaded, wanted: string[], out: Record<string, PackSkill>): void {
  if (!loaded.fetched) return;
  const { dir, source } = loaded.fetched;
  const have = new Set(skillIds(dir));
  const version = source.commit ?? source.version ?? '0';
  for (const id of wanted.filter((item) => have.has(item))) {
    out[id] = { skill: packSkill(id, path.join(dir, 'skills', id), version), source };
  }
}

/**
 * The skills `ids` from the packs (the cached copy of each pack when its config entry is unchanged, else fetched);
 * the first pack whose copy of a skill passes its check wins.
 */
export function packSkills(root: string, config: SdlcConfig, ids: string[]): Record<string, PackSkill> {
  const out: Record<string, PackSkill> = {};
  for (const pack of config.packs ?? []) {
    const wanted = ids.filter((id) => !out[id] || !('ok' in out[id].skill));
    if (wanted.length === 0) break;
    addSkills(loadPack(root, pack, false), wanted, out);
  }
  return out;
}
