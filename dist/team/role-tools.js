/**
 * The `tools` of a team role reach the front matter of a generated subagent (`.claude/agents/sdlc-<role>.md`), so
 * an entry is parsed at both boundaries, the registry answer and the role file (B249). An entry is a tool name
 * (letters, digits, `_`, `-`, not starting with `-`) with an optional `(pattern)`, as in `read`, `Bash(git:*)` or
 * `mcp__roles__list_roles`. The pattern holds no parenthesis, no control character (Cc), no format character (Cf,
 * such as a bidi override that reorders what a person reads) and no line or paragraph separator, so no entry can end
 * the line or add a key; outside the parentheses only name characters are allowed, so no colon-space. A role lists
 * at most `MAX_TOOL_ENTRIES` entries of at most `MAX_TOOL_ENTRY_LENGTH` characters each (B249 review F9).
 */
const TOOL_ENTRY = /^[A-Za-z0-9_][A-Za-z0-9_-]*(?:\([^()\p{Cc}\p{Cf}\p{Zl}\p{Zp}]*\))?$/u;
export const MAX_TOOL_ENTRIES = 64;
export const MAX_TOOL_ENTRY_LENGTH = 200;
/** True when `entry` is a tool name with an optional `(pattern)`, at most `MAX_TOOL_ENTRY_LENGTH` characters. */
export function isToolEntry(entry) {
    return typeof entry === 'string' && entry.length <= MAX_TOOL_ENTRY_LENGTH && TOOL_ENTRY.test(entry);
}
function entryProblem(entry, position) {
    if (isToolEntry(entry))
        return undefined;
    if (typeof entry === 'string' && entry.length > MAX_TOOL_ENTRY_LENGTH) {
        return `tools entry ${position} is longer than ${MAX_TOOL_ENTRY_LENGTH} characters`;
    }
    return `tools entry ${position} is not a tool name with an optional (pattern), such as Bash(git:*)`;
}
/**
 * Why `entries` are not a role's tools, or undefined when every entry is one. The entry is named by its position
 * only: its text may be what the check refuses, and the reason is printed and may be recorded.
 */
export function roleToolsProblem(entries) {
    if (entries.length > MAX_TOOL_ENTRIES)
        return `tools lists more than ${MAX_TOOL_ENTRIES} entries`;
    for (const [index, entry] of entries.entries()) {
        const problem = entryProblem(entry, index + 1);
        if (problem)
            return problem;
    }
    return undefined;
}
