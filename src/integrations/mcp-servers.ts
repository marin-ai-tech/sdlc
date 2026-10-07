import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { mapValues, openCodeRefs, type McpServer } from '../mcp/registry.js';
import { readManifest, writeManifest, type Manifest } from './manifest.js';
import { readJson, servers as serverMap, writeJson } from './mcp-config.js';
import type { ToolId } from './types.js';

/**
 * Lays out the team's MCP registry (B10, `mcp.servers` in sdlc.yaml) for the tools, next to the `sdlc` entry of
 * 090-A and with the same merge: other servers and keys stay, a file left empty is removed.
 * - claude: `.mcp.json` `mcpServers.<name>`: stdio `{ type, command, args, env }`, http `{ type, url, headers }`;
 * - opencode: `opencode.json` `mcp.<name>`: stdio `{ type: "local", command, environment, enabled }`, http
 *   `{ type: "remote", url, headers, enabled }`, with `${VAR}` written `{env:VAR}`.
 * The manifest (`mcpServers`) keeps the names sdlc wrote per file: a name dropped from the registry is removed, and
 * an entry a person wrote is never touched (kept, and reported, when the registry has a server of that name).
 */
export interface ServerChanges {
  added: string[];
  updated: string[];
  removed: string[];
  kept: string[];
}

interface Target {
  tool: ToolId;
  file: string;
  key: string;
  entry: (server: McpServer) => Record<string, unknown>;
}

interface Layout {
  changes: ServerChanges;
  owned: string[];
}

/** `{ key: map }` when the map has entries, else nothing: empty `env`/`headers` are omitted. */
function nonEmpty(key: string, map: Record<string, string>): Record<string, unknown> {
  return Object.keys(map).length > 0 ? { [key]: map } : {};
}

function claudeEntry(server: McpServer): Record<string, unknown> {
  if (server.type === 'http') return { type: 'http', url: server.url, ...nonEmpty('headers', server.headers) };
  const [command, ...args] = server.command;
  return { type: 'stdio', command, args, ...nonEmpty('env', server.env) };
}

function openCodeEntry(server: McpServer): Record<string, unknown> {
  if (server.type === 'http') {
    const headers = mapValues(server.headers, openCodeRefs);
    return { type: 'remote', url: openCodeRefs(server.url), ...nonEmpty('headers', headers), enabled: true };
  }
  const environment = mapValues(server.env, openCodeRefs);
  const command = server.command.map(openCodeRefs);
  return { type: 'local', command, ...nonEmpty('environment', environment), enabled: true };
}

const TARGETS: Target[] = [
  { tool: 'claude', file: '.mcp.json', key: 'mcpServers', entry: claudeEntry },
  { tool: 'opencode', file: 'opencode.json', key: 'mcp', entry: openCodeEntry },
];

function noChanges(): ServerChanges {
  return { added: [], updated: [], removed: [], kept: [] };
}

function changed(changes: ServerChanges): boolean {
  return changes.added.length + changes.updated.length + changes.removed.length > 0;
}

/** Sets the wanted entries in `map`; returns the names that are sdlc's after it. */
function setWanted(
  map: Record<string, unknown>,
  target: Target,
  wanted: McpServer[],
  owned: string[],
  changes: ServerChanges,
): string[] {
  const mine: string[] = [];
  for (const server of wanted) {
    const entry = target.entry(server);
    const current = map[server.name];
    if (current !== undefined && !isDeepStrictEqual(current, entry) && !owned.includes(server.name)) {
      changes.kept.push(server.name);
      continue;
    }
    if (current === undefined) changes.added.push(server.name);
    else if (!isDeepStrictEqual(current, entry)) changes.updated.push(server.name);
    map[server.name] = entry;
    mine.push(server.name);
  }
  return mine;
}

/** Removes the entries sdlc wrote that the registry no longer has. */
function dropUnwanted(map: Record<string, unknown>, wanted: McpServer[], owned: string[], changes: ServerChanges) {
  for (const name of owned) {
    if (wanted.some((server) => server.name === name) || map[name] === undefined) continue;
    delete map[name];
    changes.removed.push(name);
  }
}

/** The file's JSON; undefined when absent. Invalid JSON is an error only when something is to be written. */
function readTarget(root: string, target: Target, wanted: McpServer[]): Record<string, unknown> | undefined {
  try {
    return readJson(root, target.file);
  } catch (error) {
    if (wanted.length > 0) throw error;
    return undefined;
  }
}

function writeTarget(root: string, target: Target, json: Record<string, unknown>, map: Record<string, unknown>) {
  if (Object.keys(map).length > 0) json[target.key] = map;
  else delete json[target.key];
  if (Object.keys(json).length > 0) writeJson(root, target.file, json);
  else fs.rmSync(path.join(root, target.file), { force: true });
}

function layOut(root: string, target: Target, wanted: McpServer[], owned: string[], dryRun: boolean): Layout {
  const json = readTarget(root, target, wanted);
  if (!json && wanted.length === 0) return { changes: noChanges(), owned: [] };
  const doc = json ?? {};
  const map = { ...serverMap(doc, target.key) };
  const changes = noChanges();
  const mine = setWanted(map, target, wanted, owned, changes);
  dropUnwanted(map, wanted, owned, changes);
  if (changed(changes) && !dryRun) writeTarget(root, target, doc, map);
  return { changes, owned: mine };
}

function saveOwned(root: string, manifest: Manifest, owned: Record<string, string[]>, dryRun: boolean): void {
  const before = manifest.mcpServers ?? {};
  if (dryRun || isDeepStrictEqual(before, owned)) return;
  if (Object.keys(owned).length > 0) manifest.mcpServers = owned;
  else delete manifest.mcpServers;
  writeManifest(root, manifest);
}

/** Lays out `servers` for the configured tools; a tool not configured loses sdlc's entries. Keyed by file. */
export function applyRegistryServers(
  root: string,
  servers: McpServer[],
  tools: ToolId[],
  dryRun = false,
): Record<string, ServerChanges> {
  const manifest = readManifest(root);
  const result: Record<string, ServerChanges> = {};
  const owned: Record<string, string[]> = {};
  for (const target of TARGETS) {
    const wanted = tools.includes(target.tool) ? servers : [];
    const layout = layOut(root, target, wanted, manifest.mcpServers?.[target.file] ?? [], dryRun);
    if (layout.owned.length > 0) owned[target.file] = layout.owned;
    if (changed(layout.changes) || layout.changes.kept.length > 0) result[target.file] = layout.changes;
  }
  saveOwned(root, manifest, owned, dryRun);
  return result;
}

/** `sdlc uninstall`: removes only the registry entries sdlc wrote. Keyed by file. */
export function removeRegistryServers(root: string, dryRun = false): Record<string, ServerChanges> {
  return applyRegistryServers(root, [], [], dryRun);
}
