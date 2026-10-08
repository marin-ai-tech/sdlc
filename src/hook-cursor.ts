import * as path from 'node:path';
import { isWithin } from './core/fs-utils.js';
import { findProjectRoot } from './core/project.js';

/**
 * Cursor's hook protocol (B80, 0.13.0) for `sdlc hook <event> --agent cursor`: its input is translated into the
 * shape the policy engine reads, and the engine's answer into Cursor's. The policy itself is the same for every tool.
 *
 * Input (stdin): common fields (`conversation_id`, `generation_id`, `hook_event_name`, `cursor_version`,
 * `workspace_roots`, `user_email`), plus per event:
 * - preToolUse: `tool_name` (`Shell|Read|Write|Grep|Delete|Task|MCP:<name>`), `tool_input`, `cwd`;
 * - beforeShellExecution: `command`, `cwd` (checked as the Shell tool);
 * - stop: `status`, `loop_count`.
 * Answers (stdout): preToolUse and beforeShellExecution `{permission, user_message?, agent_message?}`;
 * sessionStart `{additional_context}`; stop `{followup_message}` or `{}`.
 */
export interface CursorInput {
  conversation_id?: string;
  hook_event_name?: string;
  workspace_roots?: unknown;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  command?: string;
  loop_count?: number;
}

/** What the dispatcher reads (the Claude Code field names). */
export interface NormalizedInput {
  session_id?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
  /** A Shell call seen by preToolUse: beforeShellExecution checks the same command and logs the decision. */
  skip_log?: boolean;
}

/** Where the file of a Write or Delete may be named; normalizeToolCall reads `file_path`, `path`, `target_file`. */
const PATH_ALIASES = ['file', 'filename', 'target', 'targetFile', 'relative_workspace_path'];
const PATH_KEYS = ['file_path', 'filePath', 'path', 'target_file'];

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * The folder the call runs in. The project is found from the workspace roots first (the agent cannot move them, while
 * it can change its shell's directory), then from `cwd` and Cursor's project dir; `cwd` is used for relative paths
 * only when it lies inside that project.
 */
export function cursorRoot(input: CursorInput, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const roots = Array.isArray(input.workspace_roots) ? input.workspace_roots.map(text) : [];
  const candidates = [...roots, text(input.cwd), text(env.CURSOR_PROJECT_DIR)].filter((v): v is string => !!v);
  const project = candidates.map((dir) => findProjectRoot(dir)).find((root): root is string => root !== undefined);
  const cwd = text(input.cwd);
  if (!project) return cwd ?? candidates[0];
  return cwd && isWithin(project, path.resolve(project, cwd)) ? cwd : project;
}

/**
 * `MCP:<name>` as the MCP stage rule reads it. The server is never taken from the tool's arguments, which the agent
 * writes: a name Cursor already gives as `mcp__<server>__<tool>` is checked by stage, a bare name is not (docs).
 */
export function cursorMcpTool(name: string): string {
  return name.slice('MCP:'.length).trim();
}

/** A `file://` URI as a path (`file:///C:/x` -> `C:/x`, `file:///home/x` -> `/home/x`). */
function fromUri(value: string): string {
  if (!/^file:\/\//i.test(value)) return value;
  const rest = decodeURIComponent(value.replace(/^file:\/\//i, ''));
  return /^\/[A-Za-z]:/.test(rest) ? rest.slice(1) : rest;
}

/** Every target the input names: the known keys first, then any key that reads like a path, file, uri or target. */
export function cursorTargets(input: Record<string, unknown>): string[] {
  const named = [...PATH_KEYS, ...PATH_ALIASES].map((key) => text(input[key]));
  const pathish = Object.entries(input).filter(([key]) => /path|file|uri|target/i.test(key)).flatMap(([, value]) =>
    Array.isArray(value) ? value.map(text) : [text(value)]);
  const all = [...named, ...pathish].filter((value): value is string => value !== undefined).map(fromUri);
  return [...new Set(all)];
}

/** A Write's text as `content`, its target under a key normalizeToolCall reads. */
function cursorToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...input };
  if (out.content === undefined && typeof out.contents === 'string') out.content = out.contents;
  const [target] = cursorTargets(input);
  if (target !== undefined) out.file_path = target;
  return out;
}

/** A single-quoted shell word. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A Delete is checked as the shell command that would do it (`rm -r -- <targets>`), so the shell rules apply to it:
 * folders that hold guarded files (openspec, .cursor, .claude) and guarded files alike. No target: `rm -r -- .`.
 */
function cursorDelete(input: Record<string, unknown>, cwd: string | undefined): ToolFields {
  const targets = cursorTargets(input);
  const words = (targets.length > 0 ? targets : ['.']).map(quoted).join(' ');
  return { tool_name: 'Shell', tool_input: { command: `rm -r -- ${words}`, ...(cwd ? { cwd } : {}) } };
}

/** The tool call of a preToolUse or beforeShellExecution input. */
type ToolFields = Pick<NormalizedInput, 'tool_name' | 'tool_input'>;

function cursorToolCall(input: CursorInput, cwd: string | undefined): ToolFields {
  const shell = input.hook_event_name === 'beforeShellExecution'
    || (input.tool_name === undefined && typeof input.command === 'string');
  if (shell) return { tool_name: 'Shell', tool_input: { command: input.command ?? '', ...(cwd ? { cwd } : {}) } };
  const raw = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const name = String(input.tool_name ?? '');
  if (name.toLowerCase() === 'delete') return cursorDelete(raw, cwd);
  const tool = name.startsWith('MCP:') ? cursorMcpTool(name) : name;
  return { tool_name: tool, tool_input: cursorToolInput(raw) };
}

/** Cursor's input in the dispatcher's terms; the stop hook stays quiet once Cursor is already following up. */
export function fromCursor(input: CursorInput, env: NodeJS.ProcessEnv = process.env): NormalizedInput {
  const cwd = cursorRoot(input, env);
  return {
    ...(text(input.conversation_id) ? { session_id: input.conversation_id } : {}),
    ...(cwd ? { cwd } : {}),
    ...cursorToolCall(input, cwd),
    stop_hook_active: typeof input.loop_count === 'number' && input.loop_count > 0,
    ...(input.hook_event_name === 'preToolUse' && input.tool_name === 'Shell' ? { skip_log: true } : {}),
  };
}

export type CursorPermission = { permission: 'allow' | 'deny'; user_message?: string; agent_message?: string };

/** A denial: the person sees the reason, and so does the agent. */
export function cursorDeny(reason: string): CursorPermission {
  return { permission: 'deny', user_message: reason, agent_message: reason };
}

/** An allowed call; with a reminder for the agent (warn mode, once per conversation). */
export function cursorAllow(reminder?: string): CursorPermission {
  return reminder ? { permission: 'allow', agent_message: reminder } : { permission: 'allow' };
}

/** The answer when sdlc has nothing to say: Cursor always gets JSON, so a failClosed hook never reads silence. */
export function cursorDefault(event: string): Record<string, unknown> {
  return event === 'pre-tool' ? cursorAllow() : {};
}
