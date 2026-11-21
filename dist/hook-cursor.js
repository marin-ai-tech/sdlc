import * as path from 'node:path';
import { isWithin } from './core/fs-utils.js';
import { findProjectRoot } from './core/project.js';
/** Where the file of a Write or Delete may be named; normalizeToolCall reads `file_path`, `path`, `target_file`. */
const PATH_ALIASES = ['file', 'filename', 'target', 'targetFile', 'relative_workspace_path'];
const PATH_KEYS = ['file_path', 'filePath', 'path', 'target_file'];
function text(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
/**
 * The folder the call runs in. The project is found from the workspace roots first (the agent cannot move them, while
 * it can change its shell's directory), then from `cwd` and Cursor's project dir; `cwd` is used for relative paths
 * only when it lies inside that project.
 */
export function cursorRoot(input, env = process.env) {
    const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots.map(text) : [];
    const candidates = [...roots, text(input.cwd), text(env.CURSOR_PROJECT_DIR)].filter((v) => !!v);
    const project = candidates.map((dir) => findProjectRoot(dir)).find((root) => root !== undefined);
    const cwd = text(input.cwd);
    if (!project)
        return cwd ?? candidates[0];
    return cwd && isWithin(project, path.resolve(project, cwd)) ? cwd : project;
}
/**
 * `MCP:<name>` as the MCP stage rule reads it. The server is never taken from the tool's arguments, which the agent
 * writes: a name Cursor already gives as `mcp__<server>__<tool>` is checked by stage, a bare name is not (docs).
 */
export function cursorMcpTool(name) {
    return name.slice('MCP:'.length).trim();
}
/** A `file://` URI as a path (`file:///C:/x` -> `C:/x`, `file:///home/x` -> `/home/x`). */
function fromUri(value) {
    if (!/^file:\/\//i.test(value))
        return value;
    const rest = decodeURIComponent(value.replace(/^file:\/\//i, ''));
    return /^\/[A-Za-z]:/.test(rest) ? rest.slice(1) : rest;
}
/** Every target the input names: the known keys first, then any key that reads like a path, file, uri or target. */
export function cursorTargets(input) {
    const named = [...PATH_KEYS, ...PATH_ALIASES].map((key) => text(input[key]));
    const pathish = Object.entries(input).filter(([key]) => /path|file|uri|target/i.test(key)).flatMap(([, value]) => Array.isArray(value) ? value.map(text) : [text(value)]);
    const all = [...named, ...pathish].filter((value) => value !== undefined).map(fromUri);
    return [...new Set(all)];
}
/** A Write's text as `content`, its target under a key normalizeToolCall reads. */
function cursorToolInput(input) {
    const out = { ...input };
    if (out.content === undefined && typeof out.contents === 'string')
        out.content = out.contents;
    const [target] = cursorTargets(input);
    if (target !== undefined)
        out.file_path = target;
    return out;
}
/** A single-quoted shell word. */
function quoted(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
/**
 * A Delete is checked as the shell command that would do it (`rm -r -- <targets>`), so the shell rules apply to it:
 * folders that hold guarded files (openspec, .cursor, .claude) and guarded files alike. No target: `rm -r -- .`.
 */
function cursorDelete(input, cwd) {
    const targets = cursorTargets(input);
    const words = (targets.length > 0 ? targets : ['.']).map(quoted).join(' ');
    return { tool_name: 'Shell', tool_input: { command: `rm -r -- ${words}`, ...(cwd ? { cwd } : {}) } };
}
function cursorToolCall(input, cwd) {
    const shell = input.hook_event_name === 'beforeShellExecution'
        || (input.tool_name === undefined && typeof input.command === 'string');
    if (shell)
        return { tool_name: 'Shell', tool_input: { command: input.command ?? '', ...(cwd ? { cwd } : {}) } };
    const raw = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
    const name = String(input.tool_name ?? '');
    if (name.toLowerCase() === 'delete')
        return cursorDelete(raw, cwd);
    const tool = name.startsWith('MCP:') ? cursorMcpTool(name) : name;
    return { tool_name: tool, tool_input: cursorToolInput(raw) };
}
/** Cursor's input in the dispatcher's terms; the stop hook stays quiet once Cursor is already following up. */
export function fromCursor(input, env = process.env) {
    const cwd = cursorRoot(input, env);
    return {
        ...(text(input.conversation_id) ? { session_id: input.conversation_id } : {}),
        ...(cwd ? { cwd } : {}),
        ...cursorToolCall(input, cwd),
        stop_hook_active: typeof input.loop_count === 'number' && input.loop_count > 0,
        ...(input.hook_event_name === 'preToolUse' && input.tool_name === 'Shell' ? { skip_log: true } : {}),
    };
}
/** A denial: the person sees the reason, and so does the agent. */
export function cursorDeny(reason) {
    return { permission: 'deny', user_message: reason, agent_message: reason };
}
/** An allowed call; with a reminder for the agent (warn mode, once per conversation). */
export function cursorAllow(reminder) {
    return reminder ? { permission: 'allow', agent_message: reminder } : { permission: 'allow' };
}
/** The answer when sdlc has nothing to say: Cursor always gets JSON, so a failClosed hook never reads silence. */
export function cursorDefault(event) {
    return event === 'pre-tool' ? cursorAllow() : {};
}
