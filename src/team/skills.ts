import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { refreshGeneratedFiles } from '../integrations/install.js';
import { sha256, type ApplyReport } from '../integrations/manifest.js';
import { skillsRoot } from '../integrations/skills.js';
import { TOOL_IDS, type ToolId } from '../integrations/types.js';
import type { PackSource } from './pack-config.js';
import { packSkills } from './packs.js';
import { readTeam, TEAM_PATH, writeTeam, type SkillEntry, type TeamRecord } from './record.js';
import {
  failure, listed, RegistryItemError, registryServer, withRegistry, type RegistryCall,
} from './registry-client.js';
import type { Refused } from './sync.js';
import { isSkillId, scriptsOf, unsafeSkillPath, vetSkill, type RegistrySkill, type Vetted } from './vetting.js';

/**
 * Vetted skills (B74). The skills an accepted role lists are fetched from the team registry, checked (checksum,
 * paths, size) and installed into the skills root (`.claude/skills/<id>/`, or `.opencode/skills/<id>/` for
 * OpenCode-only projects), recorded in team.json and owned through the manifest like the generated files. A skill
 * with anything but Markdown (scripts, binaries) waits until a person runs `sdlc team accept --skill <id>`. Since
 * B76 a skill the registry does not give (or gives refused) comes from the first pack that has it, by the same rules.
 */
export interface SkillOrigin {
  source: 'registry' | 'pack';
  server?: string;
  pack?: PackSource;
}

export interface SkillFetch {
  server?: string;
  skills: Record<string, Vetted<RegistrySkill>>;
  /** Where each fetched skill came from. */
  origins: Record<string, SkillOrigin>;
  error?: string;
}

export interface SkillsOutcome {
  installed: Array<{ id: string; version: string; dir: string }>;
  unchanged: string[];
  needsAcceptance: Array<{ id: string; version: string; scripts: string[] }>;
  refused: Refused[];
  unavailable: Refused[];
}

interface Place {
  root: string;
  team: TeamRecord;
  by: string;
  origins: Record<string, SkillOrigin>;
  base: string | undefined;
}

const NO_REGISTRY = 'no team registry: set team.registry in openspec/sdlc.yaml';

/** The skills folder of the project's tools, or undefined without Claude Code and OpenCode. */
export function teamSkillsRoot(config: SdlcConfig): string | undefined {
  return skillsRoot(config.tools.filter((tool): tool is ToolId => (TOOL_IDS as readonly string[]).includes(tool)));
}

async function listedChecksums(call: RegistryCall): Promise<Map<string, unknown>> {
  try {
    const items = listed(await call('list_skills'), 'skills');
    return new Map(items.map((item) => [String(item.id), item.checksum]));
  } catch (error) {
    if (error instanceof RegistryItemError) return new Map();
    throw error;
  }
}

async function fetchSkill(call: RegistryCall, id: string, index: Map<string, unknown>): Promise<Vetted<RegistrySkill>> {
  if (!isSkillId(id)) return { reason: 'not a skill id (lower-case words joined by -, not sdlc-*)' };
  try {
    const vetted = vetSkill(await call('get_skill', { id }), id);
    const listedSum = index.get(id);
    const differs = 'ok' in vetted && typeof listedSum === 'string' && listedSum !== vetted.ok.checksum;
    return differs ? { reason: 'checksum differs from list_skills' } : vetted;
  } catch (error) {
    if (error instanceof RegistryItemError) return { reason: error.message };
    throw error;
  }
}

/** The skills `ids` from the registry, each checked; `error` when there is no registry or it does not answer. */
async function registrySkills(config: SdlcConfig, ids: string[]): Promise<SkillFetch> {
  const server = registryServer(config);
  const packs = (config.packs ?? []).length > 0;
  if (!server) return { skills: {}, origins: {}, ...(packs ? {} : { error: NO_REGISTRY }) };
  const origin: SkillOrigin = { source: 'registry', server: server.name };
  try {
    const skills = await withRegistry(server, async (call) => {
      const index = await listedChecksums(call);
      const out: Record<string, Vetted<RegistrySkill>> = {};
      for (const id of ids) out[id] = await fetchSkill(call, id, index);
      return out;
    });
    const origins = Object.fromEntries(ids.map((id) => [id, origin]));
    return { server: server.name, skills, origins };
  } catch (error) {
    const reason = `registry ${server.name} did not answer: ${failure(error)}`;
    return { server: server.name, skills: {}, origins: {}, error: reason };
  }
}

/** The skills `ids`: the registry's, then the packs' for those the registry did not give checked. */
export async function fetchSkills(root: string, config: SdlcConfig, ids: string[]): Promise<SkillFetch> {
  const fetched = await registrySkills(config, ids);
  const missing = ids.filter((id) => !('ok' in (fetched.skills[id] ?? {})));
  if (missing.length === 0 || (config.packs ?? []).length === 0) return fetched;
  for (const [id, found] of Object.entries(packSkills(root, config, missing))) {
    fetched.skills[id] = found.skill;
    fetched.origins[id] = { source: 'pack', pack: found.source };
  }
  const absent = ids.some((id) => !fetched.skills[id]);
  if (absent && !fetched.error) fetched.error = 'neither the team registry nor a pack has it';
  return fetched;
}

/** True when `target` (or its nearest existing parent) resolves outside the project, e.g. through a link. */
function escapesRoot(root: string, target: string): boolean {
  let probe = target;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const rel = path.relative(fs.realpathSync(root), fs.realpathSync(probe));
  return rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
}

