import { t } from '../core/i18n.js';
import { listToolNames, McpTimeout } from './client.js';
import { maskSecrets } from './checks.js';
import { expandedSecrets, type McpServer } from './registry.js';

/**
 * `sdlc mcp check` (B11): connects to each registry server, lists its tools and closes. A server that does not
 * answer within 10 s is unavailable. A tool that looks like it writes files gets a warning: its name holds a verb
 * (write, edit, create, delete, move, rename, patch) and an object (file, dir, path), as in `write_file`.
 */
export const LIST_TIMEOUT_MS = 10_000;
const WRITE_VERB = /write|edit|create|delete|move|rename|patch/;
const FILE_OBJECT = /file|dir|path/;

export interface ServerReport {
  name: string;
  type: McpServer['type'];
  available: boolean;
  tools: string[];
  warnings: string[];
  error?: string;
}

/** A tool whose name says it writes files. */
export function writesFiles(tool: string): boolean {
  const name = tool.toLowerCase();
  return WRITE_VERB.test(name) && FILE_OBJECT.test(name);
}

function failure(error: unknown): string {
  if (error instanceof McpTimeout) return t('mcp.checkTimeout', { seconds: Math.round(error.ms / 1000) });
  return error instanceof Error ? error.message : String(error);
}

async function checkServer(server: McpServer, ms: number): Promise<ServerReport> {
  const base = { name: server.name, type: server.type };
  try {
    const tools = await listToolNames(server, ms);
    const warnings = tools.filter(writesFiles).map((tool) => t('mcp.writesFiles', { tool }));
    return { ...base, available: true, tools, warnings };
  } catch (error) {
    const text = String(maskSecrets(failure(error), expandedSecrets(server, process.env)));
    return { ...base, available: false, tools: [], warnings: [], error: text || t('mcp.checkFailed') };
  }
}

/** Every server, checked at the same time; reports in the registry's order. */
export function checkServers(servers: McpServer[], ms = LIST_TIMEOUT_MS): Promise<ServerReport[]> {
  return Promise.all(servers.map((server) => checkServer(server, ms)));
}
