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
 * HTTP with its `headers` (expanded likewise). Every session is closed when the work ends or its time runs out.
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

/** Connects to `server`, runs `fn` with the client, closes; all of it within `ms`. */
export async function withServer<T>(
  server: McpServer,
  ms: number,
  fn: (client: Client) => Promise<T>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<T> {
  const client = new Client({ name: 'sdlc', version: harnessVersion() });
  const close = () => {
    client.close().catch(() => undefined);
  };
  const session = async () => {
    await client.connect(transportFor(server, env), { timeout: ms });
    return fn(client);
  };
  try {
    return await withTimeout(session(), ms, close);
  } finally {
    close();
  }
}

/** The names of the server's tools. */
export async function listToolNames(server: McpServer, ms: number): Promise<string[]> {
  return withServer(server, ms, async (client) => {
    const names: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { timeout: ms });
      names.push(...page.tools.map((tool) => tool.name));
      cursor = page.nextCursor;
    } while (cursor);
    return names;
  });
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

function parseAnswer(answer: Record<string, unknown>): ToolAnswer {
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
