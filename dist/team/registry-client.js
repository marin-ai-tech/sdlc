import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { SdlcError } from '../core/errors.js';
import { parseAnswer, withServer } from '../mcp/client.js';
/**
 * The team registry over MCP (B71): the server `team.registry` names, reached by the CLI itself with the MCP client
 * (`src/mcp/client.ts`), so what arrives comes from the registry, not from an agent. One session per command;
 * an answer marked as an error refuses that one item (`RegistryItemError`), any other failure means the registry
 * is unreachable.
 */
export const REGISTRY_MS = 30000;
export class RegistryItemError extends Error {
}
/** The tools without which a server is not a team registry (B315). */
export const ROLE_TOOLS = ['list_roles', 'get_role'];
/**
 * B315: the server answered but is not a team registry: SkillForge serves the role tools only while its
 * `sdlc-registry` plugin is on. Not the fallback of an unreachable server: the command fails and writes nothing.
 */
export class RegistryToolsMissing extends SdlcError {
    server;
    missing;
    constructor(server, missing) {
        const params = { server, tools: missing.join(', ') };
        super('registry_tools_missing', { key: 'team.registry.toolsMissing', params }, { key: 'fix.registryToolsMissing' });
        this.server = server;
        this.missing = missing;
    }
}
/** The registry server of the project, or undefined when `team.registry` is not set. */
export function registryServer(config) {
    const name = config.team?.registry;
    return name ? config.mcp?.servers?.find((server) => server.name === name) : undefined;
}
function caller(client) {
    return async (tool, args = {}) => {
        const raw = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: REGISTRY_MS });
        const answer = parseAnswer(raw);
        if (answer.isError)
            throw new RegistryItemError(`${tool}: ${(answer.text ?? 'error').slice(0, 200)}`);
        return answer.result;
    };
}
/** The server's tool names; none when it answers that it has no tool list (review F5: it answered, not a registry). */
async function toolNames(client) {
    const names = new Set();
    let cursor;
    try {
        do {
            const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: REGISTRY_MS });
            for (const tool of page.tools)
                names.add(tool.name);
            cursor = page.nextCursor;
        } while (cursor);
    }
    catch (error) {
        if (error instanceof McpError && error.code === ErrorCode.MethodNotFound)
            return new Set();
        throw error;
    }
    return names;
}
/**
 * Runs `fn` with a caller of the registry's tools, in one session closed afterwards. A server that does not list
 * both role tools is refused before `fn` runs (`RegistryToolsMissing`).
 */
export async function withRegistry(server, fn) {
    return withServer(server, REGISTRY_MS, async (client) => {
        const names = await toolNames(client);
        const missing = ROLE_TOOLS.filter((tool) => !names.has(tool));
        if (missing.length > 0)
            throw new RegistryToolsMissing(server.name, missing);
        return fn(caller(client));
    });
}
/** Refuses a project whose `team.registry` answers without the role tools; a server that does not answer passes. */
export async function assertRegistryTools(config) {
    const server = registryServer(config);
    if (!server)
        return;
    try {
        await withRegistry(server, async () => undefined);
    }
    catch (error) {
        if (error instanceof RegistryToolsMissing)
            throw error;
    }
}
/** The entries of a list answer (`{ roles: [...] }`, `{ skills: [...] }`); anything else is none. */
export function listed(answer, key) {
    const list = answer && typeof answer === 'object' ? answer[key] : undefined;
    if (!Array.isArray(list))
        return [];
    return list.filter((item) => Boolean(item) && typeof item === 'object');
}
/** A short reason for a failure, without a stack. */
export function failure(error) {
    const text = error instanceof Error ? error.message : String(error);
    return text.split('\n')[0].slice(0, 200);
}
