import * as os from 'node:os';
import * as path from 'node:path';
import { readText, toPosix } from './fs-utils.js';
import { absolute, realTarget, writeSegments, type WriteSegment } from './policy-shell.js';

/**
 * User-level agent settings (B42). Outside the project, two files switch the hooks off for every project: the
 * user's Claude Code settings (`disableAllHooks: true`) and the global OpenCode config. They are the guard's
 * configuration too (rule `guard-config`, `policy-guard.ts`): an agent's edits and shell writes of them are denied,
 * also when the file does not exist yet or is reached through a symbolic link. Reads stay allowed, and so do the
 * other files in the user folders (`~/.claude/CLAUDE.md`, `~/.claude/projects/**`, agents, skills).
 *
 * The paths come from the policy context's environment: `$CLAUDE_CONFIG_DIR/settings.json`, else
 * `<home>/.claude/settings.json`; `$OPENCODE_CONFIG` and `<config>/opencode/opencode.json(c)`, where `<config>` is
 * `XDG_CONFIG_HOME`, else `<home>/.config`; `<home>` is `HOME`, else `USERPROFILE`, else `os.homedir()`. An empty
 * variable counts as unset; paths compare case-insensitively on Windows and macOS.
 *
 * A disabled hook cannot report itself, so `sdlc doctor` names every settings file that sets `disableAllHooks`.
 */
