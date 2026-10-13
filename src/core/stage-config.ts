import { SdlcError } from './errors.js';

/**
 * What each stage uses (B14): `stages.<stage>` in `openspec/sdlc.yaml`, `{ skills: [names], agents: [names] }`.
 * The MCP servers of a stage are not listed here: they come from the registry (`mcp.servers.<name>.stages`), the one
 * source. Parsed at the boundary; an unknown stage or a value that is not a list of names is an error naming the key.
 * `stages.build.simplify` (B109, default true) turns the build workflow's `sdlc-simplifier` step off; only the build
 * stage takes it.
 */

/** The lifecycle stages (the same ids as `STAGES` in lifecycle.ts, which imports the config and cannot be imported). */
export const STAGE_IDS = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'] as const;
export type StageConfigId = (typeof STAGE_IDS)[number];

export interface StageResourcesConfig {
  skills: string[];
  agents: string[];
  /** Build only (B109): false turns off the default `sdlc-simplifier` step; absent means true. */
  simplify?: boolean;
}

export type StagesConfig = Partial<Record<StageConfigId, StageResourcesConfig>>;

type Raw = Record<string, unknown>;

function mapping(value: unknown, where: string): Raw | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_mapping', params: { where } });
  }
  return value as Raw;
}

function names(value: unknown, where: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_list_of_strings', params: { where } });
  }
  return value as string[];
}

function flag(value: unknown, where: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new SdlcError('invalid_config', { key: 'error.x_must_be_true_or_false', params: { where } });
  }
  return value;
}

/** `stages.<stage>.simplify` (B109): true or false, and only under the build stage. */
function simplify(id: StageConfigId, entry: Raw, where: (key: string) => string): boolean | undefined {
  const key = where(`stages.${id}.simplify`);
  if (id !== 'build' && 'simplify' in entry) {
    throw new SdlcError('invalid_config', { key: 'error.stages_simplify_build_only', params: { where: key } });
  }
  return flag(entry.simplify, key);
}

/** One `stages.<stage>` entry; `simplify` stays absent unless the file sets it. */
function stageEntry(id: StageConfigId, entry: Raw, where: (key: string) => string): StageResourcesConfig {
  const resources: StageResourcesConfig = {
    skills: names(entry.skills, where(`stages.${id}.skills`)),
    agents: names(entry.agents, where(`stages.${id}.agents`)),
  };
  const value = simplify(id, entry, where);
  if (value !== undefined) resources.simplify = value;
  return resources;
}

function isStage(id: string): id is StageConfigId {
  return (STAGE_IDS as readonly string[]).includes(id);
}

/** `stages`: stage id -> its skills and subagents. */
export function parseStages(value: unknown, where: (key: string) => string): StagesConfig {
  const raw = mapping(value, where('stages')) ?? {};
  const stages: StagesConfig = {};
  for (const [id, item] of Object.entries(raw)) {
    if (!isStage(id)) {
      const params = { flag: where('stages'), p2: STAGE_IDS.join(', '), value: id };
      throw new SdlcError('invalid_config', { key: 'error.x_must_be_one_of_x_got_x', params });
    }
    const entry = mapping(item, where(`stages.${id}`)) ?? {};
    stages[id] = stageEntry(id, entry, where);
  }
  return stages;
}
