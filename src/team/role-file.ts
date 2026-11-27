import { parse } from 'yaml';
import { SdlcError } from '../core/errors.js';
import { normalizeNewlines } from '../core/fs-utils.js';
import { STAGE_IDS, type StageConfigId } from '../core/stage-config.js';
import { roleToolsProblem } from './role-tools.js';
import type { SourceMarker } from './vetting.js';

/**
 * A role of the agent team as a file (B69): YAML front matter (`id`, `title`, `description`, `stages`, `tools`,
 * `readonly`, and since 0.11.0 `skills` and `source`) and a Markdown body that may end with the placeholders
 * `{{artifacts}}` and `{{project}}`. Parse, don't validate: a missing or broken field gets a safe default
 * (read-only, read tools, no stages, no skills). A `tools` list with an entry that is not a tool name refuses the
 * file (B249): the entries reach a generated subagent's front matter.
 */
export interface RoleFile {
  id: string;
  title: string;
  description: string;
  stages: StageConfigId[];
  tools: string[];
  readonly: boolean;
  body: string;
  /** The skills the role uses (B74): ids of skills of the team registry. */
  skills: string[];
  /** Where the draft came from, as its front matter says (`source.kind`: registry or builtin). */
  sourceKind?: string;
  marker?: SourceMarker;
  /** The `id` the front matter declares, when it has one. */
  declaredId?: string;
}

/** Role ids: lower-case words joined by `-`; also a safe file name. */
export const ROLE_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const DEFAULT_TOOLS = ['read', 'grep', 'glob'];
const FRONT_MATTER = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function frontMatter(text: string): { data: Record<string, unknown>; body: string } {
  const match = text.match(FRONT_MATTER);
  if (!match) return { data: {}, body: text };
  try {
    const data = parse(match[1]) as unknown;
    const record = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
    return { data: record, body: match[2].replace(/^\n+/, '') };
  } catch {
    return { data: {}, body: match[2] };
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

/** The role's tools (B249): every entry a tool name with an optional `(pattern)`, or the role file is refused. */
function roleTools(id: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const reason = roleToolsProblem(value);
  if (reason === undefined) return value as string[];
  throw new SdlcError('invalid_role', { key: 'error.role_x_tools_refused', params: { role: id, reason } },
    { key: 'fix.role_tools_entry' });
}

function isStage(value: string): value is StageConfigId {
  return (STAGE_IDS as readonly string[]).includes(value);
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() !== '' ? value : fallback;
}

function sourceKind(value: unknown): { sourceKind?: string } {
  const kind = value && typeof value === 'object' ? (value as Record<string, unknown>).kind : undefined;
  return typeof kind === 'string' ? { sourceKind: kind } : {};
}

/** The role in `text`, named `id` (its file name). */
export function parseRoleFile(id: string, source: string): RoleFile {
  const { data, body } = frontMatter(normalizeNewlines(source).replace(/^\uFEFF/, ''));
  const tools = roleTools(id, data.tools);
  return {
    id,
    title: text(data.title, id),
    description: text(data.description, id),
    stages: strings(data.stages).filter(isStage),
    tools: tools.length > 0 ? tools : DEFAULT_TOOLS,
    readonly: data.readonly !== false,
    body,
    skills: strings(data.skills),
    ...sourceKind(data.source),
    ...(typeof data.id === 'string' ? { declaredId: data.id } : {}),
  };
}
