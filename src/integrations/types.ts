import type { SdlcConfig } from '../core/config.js';
import type { HarnessStamp } from '../core/license.js';
import type { RoleFile } from '../team/role-file.js';

export const TOOL_IDS = ['claude', 'opencode'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface GeneratedFile {
  /** Posix path relative to the project root. */
  path: string;
  content: string;
  tool: ToolId | 'shared';
  kind: 'skill' | 'command' | 'agent' | 'plugin' | 'schema' | 'team-skill';
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
