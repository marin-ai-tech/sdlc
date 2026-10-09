import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { SdlcConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import {
  CODEX_CONFIG_PATH, isOurSdlcTable, mcpTables, readConfigToml, sdlcServerTable, setMcpTables, writeConfigToml,
} from './codex-toml.js';
import type { SettingsChange } from './settings.js';
import type { ToolId } from './types.js';

/**
 * Registers `sdlc mcp serve` (B13) in the agents' MCP configuration, merged like the Claude Code hooks: other
 * servers and keys stay, a missing file is created, invalid JSON is an error naming the file (never overwritten).
 * - claude: `.mcp.json` -> `mcpServers.sdlc = { type: "stdio", command, args }`;
 * - opencode: `opencode.json` -> `mcp.sdlc = { type: "local", command: [command, ...args], enabled: true }`;
 * - cursor (B80): `.cursor/mcp.json` -> `mcpServers.sdlc = { command, args }`;
 * - codex (B82): `.codex/config.toml` -> `[mcp_servers.sdlc]` with `command` and `args` (TOML, see codex-toml.ts).
 * Only the `sdlc` entry is ever written or removed, and only while `mcp.serve` is true (uninstall removes it).
 */

export const SERVER_NAME = 'sdlc';

interface McpTarget {
  file: string;
  /** The key holding the servers in that file. */
  key: string;
  entry: (launch: McpLaunch) => Record<string, unknown>;
  /** Reported only when something happened to it (Cursor, 0.13.0: the other tools' answers stay as they were). */
  quiet?: boolean;
}

export interface McpLaunch {
  command: string;
  args: string[];
}

export type McpChange = SettingsChange | 'kept (invalid JSON)';

/** The JSON targets; Codex's TOML file is handled on its own (codexRegister, codexUnregister). */
const TARGETS: Record<Exclude<ToolId, 'codex'>, McpTarget> = {
  claude: {
    file: '.mcp.json',
    key: 'mcpServers',
    entry: (l) => ({ type: 'stdio', command: l.command, args: l.args }),
  },
  opencode: {
    file: 'opencode.json',
    key: 'mcp',
    entry: (l) => ({ type: 'local', command: [l.command, ...l.args], enabled: true }),
  },
  cursor: {
    file: '.cursor/mcp.json',
    key: 'mcpServers',
    entry: (l) => ({ command: l.command, args: l.args }),
    quiet: true,
  },
};

/** `cli` from sdlc.yaml split on whitespace, plus `mcp serve`: `npx --no-install sdlc` -> npx [..., mcp, serve]. */
export function mcpLaunch(cli: string): McpLaunch {
  const [command, ...rest] = cli.trim().split(/\s+/);
  return { command, args: [...rest, 'mcp', 'serve'] };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The file's JSON object; undefined when it does not exist (or is empty); an SdlcError when it is not JSON. */
export function readJson(root: string, file: string): Record<string, unknown> | undefined {
  const text = readText(path.join(root, file));
  if (text === undefined || text.trim() === '') return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new SdlcError(
      'invalid_mcp_config',
      { key: 'error.mcp_config_not_valid_json', params: { file, reason: errorText(error) } },
      { key: 'fix.fix_x_then_run_sdlc_update', params: { SETTINGS_PATH: file } },
    );
  }
}

export function servers(json: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = json[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function writeJson(root: string, file: string, json: Record<string, unknown>): void {
  writeTextAtomic(path.join(root, file), `${JSON.stringify(json, null, 2)}\n`);
}

/** The words an entry starts: `command` + `args` (Claude Code) or the `command` array (OpenCode). */
function commandWords(entry: Record<string, unknown>): unknown[] {
  if (Array.isArray(entry.command)) return entry.command;
  return [entry.command, ...(Array.isArray(entry.args) ? entry.args : [])];
}

/** An entry this harness wrote: its command runs sdlc and ends with `mcp serve` (MCP entries never had the old name). */
export function isOurServer(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
  const words = commandWords(entry as Record<string, unknown>).map(String);
  const tail = words.slice(-2).join(' ');
  return tail === 'mcp serve' && words.some((word) => /(^|[\\/])sdlc(\.\w+)?$/.test(word));
}

/** Sets the `sdlc` entry, keeping every other server and key of the file. */
function register(root: string, target: McpTarget, launch: McpLaunch, dryRun: boolean): McpChange {
  const json = readJson(root, target.file) ?? {};
  const map = servers(json, target.key);
  const entry = target.entry(launch);
  const had = map[SERVER_NAME] !== undefined;
  if (had && isDeepStrictEqual(map[SERVER_NAME], entry)) return 'unchanged';
  json[target.key] = { ...map, [SERVER_NAME]: entry };
  if (!dryRun) writeJson(root, target.file, json);
  return had ? 'updated' : 'installed';
}

/** Removes our `sdlc` entry only; a file left with nothing in it is removed too. Invalid JSON is left alone. */
function unregister(root: string, target: McpTarget, dryRun: boolean): McpChange {
  let json: Record<string, unknown> | undefined;
  try {
    json = readJson(root, target.file);
  } catch {
    return 'kept (invalid JSON)';
  }
  const map = json ? servers(json, target.key) : {};
  if (!json || !isOurServer(map[SERVER_NAME])) return 'absent';
  const rest = { ...map };
  delete rest[SERVER_NAME];
  if (Object.keys(rest).length > 0) json[target.key] = rest;
  else delete json[target.key];
  if (dryRun) return 'removed';
  if (Object.keys(json).length > 0) writeJson(root, target.file, json);
  else fs.rmSync(path.join(root, target.file), { force: true });
  return 'removed';
}

/** Sets `[mcp_servers.sdlc]` in `.codex/config.toml`, keeping every other table and key (B82). */
function codexRegister(root: string, launch: McpLaunch, dryRun: boolean): McpChange {
  const text = readConfigToml(root) ?? '';
  const table = sdlcServerTable(launch.command, launch.args);
  const current = mcpTables(text)[SERVER_NAME];
  if (current === table) return 'unchanged';
  if (!dryRun) writeConfigToml(root, setMcpTables(text, { [SERVER_NAME]: table }));
  return current === undefined ? 'installed' : 'updated';
}

/** Removes sdlc's `[mcp_servers.sdlc]` only; a file left empty is removed. */
function codexUnregister(root: string, dryRun: boolean): McpChange {
  const text = readConfigToml(root);
  if (text === undefined || !isOurSdlcTable(mcpTables(text)[SERVER_NAME])) return 'absent';
  if (!dryRun) writeConfigToml(root, setMcpTables(text, { [SERVER_NAME]: undefined }));
  return 'removed';
}

/** Codex's change, reported like a quiet target: an `absent` file is left out. */
function reportCodex(changes: Record<string, McpChange>, change: McpChange): void {
  if (change !== 'absent') changes[CODEX_CONFIG_PATH] = change;
}

/** Records a file's change; a quiet target's `absent` is left out. */
function report(changes: Record<string, McpChange>, target: McpTarget, change: McpChange): void {
  if (target.quiet && change === 'absent') return;
  changes[target.file] = change;
}

/**
 * While `mcp.serve` is true: registers the server for each configured tool and removes our entry for a tool that
 * is no longer configured. `serve: false` removes our entries; without an `mcp` block nothing is read or written.
 * Keyed by file.
 */
export function applyMcpRegistration(
  root: string,
  config: SdlcConfig,
  tools: ToolId[],
  dryRun = false,
): Record<string, McpChange> {
  if (!config.mcp) return {};
  if (!config.mcp.serve) return removeMcpRegistration(root, dryRun);
  const launch = mcpLaunch(config.cli);
  const changes: Record<string, McpChange> = {};
  for (const [tool, target] of Object.entries(TARGETS) as Array<[ToolId, McpTarget]>) {
    const wanted = tools.includes(tool);
    const change = wanted ? register(root, target, launch, dryRun) : unregister(root, target, dryRun);
    report(changes, target, change);
  }
  const codex = tools.includes('codex') ? codexRegister(root, launch, dryRun) : codexUnregister(root, dryRun);
  reportCodex(changes, codex);
  return changes;
}

/** `sdlc uninstall`: removes only the `sdlc` entries, whatever sdlc.yaml says. Keyed by file. */
export function removeMcpRegistration(root: string, dryRun = false): Record<string, McpChange> {
  const changes: Record<string, McpChange> = {};
  for (const target of Object.values(TARGETS)) report(changes, target, unregister(root, target, dryRun));
  reportCodex(changes, codexUnregister(root, dryRun));
  return changes;
}
