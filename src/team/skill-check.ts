import * as path from 'node:path';
import { parse } from 'yaml';
import type { SdlcConfig } from '../core/config.js';
import { listFilesRecursive, normalizeNewlines, readText } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { sha256 } from '../integrations/manifest.js';
import { acceptedRoles } from './accepted.js';
import { parseRoleFile } from './role-file.js';
import { DRAFTS_DIR, draftPath, readTeam, roleIdsIn, skillDirs, type SkillEntry } from './record.js';
import { fetchSkills, teamSkillTargets, type SkillFetch } from './skills.js';
import { dataOf, needsPerson, scriptsOf, unsafeSkillPath, type SkillFile } from './vetting.js';

/**
 * `sdlc team check` (B74): every skill the accepted roles list (and every installed one), with its version, source,
 * whether its files are still what was checked, whether it is installed or waits for a person, its scripts, the tools
 * its `allowed-tools` grants and the URLs it names. A grant of unrestricted shell or file writes is a warning.
 * Since B86 a skill counts as installed when it is installed for every configured tool: each of their skills folders
 * has its recorded copy, and every copy is checked.
 */
export interface SkillCheck {
  id: string;
  version: string | null;
  source: string;
  checksumOk: boolean;
  installed: boolean;
  needsAcceptance: boolean;
  scripts: string[];
  data: string[];
  allowedTools: string[];
  urls: string[];
  urlCount: number;
  warnings: string[];
  reason?: string;
}

export interface TeamCheck {
  skills: SkillCheck[];
  drafts: DraftCheck[];
  warnings: string[];
  error?: string;
}

export type DraftSkill = { id: string; status: 'installable' }
  | { id: string; status: 'installed' }
  | { id: string; status: 'unavailable'; reason: string }
  | { id: string; status: 'waits-for-person'; scripts: string[]; data: string[] }
  | { id: string; status: 'refused'; reason: string };

export interface DraftCheck {
  role: string;
  skills: DraftSkill[];
}

/** A grant without a limit: the tool alone, or with `*`, `**`, `:*` or `/**` as its only pattern. */
const UNRESTRICTED = /^(?:bash|shell|write|edit|multiedit|notebookedit)(?:\((?:|\*|\*\*|:\*|\/\*\*|\.\/\*\*)\))?$/i;
const URL = /https?:\/\/[^\s<>"'`)\]]+/g;
const FRONT = /^---\n([\s\S]*?)\n---/;

/** Splits `Bash(npm run lint) Read, Grep` at commas and spaces outside parentheses. */
function splitTools(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of value) {
    depth = Math.max(0, depth + (char === '(' ? 1 : char === ')' ? -1 : 0));
    const cut = depth === 0 && (char === ',' || /\s/.test(char));
    if (!cut) current += char;
    else if (current) out.push(current);
    if (cut) current = '';
  }
  return current ? [...out, current] : out;
}

/** The tools `allowed-tools` of the skill's SKILL.md grants. */
export function allowedToolsOf(files: readonly SkillFile[]): string[] {
  const skill = files.find((file) => file.path.toLowerCase() === 'skill.md');
  const match = skill ? normalizeNewlines(skill.content).match(FRONT) : null;
  if (!match) return [];
  try {
    const value = (parse(match[1]) as Record<string, unknown> | null)?.['allowed-tools'];
    if (Array.isArray(value)) return value.map(String).flatMap(splitTools);
    return typeof value === 'string' ? splitTools(value) : [];
  } catch {
    return [];
  }
}

export function isUnrestricted(tool: string): boolean {
  return UNRESTRICTED.test(tool.trim());
}

function urlsOf(files: readonly SkillFile[]): string[] {
  return [...new Set(files.flatMap((file) => file.content.match(URL) ?? []))].sort();
}

type State = Pick<SkillCheck, 'version' | 'source' | 'checksumOk' | 'installed' | 'needsAcceptance'>;

function described(id: string, files: readonly SkillFile[], state: State, problems: string[]): SkillCheck {
  const allowedTools = allowedToolsOf(files);
  const grants = allowedTools.filter(isUnrestricted).map((tool) => t('team.check.unrestricted', { id, tool }));
  const warnings = [...problems, ...grants];
  const urls = urlsOf(files);
  return { id, ...state, scripts: scriptsOf(files), data: dataOf(files), allowedTools,
    urls, urlCount: urls.length, warnings };
}

/** Files in the skill's folder `dir` that team.json does not list. */
function extraFiles(root: string, dir: string, entry: SkillEntry): string[] {
  const found = listFilesRecursive(path.join(root, dir)).map((rel) => rel.replace(/\\/g, '/'));
  return found.filter((rel) => !(rel in entry.files)).sort();
}

/** The path of a file of a copy in a message: as before for a single copy, with its folder for several. */
function shown(dir: string, rel: string, several: boolean): string {
  return several ? `${dir}/${rel}` : rel;
}

