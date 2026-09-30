import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { isDirectory, listFilesRecursive, normalizeNewlines, readText } from '../core/fs-utils.js';
import { generatedNotice, harnessStamp, type HarnessStamp } from '../core/license.js';
import { harnessPackageDir } from '../core/openspec-schema.js';
import { harnessVersion } from '../core/version.js';
import { claudeAdapter } from './claude.js';
import { applyFiles, type ApplyReport } from './manifest.js';
import { opencodeAdapter } from './opencode.js';
import { mergeClaudeHooks, mergeClaudeStatusLine, type SettingsChange } from './settings.js';
import { renderSkills } from './skills.js';
import { TOOL_IDS, type GeneratedFile, type RenderContext, type ToolAdapter, type ToolId } from './types.js';

export const ADAPTERS: Record<ToolId, ToolAdapter> = {
  claude: claudeAdapter,
  opencode: opencodeAdapter,
};

export function parseTools(value: string | undefined, fallback: ToolId[]): ToolId[] {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === '') return [];
  if (v === 'all') return [...TOOL_IDS];
  const tools = v.split(',').map((t) => t.trim()).filter(Boolean);
  const unknown = tools.filter((t) => !(TOOL_IDS as readonly string[]).includes(t));
  if (unknown.length > 0) {
    throw new Error(`Unknown tool(s): ${unknown.join(', ')}. Supported: ${TOOL_IDS.join(', ')}, all, none.`);
  }
  return [...new Set(tools)] as ToolId[];
}

/** Tools whose files or directories already exist in the project. */
export function detectTools(root: string): ToolId[] {
  return TOOL_IDS.filter((id) => ADAPTERS[id].detectPaths.some((p) => fs.existsSync(path.join(root, p))));
}

/**
 * The harness's OpenSpec schema, copied into `openspec/schemas/sdlc/` so the
 * OpenSpec CLI (and OpenSpec's own /opsx workflows) resolve it project-locally.
 * `schema.yaml` carries the generated-file notice; the artifact templates do
 * not, because their text becomes the project's own artifacts.
 */
export function schemaFiles(stamp: HarnessStamp): GeneratedFile[] {
  const dir = path.join(harnessPackageDir(), 'schemas', 'sdlc');
  if (!isDirectory(dir)) return [];
  return listFilesRecursive(dir).map((rel) => {
    const content = normalizeNewlines(readText(path.join(dir, rel)) ?? '');
    return {
      path: `openspec/schemas/sdlc/${rel}`,
      content: rel === 'schema.yaml' ? `${generatedNotice(stamp, 'yaml')}\n${content}` : content,
      tool: 'shared' as const,
      kind: 'schema' as const,
    };
  });
}

export function renderContext(config: SdlcConfig, tools: ToolId[]): RenderContext {
  const stamp = harnessStamp(config);
  return { tools, delivery: config.delivery, cli: config.cli, version: stamp.version, config, stamp };
}

export function renderAll(ctx: RenderContext): GeneratedFile[] {
  const files: GeneratedFile[] = [...schemaFiles(ctx.stamp), ...renderSkills(ctx)];
  for (const tool of ctx.tools) files.push(...ADAPTERS[tool].render(ctx));
  return files;
}

export interface InstallResult {
  tools: ToolId[];
  files: ApplyReport;
  claudeHooks: SettingsChange;
  statusLine: string;
}

export function installIntegrations(
  root: string,
  config: SdlcConfig,
  tools: ToolId[],
  options: { force?: boolean; dryRun?: boolean; hooks?: boolean } = {}
): InstallResult {
  const ctx = renderContext(config, tools);
  const files = renderAll(ctx);
  const report = applyFiles(root, files, {
    force: options.force,
    dryRun: options.dryRun,
    version: ctx.version,
    license: ctx.stamp.license,
  });
  const wantHooks = tools.includes('claude') && options.hooks !== false;
  const claudeHooks = tools.includes('claude') || fs.existsSync(path.join(root, '.claude', 'settings.json'))
    ? mergeClaudeHooks(root, config.cli, wantHooks, options.dryRun)
    : 'absent';
  const statusLine = tools.includes('claude') || fs.existsSync(path.join(root, '.claude', 'settings.json'))
    ? mergeClaudeStatusLine(root, config.cli, tools.includes('claude') && config.statusline, options.dryRun)
    : 'absent';
  return { tools, files: report, claudeHooks, statusLine };
}

/**
 * Re-renders the generated files for the configured tools without touching
 * hook settings, so their notices follow a license change.
 */
export function refreshGeneratedFiles(root: string, config: SdlcConfig): ApplyReport {
  const ctx = renderContext(config, config.tools.filter((t) => t in ADAPTERS) as ToolId[]);
  return applyFiles(root, renderAll(ctx), { version: ctx.version, license: ctx.stamp.license });
}

/** Removes every generated file (unless edited) and the Claude hooks. Planning data is never touched. */
export function uninstallIntegrations(root: string, options: { force?: boolean; dryRun?: boolean } = {}): InstallResult {
  const report = applyFiles(root, [], {
    force: options.force,
    dryRun: options.dryRun,
    version: harnessVersion(),
    removeObsolete: (entry) => entry.kind !== 'schema',
  });
  const claudeHooks = fs.existsSync(path.join(root, '.claude', 'settings.json'))
    ? mergeClaudeHooks(root, 'sdlc', false, options.dryRun)
    : 'absent';
  const statusLine = fs.existsSync(path.join(root, '.claude', 'settings.json'))
    ? mergeClaudeStatusLine(root, 'sdlc', false, options.dryRun)
    : 'absent';
  return { tools: [], files: report, claudeHooks, statusLine };
}
