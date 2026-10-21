import { HUMAN_COMMANDS } from './human-commands.js';

/**
 * How a shell command is recognized as a person's sdlc command (moved out of policy.ts for B18, unchanged): the hook
 * denies it to an agent, and a pack may not bring it in a check or a workflow (`src/team/pack-contents.ts`).
 */

/** The binary as agents spell it: `sdlc`, its old name, `sdlc.js` and the Windows shims `sdlc.cmd`, `sdlc.ps1`. */
const CLI_BINARY = String.raw`\b(?:sdlc|scdl)(?:\.(?:js|cmd|ps1|exe))?`;
/** Global options between the binary and the subcommand: `--locale en`, `--locale=xx`, `-h`. */
const GLOBAL_OPTIONS = String.raw`(?:\s+--?[a-z][\w-]*(?:=[^\s;&|]+|\s+[^\s;&|-][^\s;&|]*)?)*`;
/** The CLI and its global options, as the takeover rule matches an sdlc step on a held change. */
export const CLI_PREFIX = `${CLI_BINARY}${GLOBAL_OPTIONS}`;
const HUMAN_NAMES = HUMAN_COMMANDS.map((name) => name.replace(/ /g, '\\s+')).join('|');
// Every human-only catalog command is guarded here, including license set.
// Case-insensitive: `SDLC.CMD approve` runs the same command on Windows.
const APPROVAL_COMMAND = new RegExp(`${CLI_BINARY}${GLOBAL_OPTIONS}\\s+(?:${HUMAN_NAMES})\\b`, 'i');
const ADOPT_APPLY_COMMAND = new RegExp(`${CLI_BINARY}${GLOBAL_OPTIONS}\\s+adopt\\b[^;&|\\r\\n]*--apply\\b`, 'i');
const INIT_ROLES_COMMAND = new RegExp(`${CLI_BINARY}${GLOBAL_OPTIONS}\\s+init\\b[^;&|\\r\\n]*--roles\\b`, 'i');

/** Joins `\`-newline (sh) and backtick-newline (PowerShell) continuations, so a split command reads as one. */
export function joinContinuations(command: string): string {
  return command.replace(/[\\`]\r?\n/g, ' ');
}

/** True when the text calls a human-only sdlc command (HUMAN_COMMANDS, `adopt --apply`, `init --roles`). */
export function callsHumanCommand(text: string): boolean {
  const cmd = joinContinuations(text);
  return APPROVAL_COMMAND.test(cmd) || ADOPT_APPLY_COMMAND.test(cmd) || INIT_ROLES_COMMAND.test(cmd);
}
