import type { SdlcConfig } from '../core/config.js';
import type { HarnessStamp } from '../core/license.js';

export const TOOL_IDS = ['claude', 'opencode'] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export interface GeneratedFile {
  /** Posix path relative to the project root. */
  path: string;
  content: string;
  tool: ToolId | 'shared';
  kind: 'skill' | 'command' | 'agent' | 'plugin' | 'schema';
  /** Unix mode for executable files. */
  mode?: number;
}

export interface RenderContext {
  tools: ToolId[];
  delivery: SdlcConfig['delivery'];
  cli: string;
  version: string;
  config: SdlcConfig;
  /** scdl version and the project's license, written into every generated file's notice. */
  stamp: HarnessStamp;
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
