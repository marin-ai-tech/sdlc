import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJson, writeJson } from './mcp-config.js';
import { cliSpellings, SECOND_LAYER_COMMANDS, secondLayerCommands } from './second-layer.js';
export function qwenSettingsPath(id) {
    return `.${id}/settings.json`;
}
function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function isOurHook(value) {
    const command = object(value).command;
    return typeof command === 'string' && /\bsdlc\b/.test(command)
        && /\bhook\s+(?:session-start|pre-tool|stop)\b/.test(command);
}
function groupWithoutOurHooks(group) {
    const item = object(group);
    const hooks = Array.isArray(item.hooks) ? item.hooks.filter((entry) => !isOurHook(entry)) : [];
    return { ...item, hooks };
}
function hooksWithoutOurs(hooks) {
    const result = {};
    for (const [event, groups] of Object.entries(hooks)) {
        if (!Array.isArray(groups)) {
            result[event] = groups;
            continue;
        }
        const kept = groups.map(groupWithoutOurHooks).filter((group) => group.hooks.length > 0);
        if (kept.length > 0)
            result[event] = kept;
    }
    return result;
}
function hookGroup(cli, id, event, timeout) {
    return [{
            hooks: [{
                    type: 'command',
                    command: `${cli} hook ${event} --agent ${id}`,
                    timeout,
                }],
        }];
}
function ourGroups(cli, id) {
    return {
        SessionStart: hookGroup(cli, id, 'session-start', 30),
        PreToolUse: hookGroup(cli, id, 'pre-tool', 30),
        Stop: hookGroup(cli, id, 'stop', 120),
    };
}
const HUMAN = SECOND_LAYER_COMMANDS.map((command) => command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));
const SDLC_CLI = String.raw `(?:[^)]*\s)?(?:[^\s()]*[/\\])?(?:sdlc|scdl)(?:\.js|\.cmd|\.ps1|\.exe)?`;
const OUR_DENY = new RegExp(`^Bash\\(${SDLC_CLI}\\s+(?:${HUMAN.join('|')})(?:\\s+\\*)?\\)$`);
export function qwenDeny(cli, commands = SECOND_LAYER_COMMANDS) {
    return cliSpellings(cli).flatMap((spelling) => commands.flatMap((command) => [
        `Bash(${spelling} ${command})`,
        `Bash(${spelling} ${command} *)`,
    ]));
}
function merged(file, cli, id, install, commands) {
    const out = { ...file };
    const hooks = hooksWithoutOurs(object(file.hooks));
    if (install) {
        for (const [event, groups] of Object.entries(ourGroups(cli, id))) {
            hooks[event] = [...(Array.isArray(hooks[event]) ? hooks[event] : []), ...groups];
        }
    }
    if (Object.keys(hooks).length > 0)
        out.hooks = hooks;
    else
        delete out.hooks;
    mergePermissions(out, file, cli, install, commands);
    return out;
}
function mergePermissions(out, file, cli, install, commands) {
    const permissions = { ...object(file.permissions) };
    const owned = Array.isArray(file._sdlcPluginDeny) ? [...file._sdlcPluginDeny] : [];
    const removeOwned = (rule) => {
        const at = owned.indexOf(rule);
        if (at < 0)
            return false;
        owned.splice(at, 1);
        return true;
    };
    const deny = Array.isArray(permissions.deny)
        ? permissions.deny.filter((rule) => typeof rule !== 'string'
            || (!OUR_DENY.test(rule) && !removeOwned(rule)))
        : [];
    const pluginRules = install ? qwenDeny(cli, commands.filter((command) => !SECOND_LAYER_COMMANDS.includes(command))) : [];
    const added = pluginRules.filter((rule) => !deny.includes(rule));
    if (install)
        deny.push(...qwenDeny(cli), ...added);
    if (added.length)
        out._sdlcPluginDeny = added;
    else
        delete out._sdlcPluginDeny;
    if (deny.length > 0)
        permissions.deny = deny;
    else
        delete permissions.deny;
    if (Object.keys(permissions).length > 0)
        out.permissions = permissions;
    else
        delete out.permissions;
}
export function mergeQwenSettings(root, cli, id, install, dryRun = false) {
    const rel = qwenSettingsPath(id);
    const file = readJson(root, rel) ?? {};
    const next = merged(file, cli, id, install, install ? secondLayerCommands(root) : []);
    if (JSON.stringify(file) === JSON.stringify(next))
        return install ? 'unchanged' : 'absent';
    if (!dryRun) {
        if (Object.keys(next).length > 0)
            writeJson(root, rel, next);
        else
            fs.rmSync(path.join(root, rel), { force: true });
    }
    return install ? 'installed' : 'removed';
}
function commandsOfEvent(hooks, event) {
    const groups = hooks[event];
    if (!Array.isArray(groups))
        return [];
    const commands = [];
    for (const group of groups) {
        const entries = object(group).hooks;
        if (!Array.isArray(entries))
            continue;
        for (const entry of entries) {
            const command = object(entry).command;
            if (typeof command === 'string')
                commands.push(command);
        }
    }
    return commands;
}
function installedCli(hooks, id) {
    const suffix = ` hook pre-tool --agent ${id}`;
    const command = commandsOfEvent(hooks, 'PreToolUse').find((value) => value.endsWith(suffix));
    return command ? command.slice(0, -suffix.length) : '';
}
export function qwenSettingsInstalled(root, id) {
    try {
        const file = readJson(root, qwenSettingsPath(id)) ?? {};
        const hooks = object(file.hooks);
        const cli = installedCli(hooks, id);
        const deny = object(file.permissions).deny;
        return cli !== '' && commandsOfEvent(hooks, 'SessionStart').includes(`${cli} hook session-start --agent ${id}`)
            && commandsOfEvent(hooks, 'Stop').includes(`${cli} hook stop --agent ${id}`)
            && Array.isArray(deny) && qwenDeny(cli, secondLayerCommands(root)).every((rule) => deny.includes(rule));
    }
    catch {
        return false;
    }
}
