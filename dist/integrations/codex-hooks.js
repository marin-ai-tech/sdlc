import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
/**
 * Merges sdlc's hooks into Codex's `.codex/hooks.json` (B82, 0.14.0) the way cursor-hooks.ts merges Cursor's: every
 * other key, group and hook of the person's own stays; sdlc's hooks are recognized by their `sdlc hook` command.
 * File shape (Claude Code's): `{"hooks": {"<Event>": [{"matcher"?, "hooks": [{"type": "command", "command",
 * "timeout"}]}]}}`. Codex runs them only in a trusted project, after the user trusts them in `/hooks`.
 */
export const CODEX_HOOKS_PATH = '.codex/hooks.json';
const OURS = /\bhook\s+(session-start|pre-tool|stop)\b/;
/** A hook sdlc wrote: its command runs `sdlc hook <event>`. */
export function isOurCodexHook(entry) {
    if (!entry || typeof entry !== 'object')
        return false;
    const command = entry.command;
    return typeof command === 'string' && OURS.test(command) && /\bsdlc\b/.test(command);
}
export function codexHookCommand(cli, event) {
    return `${cli} hook ${event} --agent codex`;
}
function group(command, timeout) {
    return { hooks: [{ type: 'command', command, timeout }] };
}
/** sdlc's groups. PreToolUse has no matcher: every tool (shell, apply_patch, MCP) is checked. */
export function codexHarnessHooks(cli) {
    return {
        SessionStart: [group(codexHookCommand(cli, 'session-start'), 30)],
        PreToolUse: [group(codexHookCommand(cli, 'pre-tool'), 30)],
        Stop: [group(codexHookCommand(cli, 'stop'), 120)],
    };
}
function invalid(error) {
    const reason = error instanceof Error ? error.message : String(error);
    return new SdlcError('invalid_codex_hooks', {
        key: 'error.x_is_not_valid_json_x_hooks_were_not_installed',
        params: { SETTINGS_PATH: CODEX_HOOKS_PATH, p2: reason },
    }, { key: 'fix.fix_x_then_run_sdlc_update', params: { SETTINGS_PATH: CODEX_HOOKS_PATH } });
}
function readHooksFile(root) {
    const text = readText(path.join(root, CODEX_HOOKS_PATH));
    if (text === undefined || text.trim() === '')
        return {};
    try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('not an object');
        return parsed;
    }
    catch (error) {
        throw invalid(error);
    }
}
function hooksOf(file) {
    const hooks = file.hooks;
    return hooks && typeof hooks === 'object' && !Array.isArray(hooks) ? hooks : {};
}
/** A group without sdlc's hooks; undefined when nothing is left of it. */
function stripGroup(entry) {
    if (!entry || typeof entry !== 'object' || !Array.isArray(entry.hooks))
        return entry;
    const own = entry.hooks.filter((hook) => !isOurCodexHook(hook));
    return own.length > 0 ? { ...entry, hooks: own } : undefined;
}
/** The person's groups only; an event left without groups is dropped. */
function stripOurs(hooks) {
    const kept = {};
    for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) {
            kept[event] = groups;
            continue;
        }
        const own = groups.map(stripGroup).filter((entry) => entry !== undefined);
        if (own.length > 0)
            kept[event] = own;
    }
    return kept;
}
function hookList(entry) {
    const hooks = entry && typeof entry === 'object' ? entry.hooks : undefined;
    return Array.isArray(hooks) ? hooks : [];
}
function hasOurs(hooks) {
    return Object.values(hooks).some((groups) => Array.isArray(groups)
        && groups.some((entry) => hookList(entry).some(isOurCodexHook)));
}
function merged(file, cli, install) {
    const hooks = stripOurs(hooksOf(file));
    if (install) {
        for (const [event, groups] of Object.entries(codexHarnessHooks(cli))) {
            const current = Array.isArray(hooks[event]) ? hooks[event] : [];
            hooks[event] = [...current, ...groups];
        }
    }
    const out = { ...file };
    if (Object.keys(hooks).length > 0)
        out.hooks = hooks;
    else
        delete out.hooks;
    return out;
}
function save(root, file) {
    const abs = path.join(root, CODEX_HOOKS_PATH);
    if (Object.keys(file).length === 0) {
        fs.rmSync(abs, { force: true });
        return;
    }
    writeTextAtomic(abs, `${JSON.stringify(file, null, 2)}\n`);
}
/** Installs (`install`) or removes sdlc's Codex hooks; a file left empty after removal is deleted. */
export function mergeCodexHooks(root, cli, install, dryRun = false) {
    const exists = fs.existsSync(path.join(root, CODEX_HOOKS_PATH));
    const file = readHooksFile(root);
    const hadOurs = hasOurs(hooksOf(file));
    if (!install && !hadOurs)
        return 'absent';
    const next = merged(file, cli, install);
    if (exists && JSON.stringify(next) === JSON.stringify(file))
        return 'unchanged';
    if (!dryRun)
        save(root, next);
    if (!install)
        return 'removed';
    return hadOurs ? 'updated' : 'installed';
}
/** Whether the file has sdlc's PreToolUse hook for Codex (doctor). */
export function codexHooksInstalled(root) {
    try {
        const groups = hooksOf(readHooksFile(root)).PreToolUse;
        if (!Array.isArray(groups))
            return false;
        return groups.some((entry) => hookList(entry).some((hook) => isOurCodexHook(hook)
            && /--agent\s+codex\b/.test(String(hook.command))));
    }
    catch {
        return false;
    }
}
