import { SdlcError } from '../core/errors.js';

/**
 * `team: { registry: <server> }` in openspec/sdlc.yaml (B71): the server of `mcp.servers` that serves the team's
 * roles and skills (list_roles, get_role, list_skills, get_skill). Parsed into a typed field here; config.ts only
 * calls `parseTeamConfig`. A name that is not a server of `mcp.servers` is a config error naming it.
 */
export interface TeamConfig {
  /** The name of a server in `mcp.servers`; absent = the built-in roles only. */
  registry?: string;
  /** Explicit execution guidance; absence keeps legacy rendering and human authority unchanged. */
  mode?: ExecutionMode;
}

export type ExecutionMode = 'solo' | 'team';

export function parseExecutionMode(value: unknown, where: string): ExecutionMode | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === 'solo' || value === 'team') return value;
  throw invalid('error.team_mode', where);
}

function invalid(key: string, where: string, extra: Record<string, string> = {}): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}

/** `team`: absent = undefined. `servers` are the names of `mcp.servers`. */
export function parseTeamConfig(
  value: unknown,
  where: (key: string) => string,
  servers: string[],
): TeamConfig | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', where('team'));
  const raw = value as Record<string, unknown>;
  const mode = parseExecutionMode(raw.mode, where('team.mode'));
  const profile = mode === undefined ? {} : { mode };
  const registry = raw.registry;
  if (registry === undefined || registry === null) return profile;
  if (typeof registry !== 'string' || registry.trim() === '') {
    throw invalid('error.x_must_be_a_non_empty_string', where('team.registry'));
  }
  if (!servers.includes(registry)) {
    throw invalid('error.team_unknown_registry', where('team.registry'), { server: registry });
  }
  return { ...profile, registry };
}
