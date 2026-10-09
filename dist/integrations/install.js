import * as fs from 'node:fs';
import * as path from 'node:path';
import { isDirectory, listFilesRecursive, normalizeNewlines, readText } from '../core/fs-utils.js';
import { generatedNotice, harnessStamp } from '../core/license.js';
import { harnessPackageDir } from '../core/openspec-schema.js';
import { harnessVersion } from '../core/version.js';
import { claudeAdapter } from './claude.js';
import { codexAdapter } from './codex.js';
import { CODEX_HOOKS_PATH, mergeCodexHooks } from './codex-hooks.js';
import { cursorAdapter } from './cursor.js';
import { qwenAdapter, gigacodeAdapter } from './qwen-family.js';
import { mergeQwenSettings, qwenSettingsPath } from './qwen-settings.js';
import { CURSOR_HOOKS_PATH, mergeCursorHooks } from './cursor-hooks.js';
import { applyFiles } from './manifest.js';
import { opencodeAdapter } from './opencode.js';
import { applyMcpRegistration, removeMcpRegistration } from './mcp-config.js';
import { applyRegistryServers, removeRegistryServers } from './mcp-servers.js';
import { assertNoSecretLiterals } from '../mcp/registry.js';
import { mergeClaudeHooks, mergeClaudeStatusLine } from './settings.js';
import { renderSkills } from './skills.js';
import { renderTeamSkills } from './team-skills.js';
import { acceptedRoles } from '../team/accepted.js';
import { TOOL_IDS } from './types.js';
export const ADAPTERS = {
    claude: claudeAdapter,
    opencode: opencodeAdapter,
    cursor: cursorAdapter,
    codex: codexAdapter,
    qwen: qwenAdapter,
    gigacode: gigacodeAdapter,
};
export function parseTools(value, fallback) {
    if (value === undefined)
        return fallback;
    const v = value.trim().toLowerCase();
    if (v === 'none' || v === '')
        return [];
    if (v === 'all')
        return [...TOOL_IDS];
    const tools = v.split(',').map((t) => t.trim()).filter(Boolean);
    const unknown = tools.filter((t) => !TOOL_IDS.includes(t));
    if (unknown.length > 0) {
        throw new Error(`Unknown tool(s): ${unknown.join(', ')}. Supported: ${TOOL_IDS.join(', ')}, all, none.`);
    }
    return [...new Set(tools)];
}
/** Tools whose files or directories already exist in the project. */
export function detectTools(root) {
    return TOOL_IDS.filter((id) => ADAPTERS[id].detectPaths.some((p) => fs.existsSync(path.join(root, p))));
}
/**
 * The harness's OpenSpec schema, copied into `openspec/schemas/sdlc/` so the
 * OpenSpec CLI (and OpenSpec's own /opsx workflows) resolve it project-locally.
 * `schema.yaml` carries the generated-file notice; the artifact templates do
 * not, because their text becomes the project's own artifacts.
 */
