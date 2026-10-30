import type { SdlcConfig } from './config.js';
import type { Decision } from './policy.js';
import { callsPluginHumanCommand } from './human-command-match.js';
import { quotedCommand } from './human-command.js';
import { t } from './i18n.js';
import { pluginDiagnostic } from '../plugins/api.js';

/**
 * The sdlc CLI is the only writer of the state files and the agent's check for human decisions; an agent that
 * uninstalls it leaves the project without both. The hook refuses `npm uninstall` of the sdlc package (rule
 * `cli-removal`), under any of npm's names for it (`un`, `unlink`, `remove`, `rm`, `r`) and with any flags. Other
 * packages may be removed as usual.
 *
 * Heuristic on the command text, like the other shell rules: a package manager other than npm and a removal of
 * the install folder are not followed.
 */
const NPM_OPTIONS = String.raw`(?:\s+-{1,2}[\w-]+(?:=\S+)?)*`;
const REMOVE = String.raw`(?:uninstall|unlink|un|remove|rm|r)`;
const PACKAGE = String.raw`sdlc(?:@[^\s;&|]*)?`;
const NPM_REMOVE = new RegExp(String.raw`\bnpm${NPM_OPTIONS}\s+${REMOVE}\b[^;&|\n]*?\s${PACKAGE}(?=$|[\s;&|])`, 'i');

/** True when a shell command uninstalls the sdlc CLI with npm. */
export function removesSdlcCli(command: string): boolean {
  return NPM_REMOVE.test(command);
}

/** Check dynamic person-only commands after static core decisions; catalog faults must deny the call. */
export function pluginHumanDecision(command: string, root: string, config: SdlcConfig): Decision | undefined {
  try {
    if (callsPluginHumanCommand(command, root, config)) {
      return { decision: 'deny', rule: 'separation-of-duties',
        reason: t('hook.separationOfDuties', { command: quotedCommand(command) }) };
    }
  } catch (error) {
    const problem = pluginDiagnostic(error);
    return { decision: 'deny', rule: 'plugin', reason: `${problem.code}: ${problem.message}` };
  }
  return undefined;
}
