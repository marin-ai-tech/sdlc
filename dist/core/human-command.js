import { loadConfig } from './config.js';
import { findProjectRoot, projectPaths } from './project.js';
/**
 * What a refused human decision tells the person: the exact command to run in their own terminal. In OpenCode and
 * Claude Code a command typed with `!` in the agent chat runs in the agent's shell, so it counts as the agent's;
 * the text says so. The command is the project's CLI prefix (`cli:` in openspec/sdlc.yaml, e.g. `sdlc` or
 * `npx --no-install sdlc`) and the arguments as typed, without `--json` and `--locale`.
 */
/** Longest command quoted in a hook reason; a longer one is cut and ends with `…`. */
export const MAX_QUOTED_COMMAND = 200;
const DEFAULT_CLI = 'sdlc';
let invocation;
/** Records the CLI arguments (argv without node and the script) so a refusal can repeat them. */
export function recordInvocation(args) {
    invocation = [...args];
}
function withoutOutputFlags(args) {
    const kept = [];
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--locale')
            i++;
        else if (arg !== '--json' && !arg.startsWith('--locale='))
            kept.push(arg);
    }
    return kept;
}
function quoteArg(arg) {
    if (arg !== '' && !/[\s"]/.test(arg))
        return arg;
    return `"${arg.replace(/"/g, '\\"')}"`;
}
function projectCli() {
    const root = findProjectRoot();
    if (!root)
        return DEFAULT_CLI;
    try {
        return loadConfig(projectPaths(root).sdlcConfig).cli;
    }
    catch {
        return DEFAULT_CLI;
    }
}
/**
 * The command to show: the CLI prefix and the typed arguments. `fallback` (e.g. `approve`) stands in for the
 * arguments when none were recorded (a command called in-process). `cli` defaults to the project's prefix.
 */
export function typedCommand(fallback, cli = projectCli()) {
    const args = invocation ? withoutOutputFlags(invocation) : fallback.split(' ');
    return [cli, ...args.map(quoteArg)].join(' ');
}
/** Fix of a refused human decision: run the command in your own terminal, not as a `!` command in the agent chat. */
export function humanCommandFix(fallback, cli) {
    const command = typedCommand(fallback, cli);
    return { key: 'fix.run_it_yourself_in_your_own_terminal_not_in_the', params: { command } };
}
/** A command as quoted in a hook reason: one line, no backticks, at most MAX_QUOTED_COMMAND characters. */
export function quotedCommand(command) {
    const flat = command.replace(/\s+/g, ' ').replace(/`/g, "'").trim();
    if (flat.length <= MAX_QUOTED_COMMAND)
        return flat;
    return `${flat.slice(0, MAX_QUOTED_COMMAND - 1)}…`;
}
