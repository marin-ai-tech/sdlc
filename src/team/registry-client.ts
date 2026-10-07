import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { SdlcConfig } from '../core/config.js';
import { parseAnswer, withServer } from '../mcp/client.js';
import type { McpServer } from '../mcp/registry.js';

/**
 * The team registry over MCP (B71): the server `team.registry` names, reached by the CLI itself with the MCP client
 * (`src/mcp/client.ts`), so what arrives comes from the registry, not from an agent. One session per command;
 * an answer marked as an error refuses that one item (`RegistryItemError`), any other failure means the registry
 * is unreachable.
 */
export const REGISTRY_MS = 30000;

export type RegistryCall = (tool: string, args?: Record<string, unknown>) => Promise<unknown>;

export class RegistryItemError extends Error {}

/** The registry server of the project, or undefined when `team.registry` is not set. */
export function registryServer(config: SdlcConfig): McpServer | undefined {
  const name = config.team?.registry;
  return name ? config.mcp?.servers?.find((server) => server.name === name) : undefined;
}

function caller(client: Client): RegistryCall {
  return async (tool, args = {}) => {
    const raw = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: REGISTRY_MS });
    const answer = parseAnswer(raw as Record<string, unknown>);
    if (answer.isError) throw new RegistryItemError(`${tool}: ${(answer.text ?? 'error').slice(0, 200)}`);
    return answer.result;
  };
}

/** Runs `fn` with a caller of the registry's tools, in one session closed afterwards. */
export async function withRegistry<T>(server: McpServer, fn: (call: RegistryCall) => Promise<T>): Promise<T> {
  return withServer(server, REGISTRY_MS, async (client) => fn(caller(client)));
}

/** The entries of a list answer (`{ roles: [...] }`, `{ skills: [...] }`); anything else is none. */
export function listed(answer: unknown, key: string): Array<Record<string, unknown>> {
  const list = answer && typeof answer === 'object' ? (answer as Record<string, unknown>)[key] : undefined;
  if (!Array.isArray(list)) return [];
  return list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

/** A short reason for a failure, without a stack. */
export function failure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.split('\n')[0].slice(0, 200);
}
