import { SdlcError } from '../core/errors.js';

/**
 * The context sources (B101): `context.sources` in `openspec/sdlc.yaml`, each
 * `{ name, server, resource | tool, args?, stages, owner, fresh_days? }`. `name` is the pack's file name under
 * `docs/context/`: a plain name (letters, digits, `-`, `_`), so it can never point the pull outside that folder.
 * `server` names a registry server (`mcp.servers`); the pack's text comes from a resource's text contents or a
 * tool answer's text parts — exactly one of `resource`/`tool`, never both. Parsed into types here (config.ts only
 * calls `parseContextSources`); a `context` that is not a mapping, or `sources` that is not a list, is an invalid
 * configuration for the whole file. A bad ENTRY does not stop the other commands: it is kept in `invalid` with
 * its reason, and `sdlc context pull` reports it in `failed` instead of writing anything for it.
 */
export interface ContextSourceConfig {
  name: string;
  /** A server of `mcp.servers` (stdio or http). */
  server: string;
  /** The MCP resource whose text contents become the body; absent when `tool` is set. */
  resource?: string;
  /** The tool called for the body's text parts; absent when `resource` is set. */
  tool?: string;
  /** Arguments of the tool call; empty for a resource read. */
  args: Record<string, unknown>;
  /** The stages the pack reaches the agent at (see context-packs.ts). */
  stages: string[];
  owner: string;
  /** Days before the pack is marked stale; absent = the pull writes a default. */
  freshDays?: number;
}

/** An entry of `context.sources` that is not a valid source; `context pull` reports it as failed. */
export interface InvalidSource {
  /** The entry's `name` when it is a string, else its position. */
  name: string;
  reason: string;
}

export interface ContextSourcesConfig {
  sources: ContextSourceConfig[];
  invalid: InvalidSource[];
}

/** A pack file name: letters, digits, `-` and `_` — no `/`, `\`, `..`, so it stays inside `docs/context/`. */
const PACK_NAME = /^[A-Za-z0-9_-]+$/;
export const SOURCE_FIELDS = ['name', 'server', 'resource', 'tool', 'args', 'stages', 'owner', 'fresh_days'];
/** The lifecycle's six stages (lifecycle.ts `STAGES`); not imported, because config.ts loads this module. */
const STAGE_IDS = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'];

type Raw = Record<string, unknown>;

function invalid(key: string, where: string, extra: Record<string, string> = {}): SdlcError {
  return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}

function mapping(value: unknown, where: string): Raw | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid('error.x_must_be_a_mapping', where);
  return value as Raw;
}

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw invalid('error.x_must_be_a_non_empty_string', where);
  return value;
}

/** The stages the pack is for: a required list of known stage ids. */
function stages(value: unknown, where: string): string[] {
  if (value === undefined || value === null) throw invalid('error.x_is_required', where);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw invalid('error.x_must_be_a_list_of_strings', where);
  }
  const unknown = (value as string[]).find((stage) => !STAGE_IDS.includes(stage));
  if (unknown !== undefined) throw invalid('error.x_must_be_x', where, { p2: STAGE_IDS.join(', ') });
  return value as string[];
}

/** `fresh_days`: a positive whole number of days; absent = none declared. */
function freshDays(value: unknown, where: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw invalid('error.x_must_be_an_integer_of_1_or_more', where);
  }
  return value;
}

/** Exactly one of `resource`/`tool`: both set, or neither, is an invalid configuration. */
function sourceKind(raw: Raw, where: string): Pick<ContextSourceConfig, 'resource' | 'tool'> {
  const resource = raw.resource === undefined || raw.resource === null
    ? undefined
    : text(raw.resource, `${where}.resource`);
  const tool = raw.tool === undefined || raw.tool === null
    ? undefined
    : text(raw.tool, `${where}.tool`);
  if ((resource === undefined) === (tool === undefined)) {
    throw invalid('error.x_must_be_x', where, { p2: 'exactly one of `resource` or `tool`' });
  }
  return resource === undefined ? { tool } : { resource };
}

function parseSource(value: unknown, where: string, servers: string[]): ContextSourceConfig {
  const raw = mapping(value, where) ?? {};
  const name = text(raw.name, `${where}.name`);
  if (!PACK_NAME.test(name)) {
    throw invalid('error.x_must_be_x', `${where}.name`, { p2: 'a plain file name (letters, digits, - and _)' });
  }
  const server = text(raw.server, `${where}.server`);
  if (!servers.includes(server)) throw invalid('error.context_unknown_server', `${where}.server`, { server });
  const fresh = freshDays(raw.fresh_days, `${where}.fresh_days`);
  const source: ContextSourceConfig = {
    name,
    server,
    ...sourceKind(raw, where),
    args: mapping(raw.args, `${where}.args`) ?? {},
    stages: stages(raw.stages, `${where}.stages`),
    owner: text(raw.owner, `${where}.owner`),
  };
  if (fresh !== undefined) source.freshDays = fresh;
  return source;
}

/** The name an invalid entry is reported under: its `name` when that is a string, else its position. */
function entryName(value: unknown, index: number): string {
  const name = value && typeof value === 'object' ? (value as Raw).name : undefined;
  return typeof name === 'string' ? name : `context.sources[${index}]`;
}

/** One entry into a source or into `invalid` with the parse reason (English, like every skip reason). */
function parseEntry(value: unknown, index: number, where: (key: string) => string, servers: string[],
): { source?: ContextSourceConfig; invalid?: InvalidSource } {
  try {
    return { source: parseSource(value, where(`context.sources[${index}]`), servers) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { invalid: { name: entryName(value, index), reason } };
  }
}

/** `context.sources`: valid sources and invalid entries, in the file's order; absent = none. */
export function parseContextSources(
  value: unknown,
  where: (key: string) => string,
  servers: string[],
): ContextSourcesConfig {
  const config: ContextSourcesConfig = { sources: [], invalid: [] };
  if (value === undefined || value === null) return config;
  if (!Array.isArray(value)) throw invalid('error.x_must_be_a_list', where('context.sources'));
  const names = new Set<string>();
  for (const [index, item] of value.entries()) {
    const parsed = parseEntry(item, index, where, servers);
    if (parsed.source) {
      if (names.has(parsed.source.name)) {
        const reason = invalid('error.x_must_be_x', where('context.sources'),
          { p2: `unique names (again: ${parsed.source.name})` }).message;
        config.invalid.push({ name: parsed.source.name, reason });
        continue;
      }
      names.add(parsed.source.name);
      config.sources.push(parsed.source);
    }
    if (parsed.invalid) config.invalid.push(parsed.invalid);
  }
  return config;
}
