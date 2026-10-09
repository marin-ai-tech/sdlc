import type { SdlcConfig } from '../core/config.js';
import type { HarnessStamp } from '../core/license.js';
import type { RoleFile } from '../team/role-file.js';

/** The agent tools sdlc integrates with; `cursor` since 0.13.0 (B80), `codex` (Codex CLI) since 0.14.0 (B82). */
export const TOOL_IDS = ['claude', 'opencode', 'cursor', 'codex', 'qwen', 'gigacode'] as const;
export type ToolId = (typeof TOOL_IDS)[number];
/** The tools of a new project where none is detected: Cursor is chosen, never assumed (0.13.0 keeps the default). */
export const DEFAULT_TOOLS: readonly ToolId[] = ['claude', 'opencode'];

export interface GeneratedFile {
  /** Posix path relative to the project root. */
  path: string;
  content: string;
  tool: ToolId | 'shared';
  kind: 'skill' | 'command' | 'agent' | 'plugin' | 'schema' | 'team-skill' | 'rule';
  /** Unix mode for executable files. */
  mode?: number;
}

export interface RenderContext {
  tools: ToolId[];
  delivery: SdlcConfig['delivery'];
  cli: string;
  version: string;
  config: SdlcConfig;
  /** sdlc version and the project's license, written into every generated file's notice. */
  stamp: HarnessStamp;
  /** The project root, when rendering for a project (not for the plugin); the team's facts are read from it. */
  root?: string;
  /** The accepted roles of the agent team (B70); empty or absent renders exactly as before. */
  team?: RoleFile[];
}

export interface ToolAdapter {
  id: ToolId;
  name: string;
  /** Directories whose presence suggests the tool is used in this project. */
  detectPaths: string[];
  render(ctx: RenderContext): GeneratedFile[];
  /** How a person invokes a workflow in this tool. */
  invocation(workflow: string, ctx: RenderContext): string;
}
