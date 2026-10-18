import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { readExecutors, type Executor } from '../core/executors.js';
import { SdlcError } from '../core/errors.js';
import { harnessVersion } from '../core/version.js';
import { resolveProjects, type Caller, type ServedProject } from './projects.js';
import { runCli } from './run-cli.js';
import { createServer } from './server.js';

/**
 * `sdlc mcp serve --http <host:port>` (B100): the MCP server over Streamable HTTP at `/mcp`.
 * A bearer token is always required (localhost too): the server token from SDLC_MCP_TOKEN, or (B118) the token of
 * an executor of a served project's registry — the SHA-256 of the presented token must equal a `token_sha256`,
 * read at request time so a reissued token or a removed executor stops working at once. Only `/mcp` is served;
 * other paths are 404.
 */

const MCP_PATH = '/mcp';
const MAX_BODY = 1_048_576;
const MIN_TOKEN_LEN = 16;
const MAX_PORT = 65535;

export interface HttpAddress {
  host: string;
  port: number;
}

/** The host without the brackets of an IPv6 address such as `[::1]`. */
function bareHost(host: string): string {
  const bracketed = host.startsWith('[') && host.endsWith(']');
  return bracketed ? host.slice(1, -1) : host;
}

/** A `--http` value: `host:port`; port 0 means any free port. */
export function httpAddress(value: string): HttpAddress {
  const at = value.lastIndexOf(':');
  const host = bareHost(value.slice(0, Math.max(at, 0)));
  const portText = value.slice(at + 1);
  const valid = at > 0 && host !== '' && /^\d+$/.test(portText) && Number(portText) <= MAX_PORT;
  if (!valid) throw new SdlcError('invalid_option', { key: 'error.mcp_http_address_x', params: { value } });
  return { host, port: Number(portText) };
}

/** SDLC_MCP_TOKEN: required, at least 16 characters. Never logged or printed. */
export function requireMcpToken(): string {
  const token = process.env.SDLC_MCP_TOKEN ?? '';
  if (token.length < MIN_TOKEN_LEN) {
    throw new SdlcError('token_required', { key: 'error.token_required' }, { key: 'fix.token_required' });
  }
  return token;
}

function bearerToken(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const match = /^Bearer\s+(\S+)/i.exec(header);
  return match?.[1];
}

/** Constant-time compare when lengths match; different lengths are a mismatch without calling timingSafeEqual. */
export function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** The SHA-256 of a presented token: executor tokens are only ever compared as digests. */
function tokenDigest(token: string): Buffer {
  return crypto.createHash('sha256').update(token, 'utf8').digest();
}

/** Constant-time compare of the presented digest with a stored `token_sha256`; unequal lengths never match. */
function digestMatches(presented: Buffer, storedHex: string): boolean {
  const stored = Buffer.from(storedHex, 'hex');
  return stored.length === presented.length && crypto.timingSafeEqual(presented, stored);
}

/** The executors whose `token_sha256` the served project knows now, read at request time: revocation is immediate. */
function executorsOf(root: string): Executor[] {
  try {
    return [...(readExecutors(root)?.values() ?? [])];
  } catch {
    // A broken registry fails closed: no executor token of this project matches. The server token still works.
    return [];
  }
}

/**
 * The executor a bearer token names (B118): the one whose `token_sha256` equals the token's SHA-256 in a served
 * project's registry. Every request reads the registry again, so a reissued token or a removed executor stops
 * working at once. `undefined` when no executor matches — the caller is then only the server token or nothing.
 */
function executorCaller(projects: readonly ServedProject[], provided: string): Caller | undefined {
  const presented = tokenDigest(provided);
  for (const project of projects) {
    for (const executor of executorsOf(project.root)) {
      if (executor.tokenSha256 !== undefined && digestMatches(presented, executor.tokenSha256)) {
        return { project: project.name, executor: executor.id };
      }
    }
  }
  return undefined;
}

/** The caller of a request: the server token gives an empty one, an executor token its identity, else undefined. */
function callerOf(req: http.IncomingMessage, token: string, projects: readonly ServedProject[]): Caller | undefined {
  const got = bearerToken(req.headers.authorization);
  if (got === undefined) return undefined;
  if (tokenMatches(got, token)) return {};
  return executorCaller(projects, got);
}

