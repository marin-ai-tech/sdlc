import { SdlcError } from './errors.js';

/**
 * What each stage uses (B14): `stages.<stage>` in `openspec/sdlc.yaml`, `{ skills: [names], agents: [names] }`.
 * The MCP servers of a stage are not listed here: they come from the registry (`mcp.servers.<name>.stages`), the one
 * source. Parsed at the boundary; an unknown stage or a value that is not a list of names is an error naming the key.
 */

/** The lifecycle stages (the same ids as `STAGES` in lifecycle.ts, which imports the config and cannot be imported). */
export const STAGE_IDS = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'] as const;
export type StageConfigId = (typeof STAGE_IDS)[number];

export interface StageResourcesConfig {
  skills: string[];
  agents: string[];
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
    stages[id] = {
      skills: names(entry.skills, where(`stages.${id}.skills`)),
      agents: names(entry.agents, where(`stages.${id}.agents`)),
    };
  }
  return stages;
}
