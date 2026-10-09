/**
 * The agent markers (see `agent-env.ts`) tell the sdlc CLI that an agent runs it, so human decisions are refused.
 * A command that unsets or blanks one of them would let an agent pass for a person, so the hook refuses any such
 * command, whatever else it does (rule `agent-marker`). Reading the markers and setting other variables is fine.
 *
 * Heuristics on the command text, like the other shell rules: indirection (`unset "$NAME"`, `eval`, a script written
 * to disk and run later) is not followed. A marker set to anything but `1` counts as cleared, because the CLI then
 * no longer sees an agent; `SDLC_AGENT` counts only when it becomes empty.
 */
const NAME = String.raw`(?:CLAUDECODE|OPENCODE|SDLC_AGENT|CURSOR_AGENT|CODEX_CI|CODEX_SESSION_ID|`
  + String.raw`QWEN_CODE|QWEN_CODE_SESSION_ID|AGENT)`;
/** The markers agent-env.ts reads; test/git-hook-sync.test.ts keeps the three lists (here, agent-env, git hook) equal. */
export const AGENT_MARKERS = [
  'CLAUDECODE', 'OPENCODE', 'SDLC_AGENT', 'CURSOR_AGENT', 'CODEX_CI', 'CODEX_SESSION_ID',
  'QWEN_CODE', 'QWEN_CODE_SESSION_ID', 'AGENT',
];
/** Markers whose value is a name or an id: any non-empty value keeps the agent visible. */
const NAMED_MARKERS = ['SDLC_AGENT', 'CODEX_SESSION_ID', 'QWEN_CODE_SESSION_ID'];
const END = String.raw`(?!\w)`;
const VALUE = String.raw`(?<value>"[^"]*"|'[^']*'|[^\s;&|)]*)`;
/** Options of `env` before the one that drops the whole environment (`env -i`, `env -`). */
const ENV_OPTION = [
  String.raw`-[uCS]\s*[^\s-]\S*`,
  String.raw`--(?:unset|chdir|split-string)[=\s]\S+`,
  String.raw`--[\w-]+`,
  String.raw`-[A-Za-z0-9]+`,
].join('|');
const ENV_OPTIONS = String.raw`(?:\s+(?:${ENV_OPTION}))*`;
/** PowerShell cmdlets and aliases that remove or replace an item of the `Env:` drive. */
const PS_ITEM = [
  'Remove-Item', 'Clear-Item', 'Set-Item', 'New-Item', 'Rename-Item', 'Move-Item',
  'ri', 'rm', 'del', 'erase', 'cli', 'si', 'ni', 'rni', 'mi', 'mv',
].join('|');

/** Node and Python spellings: `delete process.env.X`, `os.environ.pop("X")`, `del os.environ["X"]`. */
const SCRIPT_UNSET = String.raw`(?:delete\s+process\.env|\bdel\s+os\.environ|\bos\.environ\.pop|\bos\.unsetenv)`;

/** Commands that clear a marker whatever value follows; sh names are case-sensitive, Windows names are not. */
const CLEARS: RegExp[] = [
  new RegExp(String.raw`\benv\b[^;&|\n]*\s(?:-u\s*|--unset[=\s]\s*)${NAME}${END}`),
  new RegExp(String.raw`\benv${ENV_OPTIONS}\s+(?:-[A-Za-z]*i[A-Za-z]*|--ignore-environment|-)(?=\s|$)`),
  new RegExp(String.raw`\bunset\b[^;&|\n]*\s${NAME}${END}`),
  new RegExp(String.raw`\bexport\s+-n\b[^;&|\n]*\s${NAME}${END}`),
  // `declare +x` / `typeset +x` stop exporting the variable, so a child process no longer sees it.
  new RegExp(String.raw`\b(?:declare|typeset|local)\s+[^;&|\n]*\+x\b[^;&|\n]*\s${NAME}${END}`),
  new RegExp(String.raw`\b(?:${PS_ITEM})\b[^;&|\n]*(?<![$\w])env:[\\/]?${NAME}${END}`, 'i'),
  new RegExp(String.raw`${SCRIPT_UNSET}\W+${NAME}${END}`, 'i'),
  // `exec -c` runs the command with an empty environment; `Start-Process -UseNewEnvironment` drops the session's.
  /\bexec(?:\s+-a\s*\S+|\s+-[A-Za-z]+)*?\s+-[A-Za-z]*c[A-Za-z]*(?=\s|$)/,
  /-UseNewEnvironment\b/i,
];

