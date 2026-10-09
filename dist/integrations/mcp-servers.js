import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { cursorRefs, mapValues, openCodeRefs } from '../mcp/registry.js';
import { CODEX_CONFIG_PATH, mcpTables, readConfigToml, registryServerTable, setMcpTables, writeConfigToml, } from './codex-toml.js';
import { readManifest, writeManifest } from './manifest.js';
import { readJson, servers as serverMap, writeJson } from './mcp-config.js';
/** `{ key: map }` when the map has entries, else nothing: empty `env`/`headers` are omitted. */
function nonEmpty(key, map) {
    return Object.keys(map).length > 0 ? { [key]: map } : {};
}
function claudeEntry(server) {
    if (server.type === 'http')
        return { type: 'http', url: server.url, ...nonEmpty('headers', server.headers) };
    const [command, ...args] = server.command;
    return { type: 'stdio', command, args, ...nonEmpty('env', server.env) };
}
function openCodeEntry(server) {
    if (server.type === 'http') {
        const headers = mapValues(server.headers, openCodeRefs);
        return { type: 'remote', url: openCodeRefs(server.url), ...nonEmpty('headers', headers), enabled: true };
    }
    const environment = mapValues(server.env, openCodeRefs);
    const command = server.command.map(openCodeRefs);
    return { type: 'local', command, ...nonEmpty('environment', environment), enabled: true };
}
function cursorEntry(server) {
    if (server.type === 'http') {
        const headers = mapValues(server.headers, cursorRefs);
        return { url: cursorRefs(server.url), ...nonEmpty('headers', headers) };
    }
    const [command, ...args] = server.command.map(cursorRefs);
    return { command, args, ...nonEmpty('env', mapValues(server.env, cursorRefs)) };
}
function qwenEntry(server) {
    if (server.type === 'http')
        return { httpUrl: server.url, ...nonEmpty('headers', server.headers) };
    const [command, ...args] = server.command;
    return { command, args, ...nonEmpty('env', server.env) };
}
const TARGETS = [
    { tool: 'claude', file: '.mcp.json', key: 'mcpServers', entry: claudeEntry },
    { tool: 'opencode', file: 'opencode.json', key: 'mcp', entry: openCodeEntry },
    { tool: 'cursor', file: '.cursor/mcp.json', key: 'mcpServers', entry: cursorEntry },
    { tool: 'qwen', file: '.qwen/settings.json', key: 'mcpServers', entry: qwenEntry },
    { tool: 'gigacode', file: '.gigacode/settings.json', key: 'mcpServers', entry: qwenEntry },
];
function noChanges() {
    return { added: [], updated: [], removed: [], kept: [] };
}
function changed(changes) {
    return changes.added.length + changes.updated.length + changes.removed.length > 0;
}
/** Sets the wanted entries in `map`; returns the names that are sdlc's after it. */
function setWanted(map, target, wanted, owned, changes) {
    const mine = [];
    for (const server of wanted) {
        const entry = target.entry(server);
        const current = map[server.name];
        if (current !== undefined && !isDeepStrictEqual(current, entry) && !owned.includes(server.name)) {
            changes.kept.push(server.name);
            continue;
        }
        if (current === undefined)
            changes.added.push(server.name);
        else if (!isDeepStrictEqual(current, entry))
            changes.updated.push(server.name);
        map[server.name] = entry;
        mine.push(server.name);
    }
    return mine;
}
/** Removes the entries sdlc wrote that the registry no longer has. */
function dropUnwanted(map, wanted, owned, changes) {
    for (const name of owned) {
        if (wanted.some((server) => server.name === name) || map[name] === undefined)
            continue;
        delete map[name];
        changes.removed.push(name);
    }
}
/** The file's JSON; undefined when absent. Invalid JSON is an error only when something is to be written. */
function readTarget(root, target, wanted) {
    try {
        return readJson(root, target.file);
    }
    catch (error) {
        if (wanted.length > 0)
            throw error;
        return undefined;
    }
}
function writeTarget(root, target, json, map) {
    if (Object.keys(map).length > 0)
        json[target.key] = map;
    else
        delete json[target.key];
    if (Object.keys(json).length > 0)
        writeJson(root, target.file, json);
    else
        fs.rmSync(path.join(root, target.file), { force: true });
}
function layOut(root, target, wanted, owned, dryRun) {
    const json = readTarget(root, target, wanted);
    if (!json && wanted.length === 0)
        return { changes: noChanges(), owned: [] };
    const doc = json ?? {};
    const map = { ...serverMap(doc, target.key) };
    const changes = noChanges();
    const mine = setWanted(map, target, wanted, owned, changes);
    dropUnwanted(map, wanted, owned, changes);
    if (changed(changes) && !dryRun)
        writeTarget(root, target, doc, map);
    return { changes, owned: mine };
}
/** Codex's TOML file (B82): the same layout, with each server's table text as its entry. */
function layOutCodex(root, wanted, owned, dryRun) {
    const text = readConfigToml(root);
    if (text === undefined && wanted.length === 0)
        return { changes: noChanges(), owned: [] };
    const map = { ...mcpTables(text ?? '') };
    const changes = noChanges();
    const target = { tool: 'codex', file: CODEX_CONFIG_PATH, key: 'mcp_servers', entry: registryServerTable };
    const mine = setWanted(map, target, wanted, owned, changes);
    dropUnwanted(map, wanted, owned, changes);
    if (changed(changes) && !dryRun) {
        const names = [...changes.added, ...changes.updated, ...changes.removed];
        const tables = Object.fromEntries(names.map((name) => [name, map[name]]));
        writeConfigToml(root, setMcpTables(text ?? '', tables));
    }
    return { changes, owned: mine };
}
function saveOwned(root, manifest, owned, dryRun) {
    const before = manifest.mcpServers ?? {};
    if (dryRun || isDeepStrictEqual(before, owned))
        return;
    if (Object.keys(owned).length > 0)
        manifest.mcpServers = owned;
    else
        delete manifest.mcpServers;
    writeManifest(root, manifest);
}
/** Lays out `servers` for the configured tools; a tool not configured loses sdlc's entries. Keyed by file. */
export function applyRegistryServers(root, servers, tools, dryRun = false) {
    const manifest = readManifest(root);
    const result = {};
    const owned = {};
    for (const target of TARGETS) {
        const wanted = tools.includes(target.tool) ? servers : [];
        const layout = layOut(root, target, wanted, manifest.mcpServers?.[target.file] ?? [], dryRun);
        if (layout.owned.length > 0)
            owned[target.file] = layout.owned;
        if (changed(layout.changes) || layout.changes.kept.length > 0)
            result[target.file] = layout.changes;
    }
    const codexOwned = manifest.mcpServers?.[CODEX_CONFIG_PATH] ?? [];
    const codex = layOutCodex(root, tools.includes('codex') ? servers : [], codexOwned, dryRun);
    if (codex.owned.length > 0)
        owned[CODEX_CONFIG_PATH] = codex.owned;
    if (changed(codex.changes) || codex.changes.kept.length > 0)
        result[CODEX_CONFIG_PATH] = codex.changes;
    saveOwned(root, manifest, owned, dryRun);
    return result;
}
/** `sdlc uninstall`: removes only the registry entries sdlc wrote. Keyed by file. */
export function removeRegistryServers(root, dryRun = false) {
    return applyRegistryServers(root, [], [], dryRun);
}
