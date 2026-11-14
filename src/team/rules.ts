import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import { stackIds } from '../core/adopt.js';
import type { SdlcConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { failure, listed, registryServer, RegistryItemError, withRegistry, type RegistryCall } from './registry-client.js';
import { ROLE_ID } from './role-file.js';

/**
 * Team rules from the registry (0.32.0): `list_rules` -> `{ rules: [{ id, version, tags?, paths?, checksum }] }` and
 * `get_rule { id }` -> `{ id, version, title?, description, paths?, tags, body, checksum }`, checksum = `sha256:` of
 * the body. A registry without these tools has no rules. `team sync` proposes the rules that fit the project (tag
 * `sdlc`, a stack tag, a `paths` glob matching a file); a person accepts one with `team accept --rule`.
 */
export const RULES_START = '<!-- sdlc:rules:start -->';
export const RULES_END = '<!-- sdlc:rules:end -->';
const MAX_BODY = 64 * 1024;
const MAX_WALK = 5000;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', 'openspec']);

export interface RegistryRule {
  id: string;
  version: string;
  description: string;
  tags: string[];
  paths?: string[];
  body: string;
  checksum: string;
}

export interface RuleListing {
  id: string;
  tags: string[];
  paths?: string[];
}

export interface RuleProposals {
  proposed: Array<{ id: string; reason: string }>;
  other: Array<{ id: string }>;
}

export function ruleChecksum(body: string): string {
  return `sha256:${createHash('sha256').update(body, 'utf8').digest('hex')}`;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
}

function pathsOf(value: unknown, id: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  const list = strings(value);
  if (!Array.isArray(value) || list.length === 0 || list.length !== value.length) {
    throw new RegistryItemError(`${id}: paths must be a non-empty list of file patterns`);
  }
  return list;
}

/** A rule as the registry gave it, checked: id, body size, no rules-block marker inside, the checksum. */
export function vetRule(raw: unknown, id: string): RegistryRule {
  const item = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const body = typeof item.body === 'string' ? item.body : '';
  if (item.id !== id || !ROLE_ID.test(id)) throw new RegistryItemError(`${id}: the registry answered another id`);
  if (body.trim() === '' || Buffer.byteLength(body, 'utf8') > MAX_BODY) {
    throw new RegistryItemError(`${id}: the body is empty or larger than 64 KiB`);
  }
  if (body.includes(RULES_START) || body.includes(RULES_END)) {
    throw new RegistryItemError(`${id}: the body contains the rules block markers`);
  }
  if (item.checksum !== ruleChecksum(body)) throw new RegistryItemError(`${id}: the checksum does not match the body`);
  const paths = pathsOf(item.paths, id);
  return {
    id,
    version: typeof item.version === 'string' ? item.version : '',
    description: typeof item.description === 'string' ? item.description : '',
    tags: strings(item.tags),
    ...(paths ? { paths } : {}),
    body,
    checksum: item.checksum,
  };
}

function listing(item: Record<string, unknown>): RuleListing | undefined {
  const id = typeof item.id === 'string' ? item.id : '';
  if (!ROLE_ID.test(id)) return undefined;
  const paths = strings(item.paths);
  return { id, tags: strings(item.tags), ...(paths.length > 0 ? { paths } : {}) };
}

/** The rules the registry lists; none when it has no rules tools. */
async function listRules(call: RegistryCall): Promise<RuleListing[]> {
  try {
    const answer = await call('list_rules');
    return listed(answer, 'rules').flatMap((item) => listing(item) ?? []);
  } catch (error) {
    if (error instanceof RegistryItemError) return [];
    throw error;
  }
}

/** The project's files (root-relative, posix), bounded; generated and dependency folders are skipped. */
function projectFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    if (out.length >= MAX_WALK) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      const folder = entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.');
      if (folder) walk(path.join(dir, entry.name), next);
      else if (entry.isFile()) out.push(next);
      if (out.length >= MAX_WALK) return;
    }
  };
  walk(root, '');
  return out;
}

/** Why a rule fits the project, or undefined. */
function fitReason(rule: RuleListing, stacks: string[], files: string[]): string | undefined {
  if (rule.tags.includes('sdlc')) return 'tag sdlc';
  const stack = rule.tags.find((tag) => stacks.includes(tag));
  if (stack) return `stack ${stack}`;
  for (const glob of rule.paths ?? []) {
    const match = picomatch(glob, { dot: true });
    const file = files.find((candidate) => match(candidate));
    if (file) return `paths ${glob} (${file})`;
  }
  return undefined;
}

export function proposeRules(root: string, rules: RuleListing[]): RuleProposals {
  const stacks = stackIds(root);
  const files = projectFiles(root);
  const proposals: RuleProposals = { proposed: [], other: [] };
  for (const rule of rules) {
    const reason = fitReason(rule, stacks, files);
    if (reason) proposals.proposed.push({ id: rule.id, reason });
    else proposals.other.push({ id: rule.id });
  }
  return proposals;
}

export interface RulesSync {
  server?: string;
  proposed: RuleProposals['proposed'];
  other: RuleProposals['other'];
  error?: string;
}

/** For `team sync`: the registry's rules sorted into proposed and other; nothing without a registry. */
export async function syncRules(root: string, config: SdlcConfig): Promise<RulesSync | undefined> {
  const server = registryServer(config);
  if (!server) return undefined;
  try {
    const rules = await withRegistry(server, listRules);
    return { server: server.name, ...proposeRules(root, rules) };
  } catch (error) {
    return { server: server.name, proposed: [], other: [], error: failure(error) };
  }
}

/** One rule from the registry, checked; a person's `team accept --rule` reads it fresh. */
export async function fetchRule(config: SdlcConfig, id: string): Promise<{ rule: RegistryRule; server: string }> {
  const server = registryServer(config);
  if (!server) {
    throw new SdlcError('no_registry', { key: 'error.team_rule_no_registry', params: { rule: id } });
  }
  try {
    const rule = await withRegistry(server, async (call) => vetRule(await call('get_rule', { id }), id));
    return { rule, server: server.name };
  } catch (error) {
    throw new SdlcError('rule_refused', { key: 'error.team_rule_refused', params: { rule: id, reason: failure(error) } });
  }
}