export function schemaFiles(stamp) {
    const dir = path.join(harnessPackageDir(), 'schemas', 'sdlc');
    if (!isDirectory(dir))
        return [];
    return listFilesRecursive(dir).map((rel) => {
        const content = normalizeNewlines(readText(path.join(dir, rel)) ?? '');
        return {
            path: `openspec/schemas/sdlc/${rel}`,
            content: rel === 'schema.yaml' ? `${generatedNotice(stamp, 'yaml')}\n${content}` : content,
            tool: 'shared',
            kind: 'schema',
        };
    });
}
/** What the generated files are rendered from; with `root`, also the project's accepted roles (B70). */
export function renderContext(config, tools, root) {
    const stamp = harnessStamp(config);
    const base = { tools, delivery: config.delivery, cli: config.cli, version: stamp.version, config, stamp };
    return root === undefined ? base : { ...base, root, team: acceptedRoles(root) };
}
export function renderAll(ctx) {
    const files = [...schemaFiles(ctx.stamp), ...renderSkills(ctx), ...renderTeamSkills(ctx)];
    for (const tool of ctx.tools)
        files.push(...ADAPTERS[tool].render(ctx));
    return files;
}
export function installIntegrations(root, config, tools, options = {}) {
    // A literal secret in the registry is refused before anything is written (`mcp_secret_literal`).
    assertNoSecretLiterals(config.mcp?.servers ?? []);
    const ctx = renderContext(config, tools, root);
    const files = renderAll(ctx);
    const report = applyFiles(root, files, {
        force: options.force,
        dryRun: options.dryRun,
        version: ctx.version,
        license: ctx.stamp.license,
    });
    const wantHooks = tools.includes('claude') && options.hooks !== false;
    const claudeHooks = tools.includes('claude') || fs.existsSync(path.join(root, '.claude', 'settings.json'))
        ? mergeClaudeHooks(root, config.cli, wantHooks, options.dryRun)
        : 'absent';
    const statusLine = tools.includes('claude') || fs.existsSync(path.join(root, '.claude', 'settings.json'))
        ? mergeClaudeStatusLine(root, config.cli, tools.includes('claude') && config.statusline, options.dryRun)
        : 'absent';
    const cursorHooks = applyCursorHooks(root, config.cli, tools, options);
    const codexHooks = applyCodexHooks(root, config.cli, tools, options);
    const qwenHooks = applyFamilySettings(root, config.cli, 'qwen', tools, options);
    const gigacodeHooks = applyFamilySettings(root, config.cli, 'gigacode', tools, options);
    const mcp = applyMcpRegistration(root, config, tools, options.dryRun);
    const servers = applyRegistryServers(root, config.mcp?.servers ?? [], tools, options.dryRun);
    return { tools, files: report, claudeHooks, cursorHooks, codexHooks, qwenHooks, gigacodeHooks,
        statusLine, mcp, servers };
}
function applyFamilySettings(root, cli, id, tools, options) {
    if (!tools.includes(id) && !fs.existsSync(path.join(root, qwenSettingsPath(id))))
        return 'absent';
    return mergeQwenSettings(root, cli, id, tools.includes(id) && options.hooks !== false, options.dryRun);
}
/** Codex's hooks while Codex is a tool (and hooks are wanted); sdlc's entries go when it no longer is (B82). */
function applyCodexHooks(root, cli, tools, options) {
    const wanted = tools.includes('codex') && options.hooks !== false;
    if (!tools.includes('codex') && !fs.existsSync(path.join(root, CODEX_HOOKS_PATH)))
        return 'absent';
    return mergeCodexHooks(root, cli, wanted, options.dryRun);
}
/** Cursor's hooks while Cursor is a tool (and hooks are wanted); sdlc's entries go when it no longer is. */
function applyCursorHooks(root, cli, tools, options) {
    const wanted = tools.includes('cursor') && options.hooks !== false;
    if (!tools.includes('cursor') && !fs.existsSync(path.join(root, CURSOR_HOOKS_PATH)))
        return 'absent';
    return mergeCursorHooks(root, cli, wanted, options.dryRun);
}
/** Folders sdlc's files leave behind, deepest first; each goes only when nothing of the person's own is left. */
const PRUNED_FOLDERS = [
    '.cursor',
    '.codex/rules', '.codex/agents', '.codex',
    '.agents/skills', '.agents',
    '.qwen/agents', '.qwen/commands', '.qwen/skills', '.qwen',
    '.gigacode/agents', '.gigacode/commands', '.gigacode/skills', '.gigacode',
];
/** The tools' folders once sdlc's files are gone from them, if nothing of the person's own is left. */
function pruneToolFolders(root, dryRun) {
    if (dryRun)
        return;
    for (const rel of PRUNED_FOLDERS) {
        const dir = path.join(root, rel);
        if (!isDirectory(dir))
            continue;
        try {
            if (fs.readdirSync(dir).length === 0)
                fs.rmdirSync(dir);
        }
        catch {
            // Best effort: a folder that cannot be read or removed stays.
        }
    }
}
/**
 * Re-renders the generated files for the configured tools without touching
 * hook settings, so their notices follow a license change.
 */
export function refreshGeneratedFiles(root, config) {
    const ctx = renderContext(config, config.tools.filter((t) => t in ADAPTERS), root);
    return applyFiles(root, renderAll(ctx), { version: ctx.version, license: ctx.stamp.license });
}
/** Removes every generated file (unless edited), the Claude, Cursor and Codex hooks. Planning data is never touched. */
export function uninstallIntegrations(root, options = {}) {
    const report = applyFiles(root, [], {
        force: options.force,
        dryRun: options.dryRun,
        version: harnessVersion(),
        removeObsolete: (entry) => entry.kind !== 'schema',
    });
    const claudeHooks = fs.existsSync(path.join(root, '.claude', 'settings.json'))
        ? mergeClaudeHooks(root, 'sdlc', false, options.dryRun)
        : 'absent';
    const statusLine = fs.existsSync(path.join(root, '.claude', 'settings.json'))
        ? mergeClaudeStatusLine(root, 'sdlc', false, options.dryRun)
        : 'absent';
    const cursorHooks = fs.existsSync(path.join(root, CURSOR_HOOKS_PATH))
        ? mergeCursorHooks(root, 'sdlc', false, options.dryRun)
        : 'absent';
    const codexHooks = fs.existsSync(path.join(root, CODEX_HOOKS_PATH))
        ? mergeCodexHooks(root, 'sdlc', false, options.dryRun)
        : 'absent';
    const qwenHooks = fs.existsSync(path.join(root, qwenSettingsPath('qwen')))
        ? mergeQwenSettings(root, 'sdlc', 'qwen', false, options.dryRun) : 'absent';
    const gigacodeHooks = fs.existsSync(path.join(root, qwenSettingsPath('gigacode')))
        ? mergeQwenSettings(root, 'sdlc', 'gigacode', false, options.dryRun) : 'absent';
    const mcp = removeMcpRegistration(root, options.dryRun);
    const servers = removeRegistryServers(root, options.dryRun);
    pruneToolFolders(root, options.dryRun);
    return { tools: [], files: report, claudeHooks, cursorHooks, codexHooks, qwenHooks, gigacodeHooks,
        statusLine, mcp, servers };
}
