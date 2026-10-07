import { runCli, type CliRun } from './run-cli.js';
import { checkArguments, findTool } from './tools.js';

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

export type CliRunner = (args: string[], cwd: string) => Promise<CliRun>;

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
): Promise<ToolResult> {
  const tool = findTool(name);
  if (!tool) return errorResult('unknown_tool', `unknown tool: ${name}`);
  const args = checkArguments(tool, input);
  if (typeof args === 'string') return errorResult('invalid_arguments', `${name}: ${args}`);
  const argv = [...tool.argv(args), '--json'];
  return resultOf(await run(argv, cwd), name);
}
