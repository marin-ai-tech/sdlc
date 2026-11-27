import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
/**
 * Merges sdlc's hooks into Cursor's own `.cursor/hooks.json` (B80, 0.13.0) the way settings.ts merges
 * `.claude/settings.json`: every other key and every hook of the person's own stays; sdlc's entries are recognized
 * by their `sdlc hook` command, so `sdlc update` replaces them in place and `sdlc uninstall` removes exactly them.
 * File shape: `{"version": 1, "hooks": {"<event>": [{"command", "matcher"?, "failClosed"?, "timeout"?}]}}`.
 */
export const CURSOR_HOOKS_PATH = '.cursor/hooks.json';
const OURS = /\bhook\s+(session-start|pre-tool|stop)\b/;
/** An entry sdlc wrote: its command runs `sdlc hook <event>`. */
export function isOurCursorHook(entry) {
    if (!entry || typeof entry !== 'object')
        return false;
    const command = entry.command;
    return typeof command === 'string' && OURS.test(command) && /\bsdlc\b/.test(command);
}
/** The command Cursor runs (PowerShell on Windows, sh elsewhere): the CLI, the event, the Cursor answer format. */
export function cursorHookCommand(cli, event) {
    return `${cli} hook ${event} --agent cursor`;
}
/**
 * sdlc's entries. preToolUse covers the writing tools, the shell and MCP and fails closed: a hook that cannot run
 * blocks the call. beforeShellExecution sends the same command check (Cursor gives it the command line).
 */
export function cursorHarnessHooks(cli) {
    const preTool = cursorHookCommand(cli, 'pre-tool');
    return {
        sessionStart: [{ command: cursorHookCommand(cli, 'session-start'), timeout: 30 }],
        // No matcher: an undocumented or future writing tool must not skip the check (read tools are allowed quickly).
        preToolUse: [{ command: preTool, failClosed: true, timeout: 30 }],
        beforeShellExecution: [{ command: preTool, failClosed: true, timeout: 30 }],
        stop: [{ command: cursorHookCommand(cli, 'stop'), timeout: 120 }],
    };
}
function invalid(error) {
    const reason = error instanceof Error ? error.message : String(error);
    return new SdlcError('invalid_cursor_hooks', {
        key: 'error.x_is_not_valid_json_x_hooks_were_not_installed',
        params: { SETTINGS_PATH: CURSOR_HOOKS_PATH, p2: reason },
    }, { key: 'fix.fix_x_then_run_sdlc_update', params: { SETTINGS_PATH: CURSOR_HOOKS_PATH } });
}
/** The file's object; `{}` when it is missing or empty; an error naming the file when it is not a JSON object. */
function readHooksFile(root) {
    const text = readText(path.join(root, CURSOR_HOOKS_PATH));
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
/** The person's entries only: sdlc's are dropped, an event left without entries is dropped too. */
function stripOurs(hooks) {
    const kept = {};
    for (const [event, entries] of Object.entries(hooks)) {
        if (!Array.isArray(entries)) {
            kept[event] = entries;
            continue;
        }
        const own = entries.filter((entry) => !isOurCursorHook(entry));
        if (own.length > 0)
            kept[event] = own;
    }
    return kept;
}
function hasOurs(hooks) {
    return Object.values(hooks).some((entries) => Array.isArray(entries) && entries.some(isOurCursorHook));
}
/** The merged file: the person's keys and hooks, then sdlc's entries when `install`. */
function merged(file, cli, install) {
    const hooks = stripOurs(hooksOf(file));
    if (install) {
        for (const [event, entries] of Object.entries(cursorHarnessHooks(cli))) {
            hooks[event] = [...(hooks[event] ?? []), ...entries];
        }
    }
    const out = { ...file, version: file.version ?? 1 };
    if (Object.keys(hooks).length > 0)
        out.hooks = hooks;
    else
        delete out.hooks;
    return out;
}
/** Writes the file, or removes it when nothing but sdlc's `version` would be left. */
function save(root, file) {
    const abs = path.join(root, CURSOR_HOOKS_PATH);
    const rest = Object.keys(file).filter((key) => key !== 'version');
    if (rest.length === 0) {
        fs.rmSync(abs, { force: true });
        return;
    }
    writeTextAtomic(abs, `${JSON.stringify(file, null, 2)}\n`);
}
/**
 * Installs (`install`) or removes sdlc's Cursor hooks. A missing file is created on install and left missing on
 * removal; a file left with only `version` after removal is deleted.
 */
export function mergeCursorHooks(root, cli, install, dryRun = false) {
    const exists = fs.existsSync(path.join(root, CURSOR_HOOKS_PATH));
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
/** Whether the file has sdlc's pre-tool entry for Cursor (doctor). */
export function cursorHooksInstalled(root) {
    try {
        const hooks = hooksOf(readHooksFile(root));
        return (hooks.preToolUse ?? []).some((entry) => isOurCursorHook(entry)
            && /--agent\s+cursor\b/.test(String(entry.command)));
    }
    catch {
        return false;
    }
}
