import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { isDirectory, listFilesRecursive, normalizeNewlines, readText } from '../core/fs-utils.js';
import { generatedNotice, harnessStamp, type HarnessStamp } from '../core/license.js';
import { harnessPackageDir } from '../core/openspec-schema.js';
import { harnessVersion } from '../core/version.js';
import { claudeAdapter } from './claude.js';
import { cursorAdapter } from './cursor.js';
import { CURSOR_HOOKS_PATH, mergeCursorHooks } from './cursor-hooks.js';
import { applyFiles, type ApplyReport } from './manifest.js';
import { opencodeAdapter } from './opencode.js';
import { applyMcpRegistration, removeMcpRegistration, type McpChange } from './mcp-config.js';
import { applyRegistryServers, removeRegistryServers, type ServerChanges } from './mcp-servers.js';
import { assertNoSecretLiterals } from '../mcp/registry.js';
import { mergeClaudeHooks, mergeClaudeStatusLine, type SettingsChange } from './settings.js';
import { renderSkills } from './skills.js';
import { renderTeamSkills } from './team-skills.js';
import { acceptedRoles } from '../team/accepted.js';
import { TOOL_IDS, type GeneratedFile, type RenderContext, type ToolAdapter, type ToolId } from './types.js';

export const ADAPTERS: Record<ToolId, ToolAdapter> = {
  claude: claudeAdapter,
  opencode: opencodeAdapter,
  cursor: cursorAdapter,
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

/** What the generated files are rendered from; with `root`, also the project's accepted roles (B70). */
export function renderContext(config: SdlcConfig, tools: ToolId[], root?: string): RenderContext {
  const stamp = harnessStamp(config);
  const base = { tools, delivery: config.delivery, cli: config.cli, version: stamp.version, config, stamp };
  return root === undefined ? base : { ...base, root, team: acceptedRoles(root) };
}

export function renderAll(ctx: RenderContext): GeneratedFile[] {
  const files: GeneratedFile[] = [...schemaFiles(ctx.stamp), ...renderSkills(ctx), ...renderTeamSkills(ctx)];
  for (const tool of ctx.tools) files.push(...ADAPTERS[tool].render(ctx));
  return files;
}

export interface InstallResult {
  tools: ToolId[];
  files: ApplyReport;
  claudeHooks: SettingsChange;
  /** sdlc's entries in `.cursor/hooks.json` (B80); `absent` when Cursor is not a tool and the file has none. */
  cursorHooks: SettingsChange;
  statusLine: string;
  /** The `sdlc` MCP server entry per file (B13); empty when nothing MCP-related was touched. */
  mcp: Record<string, McpChange>;
  /** The registry's servers (B10) per file; only files where an entry was added, updated, removed or kept. */
  servers: Record<string, ServerChanges>;
}

export function installIntegrations(
  root: string,
  config: SdlcConfig,
  tools: ToolId[],
  options: { force?: boolean; dryRun?: boolean; hooks?: boolean } = {}
): InstallResult {
  // A literal secret in the registry is refused before anything is written (`mcp_secret_literal`).
  assertNoSecretLiterals(config.mcp?.servers ?? []);
  const ctx = renderContext(config, tools, root);
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
  const cursorHooks = applyCursorHooks(root, config.cli, tools, options);
  const mcp = applyMcpRegistration(root, config, tools, options.dryRun);
  const servers = applyRegistryServers(root, config.mcp?.servers ?? [], tools, options.dryRun);
  return { tools, files: report, claudeHooks, cursorHooks, statusLine, mcp, servers };
}

/** Cursor's hooks while Cursor is a tool (and hooks are wanted); sdlc's entries go when it no longer is. */
function applyCursorHooks(
  root: string,
  cli: string,
  tools: ToolId[],
  options: { dryRun?: boolean; hooks?: boolean },
): SettingsChange {
  const wanted = tools.includes('cursor') && options.hooks !== false;
  if (!tools.includes('cursor') && !fs.existsSync(path.join(root, CURSOR_HOOKS_PATH))) return 'absent';
  return mergeCursorHooks(root, cli, wanted, options.dryRun);
}

/** The `.cursor` folder once sdlc's files are gone from it, if nothing of the person's own is left. */
function pruneCursorFolder(root: string, dryRun: boolean | undefined): void {
  const dir = path.join(root, '.cursor');
  if (dryRun || !isDirectory(dir)) return;
  try {
    if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
  } catch {
    // Best effort: a folder that cannot be read or removed stays.
  }
}

/**
 * Re-renders the generated files for the configured tools without touching
 * hook settings, so their notices follow a license change.
 */
export function refreshGeneratedFiles(root: string, config: SdlcConfig): ApplyReport {
  const ctx = renderContext(config, config.tools.filter((t) => t in ADAPTERS) as ToolId[], root);
  return applyFiles(root, renderAll(ctx), { version: ctx.version, license: ctx.stamp.license });
}

/** Removes every generated file (unless edited), the Claude and Cursor hooks. Planning data is never touched. */
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
  const cursorHooks = fs.existsSync(path.join(root, CURSOR_HOOKS_PATH))
    ? mergeCursorHooks(root, 'sdlc', false, options.dryRun)
    : 'absent';
  const mcp = removeMcpRegistration(root, options.dryRun);
  const servers = removeRegistryServers(root, options.dryRun);
  pruneCursorFolder(root, options.dryRun);
  return { tools: [], files: report, claudeHooks, cursorHooks, statusLine, mcp, servers };
}
