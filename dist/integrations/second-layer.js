import { HUMAN_COMMANDS } from '../core/human-commands.js';
import { loadConfig } from '../core/config.js';
import { pluginHumanCommands } from '../plugins/catalog.js';
/**
 * What the second layer refuses (B84, 0.14.2): Codex's command rules and Qwen's `permissions.deny`.
 * A person's commands (HUMAN_COMMANDS) plus option variants that are human only in policy.ts.
 */
export const SECOND_LAYER_COMMANDS = [...HUMAN_COMMANDS, 'adopt --apply', 'init --roles'];
export function secondLayerCommands(root, config) {
    const dynamic = root ? pluginHumanCommands(root, config ?? loadConfig(`${root}/openspec/sdlc.yaml`)) : [];
    return [...SECOND_LAYER_COMMANDS, ...dynamic];
}
/** The package's alias bin and npm's Windows shims, spelled only when the configured cli is exactly `sdlc`. */
const SDLC_SPELLINGS = ['sdlc', 'scdl', 'sdlc.cmd', 'scdl.cmd'];
/** Every spelling of the configured cli the second layer covers. */
export function cliSpellings(cli) {
    const trimmed = cli.trim();
    return trimmed === 'sdlc' ? [...SDLC_SPELLINGS] : [trimmed];
}
