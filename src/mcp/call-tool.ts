import { runCli, type CliCallerContext, type CliRun } from './run-cli.js';
import { checkArguments, findTool, isWriteTool } from './tools.js';
import { canonical, parseExtensions } from '../plugins/api.js';
import { toDiagnostic } from '../core/errors.js';

/**
 * One tools/call of `sdlc mcp serve` (B13) in one project: the arguments checked, the CLI command run with `--json`
 * in a child process, its JSON as the result.
 */

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type CliRunner = (args: string[], cwd: string, caller?: CliCallerContext) => Promise<CliRun>;

/** A tool error in the CLI's own JSON shape, for failures that happen before or around the command. */
export function errorResult(code: string, message: string): ToolResult {
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
  executor?: string,
): Promise<ToolResult> {
  if (isWriteTool(name) && executor === undefined) {
    return errorResult('executor_token_required', 'An executor token is required for this board tool.');
  }
  const tool = findTool(name);
  if (!tool) return errorResult('unknown_tool', `unknown tool: ${name}`);
  let scalar = input;
  let extensions: string[] = [];
  if (tool.extensions && input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const { ext, ...rest } = input as Record<string, unknown>;
    scalar = rest;
    try {
      const parsed = parseExtensions(ext);
      if (parsed !== undefined) extensions = ['--ext-json', canonical(parsed)];
    } catch (error) {
      const diagnostic = toDiagnostic(error);
      return errorResult(diagnostic.code, diagnostic.message);
    }
  }
  const args = checkArguments(tool, scalar);
  if (typeof args === 'string') return errorResult('invalid_arguments', `${name}: ${args}`);
  if (name === 'task_export' && executor !== undefined) {
    if (args.executor !== undefined && args.executor !== executor) {
      return errorResult('invalid_arguments', 'Task export target does not match the authenticated executor.');
    }
    args.executor = executor;
  }
  const identity = isWriteTool(name) ? ['--executor', executor ?? ''] : [];
  const argv = [...tool.argv(args), ...identity, ...extensions, '--json'];
  return resultOf(await run(argv, cwd, { origin: 'mcp', ...(executor ? { executor } : {}) }), name);
}
