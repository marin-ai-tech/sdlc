import { HUMAN_COMMANDS } from './human-commands.js';
import type { SdlcConfig } from './config.js';
import { pluginHumanCommands } from '../plugins/catalog.js';
import { namedCliCommand, shellCliInvocations } from './shell-cli.js';

/** Retained for callers accepting the historical CLI-prefix argument. Parsing uses the shared static words. */
export const CLI_PREFIX = String.raw`\b(?:sdlc|scdl)(?:\.(?:js|cmd|ps1|exe))?`;

export function joinContinuations(command: string): string {
  return command.replace(/[\\`]\r?\n/g, '');
}

export function humanCommandMatch(text: string): string | undefined {
  const named = namedCliCommand(text, HUMAN_COMMANDS);
  if (named) return named.command.raw;
  return shellCliInvocations(text).find((call) => !call.help
    && (call.args[0] === 'adopt' && call.args.includes('--apply')
      || call.args[0] === 'init' && call.args.includes('--roles')))?.command.raw;
}

export function callsHumanCommand(text: string): boolean {
  return humanCommandMatch(text) !== undefined;
}

export function callsNamedHumanCommand(text: string, names: readonly string[]): boolean {
  return namedCliCommand(text, names) !== undefined;
}

export function callsPluginHumanCommand(text: string, root: string, config: SdlcConfig): boolean {
  return pluginHumanCommandMatch(text, root, config) !== undefined;
}

export function pluginHumanCommandMatch(text: string, root: string, config: SdlcConfig): string | undefined {
  const intrinsic = namedCliCommand(text, ['plugins accept', 'plugins revoke', 'plugins recover']);
  if (intrinsic) return intrinsic.command.raw;
  if (!shellCliInvocations(text).some((call) => !call.help)) return undefined;
  return namedCliCommand(text, pluginHumanCommands(root, config))?.command.raw;
}
