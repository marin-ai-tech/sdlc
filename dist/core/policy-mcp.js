import { t } from './i18n.js';
import { RESERVED_SERVER } from '../mcp/registry.js';
/**
 * Rule `mcp-stage` (B43), a process rule: a call to a tool of a registry server (`mcp.servers`) whose `stages`
 * include none of the active changes' stages is denied in `block` and reminded in `warn`. Claude Code names the
 * tool `mcp__<server>__<tool>`, OpenCode `<server>_<tool>` (server = a registry name). Not governed: the `sdlc`
 * server, servers outside the registry, a server without `stages`, and a project without an active change.
 */
const CLAUDE_TOOL = /^mcp__(.+?)__/;
/** The registry server a tool name belongs to, if any. */
export function mcpServerOf(tool, servers) {
    const claude = CLAUDE_TOOL.exec(tool);
    if (claude)
        return servers.find((server) => server.name === claude[1]);
    const prefixed = servers.filter((server) => tool.startsWith(`${server.name}_`));
    return prefixed.sort((a, b) => b.name.length - a.name.length)[0];
}
/**
 * The decision for an MCP tool call; undefined when the rule has nothing to say. `stages` gives the active
 * changes' stages and is called only for a governed server.
 */
export function mcpStageDecision(tool, config, stages) {
    const mode = config.enforcement.mode;
    if (mode === 'off')
        return undefined;
    const server = mcpServerOf(tool, config.mcp?.servers ?? []);
    if (!server || server.name === RESERVED_SERVER || server.stages.length === 0)
        return undefined;
    const current = [...new Set(stages())];
    if (current.length === 0 || current.some((stage) => server.stages.includes(stage)))
        return undefined;
    const params = { server: server.name, stages: server.stages.join(', '), current: current.join(', ') };
    return { decision: mode === 'block' ? 'deny' : 'warn', rule: 'mcp-stage', reason: t('hook.mcpStage', params) };
}
