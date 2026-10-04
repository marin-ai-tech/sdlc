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

export function hookCommand(cli: string, event: 'session-start' | 'pre-tool' | 'stop'): string {
  const invocation = `${cli} hook ${event}`;
  // Fail open (and quietly) on tool calls when the CLI is not installed on this
  // machine; the SessionStart hook stays unguarded so a missing CLI is visible once.
  if (event === 'session-start') return invocation;
  const bin = cli.split(/\s+/)[0];
  return `command -v ${bin} >/dev/null 2>&1 && ${invocation} || true`;
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
        matcher: 'Edit|Write|MultiEdit|NotebookEdit|Bash',
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
      `${SETTINGS_PATH} is not valid JSON (${error instanceof Error ? error.message : String(error)}); hooks were not installed.`,
      `Fix ${SETTINGS_PATH}, then run \`sdlc update\`.`
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
