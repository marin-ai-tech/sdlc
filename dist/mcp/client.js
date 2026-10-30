import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { harnessVersion } from '../core/version.js';
import { expandRefs, mapValues } from './registry.js';
/**
 * The CLI as an MCP client (B11, B12): it reaches a registry server itself, so what a check answers comes from the
 * server, not from an agent. stdio: the server is spawned with the CLI's environment plus its `env` (references
 * expanded from that environment); its stderr is dropped, since it may print what it was given. http: Streamable
 * HTTP with its `headers` (expanded likewise). Every session is closed when the work ends or its time runs out; a
 * stdio server that runs out of time is ended at once.
 */
export class McpTimeout extends Error {
    ms;
    constructor(ms) {
        super(`no answer within ${Math.round(ms / 1000)} s`);
        this.ms = ms;
    }
}
function stdioTransport(server, env) {
    const own = mapValues(server.env, (value) => expandRefs(value, env));
    const inherited = Object.fromEntries(Object.entries(env).filter((entry) => typeof entry[1] === 'string'));
    const [command, ...args] = server.command.map((word) => expandRefs(word, env));
    return new StdioClientTransport({ command, args, env: { ...inherited, ...own }, stderr: 'ignore' });
}
function httpTransport(server, env) {
    const headers = mapValues(server.headers, (value) => expandRefs(value, env));
    return new StreamableHTTPClientTransport(new URL(expandRefs(server.url, env)), { requestInit: { headers } });
}
function transportFor(server, env) {
    return server.type === 'stdio' ? stdioTransport(server, env) : httpTransport(server, env);
}
/** `work` or a McpTimeout after `ms`, whichever comes first; `onTimeout` runs when time is up. */
async function withTimeout(work, ms, onTimeout) {
    let timer;
    const late = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            onTimeout();
            reject(new McpTimeout(ms));
        }, ms);
    });
    try {
        return await Promise.race([work, late]);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Ends a stdio server at once. A server that did not answer in time may ignore its closed stdin too, and a polite
 * close waits for it up to 4 s, which would keep the CLI alive past its time limit.
 */
function killServer(transport) {
    const pid = transport instanceof StdioClientTransport ? transport.pid : null;
    if (!pid)
        return;
    try {
        process.kill(pid, 'SIGKILL');
    }
    catch {
        // It has exited already.
    }
}
/** Connects to `server`, runs `fn` with the client, closes; all of it within `ms`. */
export async function withServer(server, ms, fn, env = process.env) {
    const client = new Client({ name: 'sdlc', version: harnessVersion() });
    const transport = transportFor(server, env);
    const close = () => {
        client.close().catch(() => undefined);
    };
    const timedOut = () => {
        killServer(transport);
        close();
    };
    const session = async () => {
        await client.connect(transport, { timeout: ms });
        return fn(client);
    };
    try {
        return await withTimeout(session(), ms, timedOut);
    }
    finally {
        close();
    }
}
/** JSON Schema `type` as a string, or several joined with `|`; undefined when absent. */
function schemaType(prop) {
    if (!prop || typeof prop !== 'object')
        return undefined;
    const value = prop.type;
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        return value.join('|');
    }
    return undefined;
}
/** Arguments from a tool's input schema, in property order; empty when there are no properties. */
export function argsFromSchema(schema) {
    if (!schema || typeof schema !== 'object')
        return [];
    const record = schema;
    const properties = record.properties;
    if (!properties || typeof properties !== 'object')
        return [];
    const required = new Set(Array.isArray(record.required)
        ? record.required.filter((name) => typeof name === 'string')
        : []);
    return Object.entries(properties).map(([name, prop]) => {
        const type = schemaType(prop);
        const arg = { name, required: required.has(name) };
        if (type !== undefined)
            arg.type = type;
        return arg;
    });
}
/** The server's tools and their arguments (one `tools/list` session, paged). */
export async function listTools(server, ms) {
    return withServer(server, ms, async (client) => {
        const tools = [];
        let cursor;
        do {
            const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: ms });
            for (const tool of page.tools) {
                tools.push({ name: tool.name, args: argsFromSchema(tool.inputSchema) });
            }
            cursor = page.nextCursor;
        } while (cursor);
        return tools;
    });
}
/** The names of the server's tools. */
export async function listToolNames(server, ms) {
    const tools = await listTools(server, ms);
    return tools.map((tool) => tool.name);
}
function firstText(content) {
    if (!Array.isArray(content))
        return undefined;
    const part = content.find((item) => item && typeof item === 'object' && item.type === 'text');
    return typeof part?.text === 'string' ? part.text : undefined;
}
/** A tool call's raw answer as a ToolAnswer. */
export function parseAnswer(answer) {
    const text = firstText(answer.content);
    const isError = answer.isError === true;
    if (answer.structuredContent !== undefined)
        return { isError, result: answer.structuredContent, text };
    if (text === undefined)
        return { isError, result: undefined };
    try {
        return { isError, result: JSON.parse(text), text };
    }
    catch {
        return { isError, result: text, text };
    }
}
/** Calls `tool` with `args` on `server`. */
export async function callServerTool(server, tool, args, ms) {
    return withServer(server, ms, async (client) => {
        const answer = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: ms });
        return parseAnswer(answer);
    });
}
