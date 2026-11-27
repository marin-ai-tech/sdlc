/** The agent tools sdlc integrates with; `cursor` since 0.13.0 (B80), `codex` (Codex CLI) since 0.14.0 (B82). */
export const TOOL_IDS = ['claude', 'opencode', 'cursor', 'codex', 'qwen', 'gigacode'];
/** The tools of a new project where none is detected: Cursor is chosen, never assumed (0.13.0 keeps the default). */
export const DEFAULT_TOOLS = ['claude', 'opencode'];
