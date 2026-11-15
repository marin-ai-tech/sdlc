import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import { stackIds } from '../core/adopt.js';
import type { SdlcConfig } from '../core/config.js';
import {
  failure, listed, registryServer, RegistryItemError, RegistryToolsMissing, withRegistry, type RegistryCall,
} from './registry-client.js';
import { ROLE_ID } from './role-file.js';

/**
 * Team rules from the registry (0.32.0): `list_rules` -> `{ rules: [{ id, version, tags?, paths?, checksum }] }` and
 * `get_rule { id }` -> `{ id, version, title?, description, paths?, tags, body, checksum }`, checksum = `sha256:` of
 * the body. A registry without these tools has no rules. `team sync` lists them and says which fit the project (tag
 * `sdlc`, a stack tag, a `paths` glob matching a file); `team check` checks each one. Since 0.32.1 (B317) SkillForge
 * installs them (`skillforge sync --type rule --runtime <tool>`) and sdlc writes no rule text anywhere.
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
  version: string;
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

/** Review F9: what the registry lists is printed to a person's terminal; control characters never reach it. */
function printable(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').slice(0, max);
}

function listing(item: Record<string, unknown>): RuleListing | undefined {
  const id = typeof item.id === 'string' ? item.id : '';
  if (!ROLE_ID.test(id)) return undefined;
  const paths = strings(item.paths).map((glob) => printable(glob, 200));
  const version = typeof item.version === 'string' ? printable(item.version, 64) : '';
  return { id, version, tags: strings(item.tags), ...(paths.length > 0 ? { paths } : {}) };
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

/** The tools SkillForge installs rules for, with its `--runtime` name (B317). */
const SKILLFORGE_RUNTIMES = ['claude', 'cursor', 'opencode'] as const;

/** The line a person runs to install the registry's rules for each configured tool SkillForge serves. */
export function installLines(config: SdlcConfig): string[] {
  return SKILLFORGE_RUNTIMES.filter((tool) => config.tools.includes(tool))
    .map((tool) => `skillforge sync --type rule --runtime ${tool}`);
}

export interface RulesSync {
  server?: string;
  /** Every rule the registry lists, with id, version and paths. */
  rules: RuleListing[];
  proposed: RuleProposals['proposed'];
  other: RuleProposals['other'];
  /** B317: SkillForge installs the rules; sdlc writes none. */
  install: string[];
  error?: string;
}

/** For `team sync`: the registry's rules, which fit the project, and the install lines; nothing without a registry. */
export async function syncRules(root: string, config: SdlcConfig): Promise<RulesSync | undefined> {
  const server = registryServer(config);
  if (!server) return undefined;
  const install = installLines(config);
  try {
    const rules = await withRegistry(server, listRules);
    return { server: server.name, rules, ...proposeRules(root, rules), install: rules.length > 0 ? install : [] };
  } catch (error) {
    if (error instanceof RegistryToolsMissing) throw error;
    return { server: server.name, rules: [], proposed: [], other: [], install: [], error: failure(error) };
  }
}

export interface RuleCheck {
  id: string;
  version: string;
  paths?: string[];
  checksumOk: boolean;
  reason?: string;
}

async function checkOne(call: RegistryCall, item: RuleListing): Promise<RuleCheck> {
  const base = { id: item.id, version: item.version, ...(item.paths ? { paths: item.paths } : {}) };
  try {
    vetRule(await call('get_rule', { id: item.id }), item.id);
    return { ...base, checksumOk: true };
  } catch (error) {
    if (error instanceof RegistryItemError) return { ...base, checksumOk: false, reason: error.message };
    throw error;
  }
}

/** For `team check`: each registry rule read and checked (B317); writes nothing. Empty without a registry. */
export async function checkRules(config: SdlcConfig): Promise<{ rules: RuleCheck[]; error?: string }> {
  const server = registryServer(config);
  if (!server) return { rules: [] };
  try {
    return await withRegistry(server, async (call) => {
      const out: RuleCheck[] = [];
      for (const item of await listRules(call)) out.push(await checkOne(call, item));
      return { rules: out };
    });
  } catch (error) {
    if (error instanceof RegistryToolsMissing) throw error;
    return { rules: [], error: failure(error) };
  }
}
