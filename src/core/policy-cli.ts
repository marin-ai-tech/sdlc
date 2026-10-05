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
