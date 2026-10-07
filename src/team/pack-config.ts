import { SdlcError } from '../core/errors.js';
import { ROLE_ID } from './role-file.js';

/**
 * `packs` in openspec/sdlc.yaml (B76): `{ name, git, ref }` (a repository at a tag, a branch or a commit) or
 * `{ name, npm }` (an npm spec; an exact version is recommended). Parsed into typed entries here; config.ts only
 * calls `parsePacksConfig`. A name is kebab-case and unique, a git pack needs its ref. Nothing is fetched here
 * (`src/team/pack-fetch.ts` does that); a URL, a ref or a spec that could pass for a command-line option is refused.
 */
export interface GitPackConfig {
  name: string;
  git: string;
  ref: string;
}

export interface NpmPackConfig {
  name: string;
  npm: string;
}

export type PackConfig = GitPackConfig | NpmPackConfig;

/** Where a draft, an accepted role or an installed skill of a pack came from, as drafts and team.json record it. */
export interface PackSource {
  pack: string;
  git?: string;
  npm?: string;
  ref?: string;
  commit?: string;
  version?: string;
  integrity?: string;
}

/** The git transports sdlc fetches with: https, http, ssh, git, file, or the scp-like `user@host:path`. */
const GIT_URL = /^(?:(?:https?|ssh|git|file):\/\/[^\s]+|[\w.-]+@[\w.-]+:[^\s]+)$/;
/** A tag, a branch or a commit: no leading `-`, no `..`, no spaces or shell characters. */
const GIT_REF = /^[A-Za-z0-9_][\w./-]*$/;
const CONTROL = /[\x00-\x1f\x7f]/;
const SPEC_MAX = 300;

function invalid(key: string, where: string, extra: Record<string, string> = {}): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}

function field(raw: Record<string, unknown>, key: string, where: string): string | undefined {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim() === '') throw invalid('error.x_must_be_a_non_empty_string', where);
  return value.trim();
}

function checked(value: string, where: string, ok: boolean): string {
  const safe = ok && value.length <= SPEC_MAX && !value.startsWith('-') && !CONTROL.test(value);
  if (!safe) throw invalid('error.pack_x_not_accepted', where, { value: JSON.stringify(value.slice(0, 80)) });
  return value;
}

function gitPack(name: string, url: string, raw: Record<string, unknown>, at: string): GitPackConfig {
  const ref = field(raw, 'ref', `${at}.ref`);
  if (ref === undefined) throw invalid('error.pack_x_needs_ref', at);
  const git = checked(url, `${at}.git`, GIT_URL.test(url));
  return { name, git, ref: checked(ref, `${at}.ref`, GIT_REF.test(ref) && !ref.includes('..')) };
}

function parsePack(value: unknown, at: string): PackConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', at);
  const raw = value as Record<string, unknown>;
  const name = field(raw, 'name', `${at}.name`) ?? '';
  if (!ROLE_ID.test(name)) throw invalid('error.pack_name_x_not_kebab', `${at}.name`, { name });
  const git = field(raw, 'git', `${at}.git`);
  const npm = field(raw, 'npm', `${at}.npm`);
  if ((git === undefined) === (npm === undefined)) throw invalid('error.pack_x_git_or_npm', at);
  if (git !== undefined) return gitPack(name, git, raw, at);
  return { name, npm: checked(npm ?? '', `${at}.npm`, true) };
}

/** `packs`: absent = none. Each entry checked; a name used twice is a config error naming it. */
export function parsePacksConfig(value: unknown, where: (key: string) => string): PackConfig[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw invalid('error.x_must_be_a_list', where('packs'));
  const packs = value.map((item, index) => parsePack(item, where(`packs[${index}]`)));
  const seen = new Set<string>();
  for (const pack of packs) {
    if (seen.has(pack.name)) throw invalid('error.pack_name_x_twice', where('packs'), { name: pack.name });
    seen.add(pack.name);
  }
  return packs;
}

export function isGitPack(pack: PackConfig): pack is GitPackConfig {
  return 'git' in pack;
}

const NPM_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/;
const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * True when an npm spec names a registry package without an exact version (a bare name, a range or a dist-tag):
 * what it brings can change without the config changing. Paths, tarballs and git specs are not registry names.
 */
export function npmSpecFloats(spec: string): boolean {
  const at = spec.lastIndexOf('@');
  const scoped = spec.startsWith('@');
  const cut = at > (scoped ? 0 : -1) ? at : -1;
  const name = cut === -1 ? spec : spec.slice(0, cut);
  if (!NPM_NAME.test(name)) return false;
  return cut === -1 || !EXACT.test(spec.slice(cut + 1));
}