/** `NAME=value` or `NAME+=value` as a command prefix or after `export`/`env`; not `$NAME=` (a comparison). */
const SH_ASSIGN = new RegExp(String.raw`(?:^|[\s;&|(){}'"\x60])(?<name>${NAME})(?<plus>\+)?=${VALUE}`, 'g');
/** `$env:NAME = value`, `$env:NAME += value` and `${env:NAME} = value` in PowerShell. */
const PS_ASSIGN = new RegExp(String.raw`\$\{?env:(?<name>${NAME})\}?\s*(?<plus>\+)?=(?!=)\s*${VALUE}`, 'gi');
/** `[Environment]::SetEnvironmentVariable("NAME", value)`. */
const DOTNET_SET = new RegExp(
  String.raw`SetEnvironmentVariable\(\s*["'](?<name>${NAME})["']\s*(?:,\s*(?<value>[^,)]*))?`,
  'gi',
);
const CMD_SET = new RegExp(
  String.raw`\bset\s+(?:"(?<name>${NAME})=(?<value>[^"]*)"|(?<plain>${NAME})=(?<plainValue>[^\s&|]*))`,
  'gi',
);

/** True when the value assigned to a marker (appended to its `1` with `+=`) makes the CLI stop seeing an agent. */
function clears(name: string, raw: string | undefined, append: boolean): boolean {
  const unquoted = (raw ?? '').trim().replace(/^(["'])(.*)\1$/, '$2');
  const value = append ? `1${unquoted}` : unquoted;
  if (value === '' || /^\$null$/i.test(value)) {
    return true;
  }
  // SDLC_AGENT and CODEX_SESSION_ID (B82) are names, not flags: they count only when they become empty.
  return !NAMED_MARKERS.includes(name.toUpperCase()) && value !== '1';
}

function assignsCleared(command: string): boolean {
  for (const match of command.matchAll(CMD_SET)) {
    const groups = match.groups ?? {};
    if (clears(groups.name ?? groups.plain, groups.value ?? groups.plainValue, false)) return true;
  }
  for (const pattern of [SH_ASSIGN, PS_ASSIGN, DOTNET_SET]) {
    for (const match of command.matchAll(pattern)) {
      const groups = match.groups ?? {};
      if (clears(groups.name, groups.value, groups.plus !== undefined)) {
        return true;
      }
    }
  }
  return false;
}

/** A word of the `Env:` drive (`Env:CLAUDECODE`, `Env:\CLAUDE*`, `Env:`), not the `$env:` variable syntax. */
const ENV_PATH = /(?<![${\w])env:[\\/]?([\w*?[\]]*)/gi;
const PS_ITEM_WORD = new RegExp(String.raw`(?:^|[\s|;(])(?:${PS_ITEM})(?=\s|$)`, 'i');

/** True when an `Env:` name, a wildcard pattern or the whole drive (empty) covers an agent marker. */
function coversMarker(name: string): boolean {
  if (name === '') return true;
  const source = name.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  try {
    const pattern = new RegExp(`^${source}$`, 'i');
    return AGENT_MARKERS.some((marker) => pattern.test(marker));
  } catch {
    return true;
  }
}

/** A pipeline (`|` kept) that names a marker on the `Env:` drive and removes, clears or sets items. */
function removesEnvItems(command: string): boolean {
  for (const pipeline of command.split(/&&|\|\||[;&\r\n]/)) {
    if (!PS_ITEM_WORD.test(pipeline)) continue;
    if ([...pipeline.matchAll(ENV_PATH)].some((match) => coversMarker(match[1]))) return true;
  }
  return false;
}

/** True when a shell command (sh or PowerShell) unsets or blanks an agent marker (see AGENT_MARKERS). */
export function clearsAgentMarker(command: string): boolean {
  if (CLEARS.some((pattern) => pattern.test(command)) || removesEnvItems(command)) {
    return true;
  }
  return assignsCleared(command);
}
