import * as path from 'node:path';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';

/**
 * Merges the harness hooks into `.claude/settings.json` without touching any
 * other setting or hook. Our handlers are recognized by their `sdlc hook`
 * command, so re-running `sdlc update` replaces them in place and
 * `sdlc uninstall` removes exactly them.
 */
interface HookHandler {
  type: string;
  command?: string;
  timeout?: number;
  statusMessage?: string;
  [key: string]: unknown;
}

interface MatcherGroup {
  matcher?: string;
  hooks: HookHandler[];
  [key: string]: unknown;
}

type HooksConfig = Record<string, MatcherGroup[]>;

export const SETTINGS_PATH = '.claude/settings.json';
const OURS = /\bhook\s+(session-start|pre-tool|stop)\b/;

function isOurs(handler: HookHandler): boolean {
  return typeof handler.command === 'string' && OURS.test(handler.command) && /\b(sdlc|scdl)\b/.test(handler.command);
}

/** Single-quotes a word for sh. */
function shQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The reason Claude Code shows (stderr of exit 2) when the PreToolUse check could not run twice in a row. */
function blockedNotice(cli: string): string {
  return [
    `[sdlc] The SDLC harness check could not run (${cli} hook pre-tool failed twice), so this call is blocked.`,
    `Retry the call; if it keeps failing, run \`${cli} doctor\`.`,
  ].join(' ');
}

/**
 * PreToolUse fails closed, like the OpenCode plugin since 0.7.1: the input is read once and given to both
 * attempts; a second failure blocks the call (exit 2, the reason on stderr). Only the answer of the attempt that
 * succeeded reaches stdout. A machine without the CLI keeps working: exit 0, no output.
 */
function guardedPreTool(cli: string, guard: string): string {
  const attempt = `out=$(printf '%s' "$in" | ${cli} hook pre-tool)`;
  const block = `{ printf '%s\\n' ${shQuote(blockedNotice(cli))} >&2; exit 2; }`;
  return [`${guard} || exit 0`, 'in=$(cat)', `${attempt} || ${attempt} || ${block}`, `printf '%s' "$out"`].join('; ');
}

/** The command of a hook handler; it runs in bash (Git Bash on Windows). */
export function hookCommand(cli: string, event: 'session-start' | 'pre-tool' | 'stop'): string {
  const invocation = `${cli} hook ${event}`;
  // The SessionStart hook stays unguarded so a missing CLI is visible once.
  if (event === 'session-start') return invocation;
  const bin = cli.split(/\s+/)[0];
  const guard = `command -v ${bin} >/dev/null 2>&1`;
  if (event === 'pre-tool') return guardedPreTool(cli, guard);
  // Stop only reminds; it stays fail-open (and quiet) when the CLI is missing or fails.
  return `${guard} && ${invocation} || true`;
}

export function harnessHooks(cli: string): HooksConfig {
  return {
    SessionStart: [
      {
        matcher: 'startup|resume|clear|compact',
        hooks: [{ type: 'command', command: hookCommand(cli, 'session-start'), timeout: 30 }],
      },
    ],
    PreToolUse: [
      {
        // PowerShell: Claude Code's Windows shell tool writes files too, so its calls reach the same rules (B41).
        matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell',
        hooks: [
          { type: 'command', command: hookCommand(cli, 'pre-tool'), timeout: 30, statusMessage: 'SDLC gate check' },
        ],
      },
    ],
    Stop: [
      {
        hooks: [{ type: 'command', command: hookCommand(cli, 'stop'), timeout: 120 }],
      },
    ],
  };
}

function readSettings(root: string): Record<string, unknown> {
  const file = path.join(root, SETTINGS_PATH);
  const text = readText(file);
  if (text === undefined || text.trim() === '') return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new SdlcError(
      'invalid_claude_settings',
      { key: 'error.x_is_not_valid_json_x_hooks_were_not_installed', params: { SETTINGS_PATH: SETTINGS_PATH, p2: error instanceof Error ? error.message : String(error) } },
      { key: 'fix.fix_x_then_run_sdlc_update', params: { SETTINGS_PATH: SETTINGS_PATH } }
    );
  }
}

function stripOurs(hooks: HooksConfig): HooksConfig {
  const out: HooksConfig = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = groups
      .map((g) => ({ ...g, hooks: Array.isArray(g.hooks) ? g.hooks.filter((h) => !isOurs(h)) : [] }))
      .filter((g) => g.hooks.length > 0);
    if (kept.length > 0) out[event] = kept;
  }
  return out;
}

export type SettingsChange = 'installed' | 'updated' | 'unchanged' | 'removed' | 'absent';

function oursStatusLine(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const line = value as Record<string, unknown>;
  return line.type === 'command' && typeof line.command === 'string'
    && /^(?:npx (?:--no-install )?)?(?:sdlc|scdl) statusline$/.test(line.command);
}

export function mergeClaudeStatusLine(root: string, cli: string, install: boolean, dryRun = false): string {
  const settings = readSettings(root);
  const existing = settings.statusLine;
  if (existing !== undefined && !oursStatusLine(existing)) return 'kept (user-defined)';
  if (install && existing && (existing as Record<string, unknown>).command === `${cli} statusline`) return 'unchanged';
  if (!install && existing === undefined) return 'absent';
  if (install) settings.statusLine = { type: 'command', command: `${cli} statusline` };
  else delete settings.statusLine;
  if (!dryRun) writeTextAtomic(path.join(root, SETTINGS_PATH), `${JSON.stringify(settings, null, 2)}\n`);
  return install ? 'installed' : 'removed';
}

export function mergeClaudeHooks(root: string, cli: string, install: boolean, dryRun = false): SettingsChange {
  const settings = readSettings(root);
  const before = JSON.stringify(settings);
  const existing = (settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {}) as HooksConfig;
  const hadOurs = Object.values(existing).some((groups) =>
    Array.isArray(groups) && groups.some((g) => Array.isArray(g.hooks) && g.hooks.some(isOurs)));
  const merged = stripOurs(existing);
  if (install) {
    for (const [event, groups] of Object.entries(harnessHooks(cli))) {
      merged[event] = [...(merged[event] ?? []), ...groups];
    }
  }
  if (Object.keys(merged).length > 0) settings.hooks = merged;
  else delete settings.hooks;
  const after = JSON.stringify(settings);
  if (before === after) return install ? 'unchanged' : 'absent';
  if (!dryRun) {
    writeTextAtomic(path.join(root, SETTINGS_PATH), `${JSON.stringify(settings, null, 2)}\n`);
  }
  if (!install) return hadOurs ? 'removed' : 'absent';
  return hadOurs ? 'updated' : 'installed';
}