function folderProblem(place: Place, dir: string, skill: RegistrySkill): string | undefined {
  const abs = path.join(place.root, dir);
  if (!place.team.skills[skill.id] && fs.existsSync(abs)) {
    return `${dir} exists and sdlc did not install it; move it away first`;
  }
  const outside = skill.files.find((file) => escapesRoot(place.root, path.join(abs, file.path)));
  return outside ? `${dir}/${outside.path} resolves outside the project` : undefined;
}

/** Removes the files of the installed version the new one does not have, unless someone edited them. */
function removeOld(root: string, previous: SkillEntry, keep: Set<string>): void {
  for (const [rel, digest] of Object.entries(previous.files)) {
    if (keep.has(rel) || unsafeSkillPath(rel)) continue;
    const abs = path.join(root, previous.dir, rel);
    const current = readText(abs);
    if (current !== undefined && sha256(current) === digest) fs.rmSync(abs, { force: true });
  }
}

/** Writes a checked skill into the skills root and records it; a reason when it may not be written. */
function installSkill(place: Place, skill: RegistrySkill): string | undefined {
  if (!place.base) return 'no skills folder: neither Claude Code nor OpenCode is installed in this project';
  const dir = `${place.base}/${skill.id}`;
  const problem = folderProblem(place, dir, skill);
  if (problem) return problem;
  const previous = place.team.skills[skill.id];
  if (previous) removeOld(place.root, previous, new Set(skill.files.map((file) => file.path)));
  for (const file of skill.files) writeTextAtomic(path.join(place.root, dir, file.path), file.content);
  const files = Object.fromEntries(skill.files.map((file) => [file.path, sha256(file.content)]));
  const origin: SkillOrigin = place.origins[skill.id] ?? { source: 'registry' };
  const pack = origin.pack ? { pack: origin.pack } : {};
  place.team.skills[skill.id] = {
    version: skill.version, checksum: skill.checksum, source: origin.source, server: origin.server ?? '',
    by: place.by, at: new Date().toISOString(), dir, files, scripts: scriptsOf(skill.files), ...pack,
  };
  return undefined;
}

function sortSkill(place: Place, id: string, fetched: SkillFetch, outcome: SkillsOutcome): void {
  const vetted = fetched.skills[id];
  if (!vetted) return void outcome.unavailable.push({ id, reason: fetched.error ?? 'not fetched' });
  if (!('ok' in vetted)) return void outcome.refused.push({ id, reason: vetted.reason });
  const skill = vetted.ok;
  if (place.team.skills[id]?.checksum === skill.checksum) return void outcome.unchanged.push(id);
  const scripts = scriptsOf(skill.files);
  if (scripts.length > 0) return void outcome.needsAcceptance.push({ id, version: skill.version, scripts });
  const problem = installSkill(place, skill);
  if (problem) outcome.refused.push({ id, reason: problem });
  else outcome.installed.push({ id, version: skill.version, dir: place.team.skills[id].dir });
}

/** After a role is accepted: its Markdown-only skills installed, the others reported. */
export async function installRoleSkills(
  root: string,
  config: SdlcConfig,
  ids: string[],
  by: string,
): Promise<SkillsOutcome> {
  const outcome: SkillsOutcome = { installed: [], unchanged: [], needsAcceptance: [], refused: [], unavailable: [] };
  if (ids.length === 0) return outcome;
  const fetched = await fetchSkills(root, config, ids);
  const team = readTeam(root);
  const place = { root, team, by, origins: fetched.origins, base: teamSkillsRoot(config) };
  for (const id of [...new Set(ids)]) sortSkill(place, id, fetched, outcome);
  if (outcome.installed.length === 0) return outcome;
  writeTeam(root, team);
  refreshGeneratedFiles(root, config);
  return outcome;
}

export interface AcceptSkillResult {
  skill: string;
  version: string;
  dir: string;
  scripts: string[];
  team: string;
  entry: SkillEntry;
  files: ApplyReport;
}

function skillError(config: SdlcConfig, id: string, fetched: SkillFetch): SdlcError {
  const vetted = fetched.skills[id];
  if (vetted && !('ok' in vetted)) {
    return new SdlcError('skill_refused', { key: 'error.skill_x_refused', params: { id, reason: vetted.reason } });
  }
  if (!config.team?.registry && (config.packs ?? []).length === 0) {
    return new SdlcError('no_team_registry', { key: 'error.no_team_registry' }, { key: 'fix.set_team_registry' });
  }
  const reason = fetched.error ?? 'not fetched';
  return new SdlcError('team_registry_unreachable', { key: 'error.team_registry_unreachable', params: { reason } });
}

/** `sdlc team accept --skill <id>`, a person's command: the skill, scripts included, checked and installed. */
export async function acceptSkill(
  root: string,
  config: SdlcConfig,
  id: string,
  by: string,
): Promise<AcceptSkillResult> {
  const fetched = await fetchSkills(root, config, [id]);
  const vetted = fetched.skills[id];
  if (!vetted || !('ok' in vetted)) throw skillError(config, id, fetched);
  const team = readTeam(root);
  const place = { root, team, by, origins: fetched.origins, base: teamSkillsRoot(config) };
  const problem = installSkill(place, vetted.ok);
  if (problem) {
    throw new SdlcError('skill_refused', { key: 'error.skill_x_refused', params: { id, reason: problem } });
  }
  writeTeam(root, team);
  const files = refreshGeneratedFiles(root, config);
  const entry = team.skills[id];
  return { skill: id, version: entry.version, dir: entry.dir, scripts: entry.scripts, team: TEAM_PATH, entry, files };
}
