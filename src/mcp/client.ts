import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { harnessVersion } from '../core/version.js';
import { expandRefs, mapValues, type McpServer } from './registry.js';

/**
 * The CLI as an MCP client (B11, B12): it reaches a registry server itself, so what a check answers comes from the
 * server, not from an agent. stdio: the server is spawned with the CLI's environment plus its `env` (references
 * expanded from that environment); its stderr is dropped, since it may print what it was given. http: Streamable
 * HTTP with its `headers` (expanded likewise). Every session is closed when the work ends or its time runs out; a
 * stdio server that runs out of time is ended at once.
 */
export class McpTimeout extends Error {
  constructor(readonly ms: number) {
    super(`no answer within ${Math.round(ms / 1000)} s`);
  }
}

function stdioTransport(server: Extract<McpServer, { type: 'stdio' }>, env: NodeJS.ProcessEnv): Transport {
  const own = mapValues(server.env, (value) => expandRefs(value, env));
  const inherited = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string'));
  const [command, ...args] = server.command.map((word) => expandRefs(word, env));
  return new StdioClientTransport({ command, args, env: { ...inherited, ...own }, stderr: 'ignore' });
}

function httpTransport(server: Extract<McpServer, { type: 'http' }>, env: NodeJS.ProcessEnv): Transport {
  const headers = mapValues(server.headers, (value) => expandRefs(value, env));
  return new StreamableHTTPClientTransport(new URL(expandRefs(server.url, env)), { requestInit: { headers } });
}

function transportFor(server: McpServer, env: NodeJS.ProcessEnv): Transport {
  return server.type === 'stdio' ? stdioTransport(server, env) : httpTransport(server, env);
}

/** `work` or a McpTimeout after `ms`, whichever comes first; `onTimeout` runs when time is up. */
async function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      onTimeout();
      reject(new McpTimeout(ms));
    }, ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ends a stdio server at once. A server that did not answer in time may ignore its closed stdin too, and a polite
 * close waits for it up to 4 s, which would keep the CLI alive past its time limit.
 */
function killServer(transport: Transport): void {
  const pid = transport instanceof StdioClientTransport ? transport.pid : null;
  if (!pid) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // It has exited already.
  }
}

/** Connects to `server`, runs `fn` with the client, closes; all of it within `ms`. */
export async function withServer<T>(
  server: McpServer,
  ms: number,
  fn: (client: Client) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
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
  } finally {
    close();
  }
}

/** One argument of a tool, taken from its input schema. */
export interface ToolArg {
  name: string;
  /** JSON Schema `type` when it is a string, or several joined with `|`; omitted when absent. */
  type?: string;
  required: boolean;
}

/** A tool listed by the server, with arguments from its input schema. */
export interface ListedTool {
  name: string;
  args: ToolArg[];
}

/** JSON Schema `type` as a string, or several joined with `|`; undefined when absent. */
function schemaType(prop: unknown): string | undefined {
  if (!prop || typeof prop !== 'object') return undefined;
  const value = (prop as { type?: unknown }).type;
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join('|');
  }
  return undefined;
}

/** Arguments from a tool's input schema, in property order; empty when there are no properties. */
export function argsFromSchema(schema: unknown): ToolArg[] {
  if (!schema || typeof schema !== 'object') return [];
  const record = schema as { properties?: Record<string, unknown>; required?: unknown };
  const properties = record.properties;
  if (!properties || typeof properties !== 'object') return [];
  const required = new Set(
    Array.isArray(record.required)
      ? record.required.filter((name): name is string => typeof name === 'string')
      : [],
  );
  return Object.entries(properties).map(([name, prop]) => {
    const type = schemaType(prop);
    const arg: ToolArg = { name, required: required.has(name) };
    if (type !== undefined) arg.type = type;
    return arg;
  });
}

/** The server's tools and their arguments (one `tools/list` session, paged). */
export async function listTools(server: McpServer, ms: number): Promise<ListedTool[]> {
  return withServer(server, ms, async (client) => {
    const tools: ListedTool[] = [];
    let cursor: string | undefined;
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
export async function listToolNames(server: McpServer, ms: number): Promise<string[]> {
  const tools = await listTools(server, ms);
  return tools.map((tool) => tool.name);
}

/** What one tool call answered. */
export interface ToolAnswer {
  isError: boolean;
  /** `structuredContent`, else the first text part parsed as JSON (the text itself when it is not JSON). */
  result: unknown;
  text?: string;
}

function firstText(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const part = content.find((item) => item && typeof item === 'object' && item.type === 'text');
  return typeof part?.text === 'string' ? part.text : undefined;
}

/** A tool call's raw answer as a ToolAnswer. */
export function parseAnswer(answer: Record<string, unknown>): ToolAnswer {
  const text = firstText(answer.content);
  const isError = answer.isError === true;
  if (answer.structuredContent !== undefined) return { isError, result: answer.structuredContent, text };
  if (text === undefined) return { isError, result: undefined };
  try {
    return { isError, result: JSON.parse(text) as unknown, text };
  } catch {
    return { isError, result: text, text };
  }
}

/** Calls `tool` with `args` on `server`. */
export async function callServerTool(
  server: McpServer,
  tool: string,
  args: Record<string, unknown>,
  ms: number,
): Promise<ToolAnswer> {
  return withServer(server, ms, async (client) => {
    const answer = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: ms });
    return parseAnswer(answer as Record<string, unknown>);
  });
}