type Env = NodeJS.ProcessEnv;

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';
/** The end of a path spelled in a command: the end, a space, a quote or a shell operator. */
const PATH_END = /^(?:$|[\s'";&|),<>])/;
/** `~` as the start of a word: the home directory. */
const TILDE = /(^|[\s'"=(,>])~(?=$|\/|[\s'";&|),<>])/g;
/** `${NAME}`, `$env:NAME` (PowerShell), `$NAME`, `%NAME%` (cmd.exe). */
const VARIABLE = /\$\{(\w+)\}|\$env:(\w+)|\$(\w+)|%(\w+)%/gi;
/** Stands for a space inside an expanded value, so `C:/Users/Pat Lee` stays one word; restored before matching. */
const SPACE = '\u0001';
const SPACES = /\u0001/g;

/** A variable's value; an empty variable counts as unset. Windows ignores the case of variable names. */
function envValue(env: Env, name: string): string | undefined {
  const exact = env[name];
  if (exact) return exact;
  if (process.platform !== 'win32') return undefined;
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key === undefined ? undefined : env[key] || undefined;
}

/** The user's home directory: `HOME`, else `USERPROFILE`, else the operating system's. */
function userHome(env: Env): string {
  return envValue(env, 'HOME') ?? envValue(env, 'USERPROFILE') ?? os.homedir();
}

/** The user's Claude Code settings file. */
export function userClaudeSettings(env: Env): string {
  const dir = envValue(env, 'CLAUDE_CONFIG_DIR') ?? path.join(userHome(env), '.claude');
  return path.resolve(dir, 'settings.json');
}

/** The user-level files that switch the hooks off for every project, absolute. */
export function userGuardFiles(env: Env): string[] {
  const config = envValue(env, 'XDG_CONFIG_HOME') ?? path.join(userHome(env), '.config');
  const opencode = envValue(env, 'OPENCODE_CONFIG');
  const files = [
    userClaudeSettings(env),
    path.resolve(config, 'opencode', 'opencode.json'),
    path.resolve(config, 'opencode', 'opencode.jsonc'),
  ];
  if (opencode !== undefined) files.push(path.resolve(opencode));
  return files;
}

/** One spelling per path for comparison: absolute, forward slashes, lower case where the file system ignores case. */
function pathKey(file: string): string {
  const posix = toPosix(path.resolve(file));
  return CASE_INSENSITIVE ? posix.toLowerCase() : posix;
}

/** The user guard files by their spelled and their real path. */
function guardKeys(env: Env): Map<string, string> {
  const keys = new Map<string, string>();
  for (const file of userGuardFiles(env)) {
    keys.set(pathKey(file), file);
    const real = realTarget(file);
    if (real !== undefined) keys.set(pathKey(real), file);
  }
  return keys;
}

/** The user guard file an absolute path names, directly or through a symbolic link. */
function pathHit(guard: Map<string, string>, abs: string): string | undefined {
  const direct = guard.get(pathKey(abs));
  if (direct !== undefined) return direct;
  const real = realTarget(abs);
  return real === undefined ? undefined : guard.get(pathKey(real));
}

/** User guard files an edit writes, by path or through a symbolic link; absolute. */
export function userGuardEditHits(files: string[], cwd: string, env: Env): string[] {
  const guard = guardKeys(env);
  const hits: string[] = [];
  for (const file of files) {
    const hit = pathHit(guard, path.resolve(cwd, file));
    if (hit !== undefined) hits.push(hit);
  }
  return hits;
}

/** A value spelled into a command: forward slashes, its spaces kept inside the word. */
function spelledValue(value: string): string {
  return toPosix(value).replace(/\\/g, '/').replace(/ /g, SPACE);
}

/**
 * The command with `~` and the variables the environment sets replaced by their values (forward slashes); a space
 * in a value stands as `SPACE` until the words are matched.
 */
export function expandUserPaths(command: string, env: Env): string {
  const home = spelledValue(userHome(env));
  const value = (spelled: string, name: string) => {
    const found = envValue(env, name);
    return found === undefined ? spelled : spelledValue(found);
  };
  return command
    .replace(TILDE, (_match: string, lead: string) => `${lead}${home}`)
    .replace(VARIABLE, (spelled: string, ...names: Array<string | undefined>) =>
      value(spelled, names.slice(0, 4).find((name) => name !== undefined) ?? ''))
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/');
}

/** User guard files whose absolute path a segment spells (also with spaces in it). */
function textHits(guard: Map<string, string>, text: string): string[] {
  const plain = text.replace(SPACES, ' ');
  const spelled = CASE_INSENSITIVE ? plain.toLowerCase() : plain;
  const hits: string[] = [];
  for (const [key, file] of guard) {
    for (let at = spelled.indexOf(key); at >= 0; at = spelled.indexOf(key, at + 1)) {
      if (PATH_END.test(spelled.slice(at + key.length))) hits.push(file);
    }
  }
  return hits;
}

/** User guard files a segment's words name, relative to its directory or through a symbolic link. */
function wordHits(guard: Map<string, string>, segment: WriteSegment): string[] {
  const hits: string[] = [];
  for (const word of segment.words) {
    const abs = absolute(segment.dir, word)?.replace(SPACES, ' ');
    const hit = abs === undefined ? undefined : pathHit(guard, abs);
    if (hit !== undefined) hits.push(hit);
  }
  return hits;
}

/** User guard files a shell command writes, deletes, moves or replaces; absolute. */
export function userShellGuardWrites(command: string, cwd: string, env: Env): string[] {
  const guard = guardKeys(env);
  const hits: string[] = [];
  for (const segment of writeSegments(expandUserPaths(command, env), cwd)) {
    hits.push(...textHits(guard, segment.text), ...wordHits(guard, segment));
  }
  return hits;
}

/** True when a settings file's JSON sets `disableAllHooks: true`; an unreadable or invalid file does not. */
function disablesHooks(file: string): boolean {
  const text = readText(file);
  if (text === undefined) return false;
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''));
    if (typeof parsed !== 'object' || parsed === null) return false;
    return (parsed as Record<string, unknown>).disableAllHooks === true;
  } catch {
    return false;
  }
}

/** Settings files that switch every Claude Code hook off: the user's, the project's shared and local ones. */
export function hooksDisabledFiles(root: string | undefined, env: Env): string[] {
  const files = [userClaudeSettings(env)];
  if (root !== undefined) {
    files.push(path.join(root, '.claude', 'settings.json'), path.join(root, '.claude', 'settings.local.json'));
  }
  const unique = new Map(files.map((file) => [pathKey(file), file]));
  return [...unique.values()].filter(disablesHooks);
}
