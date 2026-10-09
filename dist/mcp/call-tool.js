import { runCli } from './run-cli.js';
import { checkArguments, findTool } from './tools.js';
/** A tool error in the CLI's own JSON shape, for failures that happen before or around the command. */
export function errorResult(code, message) {
    const json = { status: [{ severity: 'error', code, message }] };
    return { content: [{ type: 'text', text: JSON.stringify(json) }], structuredContent: json, isError: true };
}
/** A JSON value as structured content: an object as it is, anything else under `value`. */
function asStructured(value) {
    const plain = typeof value === 'object' && value !== null && !Array.isArray(value);
    return plain ? value : { value };
}
/** The CLI reported an error in its JSON: `status: [diagnostic]` with an error diagnostic. */
function reportsError(json) {
    const status = json.status;
    if (!Array.isArray(status))
        return false;
    return status.some((item) => typeof item === 'object' && item !== null
        && item.severity === 'error');
}
/** The tool result of one finished CLI run. */
export function resultOf(run, command) {
    if (run.failure !== undefined)
        return errorResult('cli_not_started', `sdlc ${command}: ${run.failure}`);
    let json;
    try {
        json = JSON.parse(run.stdout);
    }
    catch {
        const detail = (run.stderr || run.stdout).trim().split('\n').slice(-3).join(' ');
        return errorResult('cli_output_not_json', `sdlc ${command} exited ${run.code}: ${detail}`);
    }
    const structured = asStructured(json);
    const failed = run.code !== 0 || reportsError(structured);
    const text = JSON.stringify(structured);
    const result = { content: [{ type: 'text', text }], structuredContent: structured };
    return failed ? { ...result, isError: true } : result;
}
/** Answers one tools/call: checks the arguments, runs the CLI command with `--json`, returns its JSON. */
export async function callTool(name, input, cwd, run = runCli) {
    const tool = findTool(name);
    if (!tool)
        return errorResult('unknown_tool', `unknown tool: ${name}`);
    const args = checkArguments(tool, input);
    if (typeof args === 'string')
        return errorResult('invalid_arguments', `${name}: ${args}`);
    const argv = [...tool.argv(args), '--json'];
    return resultOf(await run(argv, cwd), name);
}