function requestPath(req: http.IncomingMessage): string {
  try {
    return new URL(req.url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

function defaultPort(protocol: string): number {
  return protocol === 'https:' ? 443 : 80;
}

function hostsMatch(a: string, b: string): boolean {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  if (left === right) return true;
  const loopback = new Set(['localhost', '127.0.0.1', '::1']);
  return loopback.has(left) && loopback.has(right);
}

/**
 * DNS-rebinding hardening: when Origin is present, its host must match the listen host (loopback aliases
 * allowed) and its port must match the listen port. Missing or `null` Origin is allowed (non-browser clients).
 */
export function originAllowed(origin: string | undefined, host: string, port: number): boolean {
  if (origin === undefined || origin === '' || origin === 'null') return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (!hostsMatch(url.hostname, host)) return false;
  const originPort = url.port === '' ? defaultPort(url.protocol) : Number(url.port);
  return originPort === port;
}

function send(res: http.ServerResponse, status: number, body = ''): void {
  const buf = Buffer.from(body, 'utf8');
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function tooLarge(req: http.IncomingMessage): boolean {
  const raw = req.headers['content-length'];
  if (raw === undefined) return false;
  const n = Number(raw);
  return Number.isFinite(n) && n > MAX_BODY;
}

function listeningPort(server: http.Server): number {
  const info = server.address();
  return typeof info === 'object' && info !== null ? info.port : 0;
}

function mcpUrl(host: string, port: number): string {
  const shown = host.includes(':') ? `[${host}]` : host;
  return `http://${shown}:${port}${MCP_PATH}`;
}

function headerOrigin(req: http.IncomingMessage): string | undefined {
  const value = req.headers.origin;
  return typeof value === 'string' ? value : undefined;
}

async function handleMcp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  projects: readonly ServedProject[],
  caller: Caller,
): Promise<void> {
  const server = createServer(projects, runCli, caller);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_BODY,
  });
  await server.connect(transport);
  const release = (): void => {
    void transport.close();
    void server.close();
  };
  res.on('close', release);
  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    release();
    if (!res.headersSent) send(res, 500, 'Internal server error\n');
    const text = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[sdlc mcp] ${text}\n`);
  }
}

function onRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  token: string,
  host: string,
  port: number,
  projects: readonly ServedProject[],
): void {
  if (requestPath(req) !== MCP_PATH) {
    send(res, 404, 'Not Found\n');
    return;
  }
  const caller = callerOf(req, token, projects);
  if (caller === undefined) {
    send(res, 401, 'Unauthorized\n');
    return;
  }
  if (!originAllowed(headerOrigin(req), host, port)) {
    send(res, 403, 'Forbidden\n');
    return;
  }
  if (tooLarge(req)) {
    send(res, 413, 'Payload Too Large\n');
    return;
  }
  void handleMcp(req, res, projects, caller);
}

function listenHttp(server: http.Server, address: HttpAddress): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      const params = { address: `${address.host}:${address.port}`, reason: error.message };
      reject(new SdlcError('serve_failed', { key: 'error.mcp_http_failed', params }));
    };
    server.once('error', onError);
    server.listen(address.port, address.host, () => {
      server.off('error', onError);
      resolve();
    });
  });
}

function waitForStop(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      server.close(() => resolve());
      server.closeAllConnections();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  });
}

/**
 * Serves over Streamable HTTP at /mcp until SIGINT or SIGTERM. Requires SDLC_MCP_TOKEN (at least 16 characters);
 * an executor token alone does not start it. Prints the listen URL (`http://<host>:<port>/mcp`) on stderr.
 */
export async function serveHttp(
  address: string,
  start: string = process.cwd(),
  dirs: readonly string[] = [],
): Promise<void> {
  const token = requireMcpToken();
  const listen = httpAddress(address);
  const projects = resolveProjects(dirs, start);
  const httpServer = http.createServer((req, res) => {
    onRequest(req, res, token, listen.host, listeningPort(httpServer), projects);
  });
  // Clients (executors between board calls) pause longer than Node's 5 s default and then meet a closed socket.
  httpServer.keepAliveTimeout = 65_000;
  httpServer.headersTimeout = 66_000;
  await listenHttp(httpServer, listen);
  process.stderr.write(`${mcpUrl(listen.host, listeningPort(httpServer))}\n`);
  process.stderr.write(`[sdlc mcp] serving over http (version ${harnessVersion()})\n`);
  await waitForStop(httpServer);
}