/** One copy of the skill checked against team.json: its problems; its files go to `files` for the first copy. */
function copyProblems(root: string, id: string, entry: SkillEntry, copy: { dir: string; several: boolean },
  files: SkillFile[] | undefined): string[] {
  const problems: string[] = [];
  for (const rel of Object.keys(entry.files).sort()) {
    const content = unsafeSkillPath(rel) ? undefined : readText(path.join(root, copy.dir, rel));
    const where = shown(copy.dir, rel, copy.several);
    if (content === undefined) problems.push(t('team.check.missing', { id, path: where }));
    else if (sha256(content) !== entry.files[rel]) problems.push(t('team.check.edited', { id, path: where }));
    if (content !== undefined) files?.push({ path: rel, content });
  }
  const extra = extraFiles(root, copy.dir, entry).map((rel) => shown(copy.dir, rel, copy.several));
  if (extra.length > 0) problems.push(t('team.check.extra', { id, list: extra.join(', ') }));
  return problems;
}

/** The copies to check: the recorded folders of the configured tools; the recorded ones if no tool is configured. */
function checkedDirs(entry: SkillEntry, targets: string[]): string[] {
  const recorded = skillDirs(entry);
  if (targets.length === 0) return recorded;
  return targets.filter((dir) => recorded.includes(dir));
}

function installedCheck(root: string, id: string, entry: SkillEntry, targets: string[]): SkillCheck {
  const files: SkillFile[] = [];
  const dirs = checkedDirs(entry, targets);
  const several = dirs.length > 1;
  const problems = dirs.flatMap((dir, index) =>
    copyProblems(root, id, entry, { dir, several }, index === 0 ? files : undefined));
  const installed = dirs.length > 0 && targets.every((dir) => dirs.includes(dir));
  const state = { version: entry.version, source: entry.source, checksumOk: problems.length === 0,
    installed, needsAcceptance: false };
  const missing = targets.filter((dir) => !dirs.includes(dir));
  const reason = missing.length > 0 ? { reason: `not installed in ${missing.join(', ')}` } : {};
  return { ...described(id, files, state, problems), ...reason };
}

function remoteCheck(id: string, fetched: SkillFetch): SkillCheck {
  const vetted = Object.hasOwn(fetched.skills, id) ? fetched.skills[id] : undefined;
  const source = fetched.origins[id]?.source ?? 'registry';
  const failed = { version: null, source, checksumOk: false, installed: false, needsAcceptance: false };
  if (!vetted) return { ...described(id, [], failed, []), reason: fetched.error ?? 'not fetched' };
  if (!('ok' in vetted)) return { ...described(id, [], failed, []), reason: vetted.reason };
  const skill = vetted.ok;
  const needsAcceptance = needsPerson(skill.files);
  const state = { version: skill.version, source, checksumOk: true, installed: false, needsAcceptance };
  return described(id, skill.files, state, []);
}

function draftSkill(id: string, fetched: SkillFetch, installed: boolean): DraftSkill {
  if (installed) return { id, status: 'installed' };
  if (!Object.hasOwn(fetched.skills, id)) {
    return { id, status: 'unavailable', reason: fetched.error ?? 'not fetched' };
  }
  const vetted = fetched.skills[id];
  if (!('ok' in vetted)) return { id, status: 'refused', reason: vetted.reason };
  const scripts = scriptsOf(vetted.ok.files);
  const data = dataOf(vetted.ok.files);
  return needsPerson(vetted.ok.files) ? { id, status: 'waits-for-person', scripts, data }
    : { id, status: 'installable' };
}

function draftRoles(root: string): Array<{ role: string; ids: string[] }> {
  return roleIdsIn(root, DRAFTS_DIR).map((id) => {
    const text = readText(path.join(root, draftPath(id))) ?? '';
    return { role: id, ids: parseRoleFile(id, text).skills };
  });
}

/** The check of every skill of the team; the registry (then the packs) is asked only for the skills not installed. */
export async function checkTeamSkills(root: string, config: SdlcConfig): Promise<TeamCheck> {
  const team = readTeam(root);
  const listedIds = acceptedRoles(root).flatMap((role) => role.skills);
  const roles = draftRoles(root);
  const ids = [...new Set([...listedIds, ...Object.keys(team.skills)])].sort();
  const draftIds = roles.flatMap((role) => role.ids);
  const missing = [...new Set([...ids.filter((id) => !Object.hasOwn(team.skills, id)),
    ...draftIds.filter((id) => !Object.hasOwn(team.skills, id))])];
  const none: SkillFetch = { skills: {}, origins: {} };
  const fetched = missing.length > 0 ? await fetchSkills(root, config, missing) : none;
  const check = (id: string) => {
    const entry = Object.hasOwn(team.skills, id) ? team.skills[id] : undefined;
    return entry ? installedCheck(root, id, entry, teamSkillTargets(config, id)) : remoteCheck(id, fetched);
  };
  const skills = ids.map(check);
  const drafts = roles.map(({ role, ids: roleIds }) => ({
    role, skills: roleIds.map((id) => draftSkill(id, fetched, Object.hasOwn(team.skills, id))),
  }));
  const warnings = skills.flatMap((skill) => skill.warnings);
  return { skills, drafts, warnings, ...(fetched.error ? { error: fetched.error } : {}) };
}
