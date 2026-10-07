import { createHash } from 'node:crypto';
import { ROLE_ID } from './role-file.js';

/**
 * What a team registry answers is checked before anything of it reaches the agents (B71, B74). A role's checksum
 * is `sha256:` + sha256 of its body; a skill's is `sha256:` + sha256 of its files sorted by path, each
 * `<path>\n<content>\n`, concatenated. A mismatch, a malformed answer, an oversized item, or a skill file path
 * that would leave the skill folder refuses the item; the reason says which.
 */
export interface SkillFile {
  path: string;
  content: string;
}

export interface RegistryRole {
  id: string;
  version: string;
  title: string;
  stages: string[];
  tools: string[];
  readonly: boolean;
  skills: string[];
  body: string;
  checksum: string;
}

export interface RegistrySkill {
  id: string;
  version: string;
  title: string;
  files: SkillFile[];
  checksum: string;
}

export type Vetted<T> = { ok: T } | { reason: string };

/** Limits on what a registry may hand over. */
export const LIMITS = { roleBytes: 256 * 1024, fileBytes: 256 * 1024, files: 64, skillBytes: 1024 * 1024 };
/** Skill names starting with `sdlc-` are the generated workflow skills: a registry may not take their place. */
const RESERVED_SKILL = /^sdlc(?:-|$)/;
const PATH_MAX = 200;
const WINDOWS_DEVICE = /^(?:con|prn|aux|nul|com\d|lpt\d)(?:\..*)?$/i;

export function sha256Of(text: string): string {
  return `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;
}

export function roleChecksum(body: string): string {
  return sha256Of(body);
}

/** Files sorted by path (`localeCompare` in `en`), each `<path>\n<content>\n`, concatenated, hashed. */
export function skillChecksum(files: readonly SkillFile[]): string {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return sha256Of(sorted.map((file) => `${file.path}\n${file.content}\n`).join(''));
}

/** Why `rel` may not be a file of a skill folder (absolute, a drive, `..`, a backslash...), or undefined when safe. */
export function unsafeSkillPath(rel: string): string | undefined {
  if (rel.length === 0 || rel.length > PATH_MAX) return 'empty or too long';
  if (/[\\\0:]/.test(rel) || /[\x00-\x1f]/.test(rel)) return 'backslash, colon or control character';
  if (rel.startsWith('/') || rel.startsWith('~')) return 'absolute path';
  const parts = rel.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return 'empty, `.` or `..` segment';
  if (parts.some((part) => /[. ]$/.test(part))) return 'a segment ends with a dot or a space';
  if (parts.some((part) => WINDOWS_DEVICE.test(part))) return 'a Windows device name';
  return undefined;
}

export function isMarkdown(rel: string): boolean {
  return /\.md$/i.test(rel);
}

/** The files of a skill that are not Markdown (scripts, binaries): they wait for a person. */
export function scriptsOf(files: readonly SkillFile[]): string[] {
  return files.map((file) => file.path).filter((rel) => !isMarkdown(rel)).sort();
}

export function isSkillId(id: string): boolean {
  return ROLE_ID.test(id) && !RESERVED_SKILL.test(id);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? (value as string[]) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8');

function roleShape(raw: Record<string, unknown>, id: string): Vetted<RegistryRole> {
  const version = str(raw.version);
  const body = typeof raw.body === 'string' ? raw.body : undefined;
  const checksum = str(raw.checksum);
  if (raw.id !== id) return { reason: `answer is for another id (${String(raw.id)})` };
  if (!version || body === undefined || !checksum) return { reason: 'version, body or checksum missing' };
  if (version.length > 64 || !/^[\w.+-]+$/.test(version)) return { reason: 'version is not a plain version string' };
  const skills = strings(raw.skills ?? []);
  if (!skills || skills.some((skill) => !isSkillId(skill))) return { reason: 'skills must be skill ids' };
  const role = {
    id, version, body, checksum, skills, title: str(raw.title) ?? id, stages: strings(raw.stages) ?? [],
    tools: strings(raw.tools) ?? [], readonly: raw.readonly !== false,
  };
  return { ok: role };
}

/** A `get_role` answer for `id`, checked: shape, size and checksum (also against what `list_roles` listed). */
export function vetRole(answer: unknown, id: string, listed?: unknown): Vetted<RegistryRole> {
  const raw = record(answer);
  if (!raw) return { reason: 'answer is not an object' };
  const shaped = roleShape(raw, id);
  if (!('ok' in shaped)) return shaped;
  const role = shaped.ok;
  if (bytes(role.body) > LIMITS.roleBytes) return { reason: `body larger than ${LIMITS.roleBytes} bytes` };
  const actual = roleChecksum(role.body);
  if (actual !== role.checksum) return { reason: `checksum mismatch: the body hashes to ${actual}` };
  if (typeof listed === 'string' && listed !== role.checksum) return { reason: 'checksum differs from list_roles' };
  return { ok: role };
}

function vetFiles(value: unknown): Vetted<SkillFile[]> {
  if (!Array.isArray(value) || value.length === 0) return { reason: 'files missing' };
  if (value.length > LIMITS.files) return { reason: `more than ${LIMITS.files} files` };
  const files: SkillFile[] = [];
  for (const item of value) {
    const raw = record(item);
    if (!raw || typeof raw.path !== 'string' || typeof raw.content !== 'string') return { reason: 'malformed file' };
    const unsafe = unsafeSkillPath(raw.path);
    if (unsafe) return { reason: `file path ${JSON.stringify(raw.path)} leaves the skill folder: ${unsafe}` };
    if (bytes(raw.content) > LIMITS.fileBytes) return { reason: `${raw.path} larger than ${LIMITS.fileBytes} bytes` };
    files.push({ path: raw.path, content: raw.content });
  }
  return { ok: files };
}

function filesProblem(files: SkillFile[]): string | undefined {
  const paths = files.map((file) => file.path.toLowerCase());
  if (new Set(paths).size !== paths.length) return 'two files with the same path';
  if (paths.some((rel) => paths.some((other) => other.startsWith(`${rel}/`)))) return 'a file path is also a folder';
  if (!paths.includes('skill.md')) return 'no SKILL.md';
  const total = files.reduce((sum, file) => sum + bytes(file.content), 0);
  return total > LIMITS.skillBytes ? `files larger than ${LIMITS.skillBytes} bytes together` : undefined;
}

/** A `get_skill` answer for `id`, checked: shape, paths, size and checksum. */
export function vetSkill(answer: unknown, id: string): Vetted<RegistrySkill> {
  const raw = record(answer);
  if (!raw) return { reason: 'answer is not an object' };
  if (raw.id !== id) return { reason: `answer is for another id (${String(raw.id)})` };
  const version = str(raw.version);
  const checksum = str(raw.checksum);
  if (!version || !checksum) return { reason: 'version or checksum missing' };
  if (version.length > 64 || !/^[\w.+-]+$/.test(version)) return { reason: 'version is not a plain version string' };
  const files = vetFiles(raw.files);
  if (!('ok' in files)) return files;
  const problem = filesProblem(files.ok);
  if (problem) return { reason: problem };
  const actual = skillChecksum(files.ok);
  if (actual !== checksum) return { reason: `checksum mismatch: the files hash to ${actual}` };
  return { ok: { id, version, checksum, title: str(raw.title) ?? id, files: files.ok } };
}
