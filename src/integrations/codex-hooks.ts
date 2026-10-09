import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import type { SettingsChange } from './settings.js';

/**
 * Merges sdlc's hooks into Codex's `.codex/hooks.json` (B82, 0.14.0) the way cursor-hooks.ts merges Cursor's: every
 * other key, group and hook of the person's own stays; sdlc's hooks are recognized by their `sdlc hook` command.
 * File shape (Claude Code's): `{"hooks": {"<Event>": [{"matcher"?, "hooks": [{"type": "command", "command",
 * "timeout"}]}]}}`. Codex runs them only in a trusted project, after the user trusts them in `/hooks`.
 */
export const CODEX_HOOKS_PATH = '.codex/hooks.json';

type Entry = Record<string, unknown>;
type Group = { hooks?: unknown; [key: string]: unknown };
type CodexHooks = Record<string, unknown>;

const OURS = /\bhook\s+(session-start|pre-tool|stop)\b/;

/** A hook sdlc wrote: its command runs `sdlc hook <event>`. */
export function isOurCodexHook(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const command = (entry as Entry).command;
  return typeof command === 'string' && OURS.test(command) && /\bsdlc\b/.test(command);
}

export function codexHookCommand(cli: string, event: 'session-start' | 'pre-tool' | 'stop'): string {
  return `${cli} hook ${event} --agent codex`;
}

function group(command: string, timeout: number): Group {
  return { hooks: [{ type: 'command', command, timeout }] };
}

/** sdlc's groups. PreToolUse has no matcher: every tool (shell, apply_patch, MCP) is checked. */
export function codexHarnessHooks(cli: string): Record<string, Group[]> {
  return {
    SessionStart: [group(codexHookCommand(cli, 'session-start'), 30)],
    PreToolUse: [group(codexHookCommand(cli, 'pre-tool'), 30)],
    Stop: [group(codexHookCommand(cli, 'stop'), 120)],
  };
}

function invalid(error: unknown): SdlcError {
  const reason = error instanceof Error ? error.message : String(error);
  return new SdlcError(
    'invalid_codex_hooks',
    {
      key: 'error.x_is_not_valid_json_x_hooks_were_not_installed',
      params: { SETTINGS_PATH: CODEX_HOOKS_PATH, p2: reason },
    },
    { key: 'fix.fix_x_then_run_sdlc_update', params: { SETTINGS_PATH: CODEX_HOOKS_PATH } },
  );
}

function readHooksFile(root: string): Record<string, unknown> {
  const text = readText(path.join(root, CODEX_HOOKS_PATH));
  if (text === undefined || text.trim() === '') return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw invalid(error);
  }
}

function hooksOf(file: Record<string, unknown>): CodexHooks {
  const hooks = file.hooks;
  return hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? hooks as CodexHooks : {};
}

/** A group without sdlc's hooks; undefined when nothing is left of it. */
function stripGroup(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || !Array.isArray((entry as Group).hooks)) return entry;
  const own = ((entry as Group).hooks as unknown[]).filter((hook) => !isOurCodexHook(hook));
  return own.length > 0 ? { ...(entry as Group), hooks: own } : undefined;
}

/** The person's groups only; an event left without groups is dropped. */
function stripOurs(hooks: CodexHooks): CodexHooks {
  const kept: CodexHooks = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      kept[event] = groups;
      continue;
    }
    const own = groups.map(stripGroup).filter((entry) => entry !== undefined);
    if (own.length > 0) kept[event] = own;
  }
  return kept;
}

function hookList(entry: unknown): unknown[] {
  const hooks = entry && typeof entry === 'object' ? (entry as Group).hooks : undefined;
  return Array.isArray(hooks) ? hooks : [];
}

function hasOurs(hooks: CodexHooks): boolean {
  return Object.values(hooks).some((groups) => Array.isArray(groups)
    && groups.some((entry) => hookList(entry).some(isOurCodexHook)));
}

function merged(file: Record<string, unknown>, cli: string, install: boolean): Record<string, unknown> {
  const hooks = stripOurs(hooksOf(file));
  if (install) {
    for (const [event, groups] of Object.entries(codexHarnessHooks(cli))) {
      const current = Array.isArray(hooks[event]) ? hooks[event] as unknown[] : [];
      hooks[event] = [...current, ...groups];
    }
  }
  const out: Record<string, unknown> = { ...file };
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  else delete out.hooks;
  return out;
}

function save(root: string, file: Record<string, unknown>): void {
  const abs = path.join(root, CODEX_HOOKS_PATH);
  if (Object.keys(file).length === 0) {
    fs.rmSync(abs, { force: true });
    return;
  }
  writeTextAtomic(abs, `${JSON.stringify(file, null, 2)}\n`);
}

/** Installs (`install`) or removes sdlc's Codex hooks; a file left empty after removal is deleted. */
export function mergeCodexHooks(root: string, cli: string, install: boolean, dryRun = false): SettingsChange {
  const exists = fs.existsSync(path.join(root, CODEX_HOOKS_PATH));
  const file = readHooksFile(root);
  const hadOurs = hasOurs(hooksOf(file));
  if (!install && !hadOurs) return 'absent';
  const next = merged(file, cli, install);
  if (exists && JSON.stringify(next) === JSON.stringify(file)) return 'unchanged';
  if (!dryRun) save(root, next);
  if (!install) return 'removed';
  return hadOurs ? 'updated' : 'installed';
}

/** Whether the file has sdlc's PreToolUse hook for Codex (doctor). */
export function codexHooksInstalled(root: string): boolean {
  try {
    const groups = hooksOf(readHooksFile(root)).PreToolUse;
    if (!Array.isArray(groups)) return false;
    return groups.some((entry) => hookList(entry).some((hook) => isOurCodexHook(hook)
      && /--agent\s+codex\b/.test(String((hook as Entry).command))));
  } catch {
    return false;
  }
}