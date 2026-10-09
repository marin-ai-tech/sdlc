import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJson, writeJson } from './mcp-config.js';
import { cliSpellings, SECOND_LAYER_COMMANDS } from './second-layer.js';
import type { SettingsChange } from './settings.js';
import type { ToolId } from './types.js';

/**
 * Merges sdlc's hooks and human-command deny rules into `.qwen/settings.json` or `.gigacode/settings.json`
 * (B83, 0.14.1). These settings files are shared with the person and are not generated files in the manifest.
 * The person's other settings, hook entries and deny rules stay; uninstall removes only sdlc's entries.
 * MCP servers in the same settings file are merged separately by the MCP installer.
 */
type FamilyId = Extract<ToolId, 'qwen' | 'gigacode'>;
type Json = Record<string, unknown>;

export function qwenSettingsPath(id: FamilyId): string {
  return `.${id}/settings.json`;
}

function object(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {};
}

function isOurHook(value: unknown): boolean {
  const command = object(value).command;
  return typeof command === 'string' && /\bsdlc\b/.test(command)
    && /\bhook\s+(?:session-start|pre-tool|stop)\b/.test(command);
}

function groupWithoutOurHooks(group: unknown): Json {
  const item = object(group);
  const hooks = Array.isArray(item.hooks) ? item.hooks.filter((entry: unknown) => !isOurHook(entry)) : [];
  return { ...item, hooks };
}

function hooksWithoutOurs(hooks: Json): Json {
  const result: Json = {};
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) {
      result[event] = groups;
      continue;
    }
    const kept = groups.map(groupWithoutOurHooks).filter((group) => (group.hooks as unknown[]).length > 0);
    if (kept.length > 0) result[event] = kept;
  }
  return result;
}

function hookGroup(cli: string, id: FamilyId, event: string, timeout: number): Json[] {
  return [{
    hooks: [{
      type: 'command',
      command: `${cli} hook ${event} --agent ${id}`,
      timeout,
    }],
  }];
}

function ourGroups(cli: string, id: FamilyId): Json {
  return {
    SessionStart: hookGroup(cli, id, 'session-start', 30),
    PreToolUse: hookGroup(cli, id, 'pre-tool', 30),
    Stop: hookGroup(cli, id, 'stop', 120),
  };
}

const HUMAN = SECOND_LAYER_COMMANDS.map((command) =>
  command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
const SDLC_CLI = String.raw`(?:[^)]*\s)?(?:[^\s()]*[/\\])?(?:sdlc|scdl)(?:\.js|\.cmd|\.ps1|\.exe)?`;
const OUR_DENY = new RegExp(`^Bash\\(${SDLC_CLI}\\s+(?:${HUMAN.join('|')})(?:\\s+\\*)?\\)$`);

export function qwenDeny(cli: string): string[] {
  return cliSpellings(cli).flatMap((spelling) => SECOND_LAYER_COMMANDS.flatMap((command) => [
    `Bash(${spelling} ${command})`,
    `Bash(${spelling} ${command} *)`,
  ]));
}

function merged(file: Json, cli: string, id: FamilyId, install: boolean): Json {
  const out = { ...file };
  const hooks = hooksWithoutOurs(object(file.hooks));
  if (install) {
    for (const [event, groups] of Object.entries(ourGroups(cli, id))) {
      hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] as unknown[] : []), ...groups as unknown[]];
    }
  }
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  else delete out.hooks;
  mergePermissions(out, file, cli, install);
  return out;
}

function mergePermissions(out: Json, file: Json, cli: string, install: boolean): void {
  const permissions = { ...object(file.permissions) };
  const deny = Array.isArray(permissions.deny)
    ? permissions.deny.filter((rule: unknown) => typeof rule !== 'string' || !OUR_DENY.test(rule))
    : [];
  if (install) deny.push(...qwenDeny(cli));
  if (deny.length > 0) permissions.deny = deny;
  else delete permissions.deny;
  if (Object.keys(permissions).length > 0) out.permissions = permissions;
  else delete out.permissions;
}

export function mergeQwenSettings(root: string, cli: string, id: FamilyId,
  install: boolean, dryRun = false): SettingsChange {
  const rel = qwenSettingsPath(id);
  const file = readJson(root, rel) ?? {};
  const next = merged(file, cli, id, install);
  if (JSON.stringify(file) === JSON.stringify(next)) return install ? 'unchanged' : 'absent';
  if (!dryRun) {
    if (Object.keys(next).length > 0) writeJson(root, rel, next);
    else fs.rmSync(path.join(root, rel), { force: true });
  }
  return install ? 'installed' : 'removed';
}

function commandsOfEvent(hooks: Json, event: string): string[] {
  const groups = hooks[event];
  if (!Array.isArray(groups)) return [];
  const commands: string[] = [];
  for (const group of groups) {
    const entries = object(group).hooks;
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const command = object(entry).command;
      if (typeof command === 'string') commands.push(command);
    }
  }
  return commands;
}

function installedCli(hooks: Json, id: FamilyId): string {
  const suffix = ` hook pre-tool --agent ${id}`;
  const command = commandsOfEvent(hooks, 'PreToolUse').find((value) => value.endsWith(suffix));
  return command ? command.slice(0, -suffix.length) : '';
}

export function qwenSettingsInstalled(root: string, id: FamilyId): boolean {
  try {
    const file = readJson(root, qwenSettingsPath(id)) ?? {};
    const hooks = object(file.hooks);
    const cli = installedCli(hooks, id);
    const deny = object(file.permissions).deny;
    return cli !== '' && commandsOfEvent(hooks, 'SessionStart').includes(`${cli} hook session-start --agent ${id}`)
      && commandsOfEvent(hooks, 'Stop').includes(`${cli} hook stop --agent ${id}`)
      && Array.isArray(deny) && qwenDeny(cli).every((rule) => deny.includes(rule));
  } catch {
    return false;
  }
}
