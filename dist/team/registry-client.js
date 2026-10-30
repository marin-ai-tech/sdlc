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
/** Runs `fn` with a caller of the registry's tools, in one session closed afterwards. */
export async function withRegistry(server, fn) {
    return withServer(server, REGISTRY_MS, async (client) => fn(caller(client)));
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
