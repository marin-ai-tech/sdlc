import { HUMAN_COMMANDS } from '../core/human-commands.js';

/**
 * What the second layer refuses (B84, 0.14.2): Codex's command rules and Qwen's `permissions.deny`.
 * A person's commands (HUMAN_COMMANDS) plus `adopt --apply`, which is a person's command in policy.ts but is not
 * listed in HUMAN_COMMANDS (that list drives `sdlc help`).
 */
export const SECOND_LAYER_COMMANDS: readonly string[] = [...HUMAN_COMMANDS, 'adopt --apply'];

/** The package's alias bin and npm's Windows shims, spelled only when the configured cli is exactly `sdlc`. */
const SDLC_SPELLINGS = ['sdlc', 'scdl', 'sdlc.cmd', 'scdl.cmd'];

/** Every spelling of the configured cli the second layer covers. */
export function cliSpellings(cli: string): string[] {
  const trimmed = cli.trim();
  return trimmed === 'sdlc' ? [...SDLC_SPELLINGS] : [trimmed];
}
