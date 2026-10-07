import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { findProjectRoot } from '../core/project.js';
import { harnessVersion } from '../core/version.js';
import { runCli, type CliRun } from './run-cli.js';
import { checkArguments, findTool, READ_TOOLS } from './tools.js';

/**
 * `sdlc mcp serve` (B13): an MCP server over stdio whose tools answer exactly what `sdlc <command> --json` prints.
 * stdout carries only protocol messages; logs go to stderr. Nothing here writes a project file.
 */

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type CliRunner = (args: string[], cwd: string) => Promise<CliRun>;

function log(text: string): void {
  process.stderr.write(`[sdlc mcp] ${text}\n`);
}

/** A tool error in the CLI's own JSON shape, for failures that happen before or around the command. */
function errorResult(code: string, message: string): ToolResult {
  const json = { status: [{ severity: 'error', code, message }] };
  return { content: [{ type: 'text', text: JSON.stringify(json) }], structuredContent: json, isError: true };
}

/** A JSON value as structured content: an object as it is, anything else under `value`. */
function asStructured(value: unknown): Record<string, unknown> {
  const plain = typeof value === 'object' && value !== null && !Array.isArray(value);
  return plain ? value as Record<string, unknown> : { value };
}

/** The CLI reported an error in its JSON: `status: [diagnostic]` with an error diagnostic. */
function reportsError(json: Record<string, unknown>): boolean {
  const status = json.status;
  if (!Array.isArray(status)) return false;
  return status.some((item) => typeof item === 'object' && item !== null
    && (item as { severity?: unknown }).severity === 'error');
}

/** The tool result of one finished CLI run. */
export function resultOf(run: CliRun, command: string): ToolResult {
  if (run.failure !== undefined) return errorResult('cli_not_started', `sdlc ${command}: ${run.failure}`);
  let json: unknown;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    const detail = (run.stderr || run.stdout).trim().split('\n').slice(-3).join(' ');
    return errorResult('cli_output_not_json', `sdlc ${command} exited ${run.code}: ${detail}`);
  }
  const structured = asStructured(json);
  const failed = run.code !== 0 || reportsError(structured);
  const text = JSON.stringify(structured);
  const result: ToolResult = { content: [{ type: 'text', text }], structuredContent: structured };
  return failed ? { ...result, isError: true } : result;
}

/** Answers one tools/call: checks the arguments, runs the CLI command with `--json`, returns its JSON. */
export async function callTool(
  name: string,
  input: unknown,
  cwd: string,
  run: CliRunner = runCli,
): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) return errorResult('unknown_tool', `unknown tool: ${name}`);
  const args = checkArguments(tool, input);
  if (typeof args === 'string') return errorResult('invalid_arguments', `${name}: ${args}`);
  const argv = [...tool.argv(args), '--json'];
  return resultOf(await run(argv, cwd), name);
}

/** The server with its two handlers; `cwd` is the project directory every command runs in. */
export function createServer(cwd: string, run: CliRunner = runCli): Server {
  const server = new Server({ name: 'sdlc', version: harnessVersion() }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: READ_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callTool(request.params.name, request.params.arguments, cwd, run);
  });
  return server;
}

/** Serves over stdio until the client closes the connection. */
export async function serveStdio(start: string = process.cwd()): Promise<void> {
  const cwd = findProjectRoot(start) ?? start;
  const server = createServer(cwd);
  server.onerror = (error) => log(error instanceof Error ? error.message : String(error));
  await server.connect(new StdioServerTransport());
  log(`serving ${cwd} over stdio (version ${harnessVersion()})`);
}
