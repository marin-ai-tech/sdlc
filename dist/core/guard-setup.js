import { SdlcError } from './errors.js';
/**
 * Setup commands in an agent session (B41). `sdlc init` and `sdlc update` write the guard's own files, so inside
 * an agent session they may restore what the project configured, or strengthen it, but not weaken it: a lower
 * enforcement mode (off < warn < block), a configured tool dropped, `--no-hooks` while Claude Code is a tool, or a
 * different `--cli` (the hooks would call it instead of sdlc). The refusal comes before anything is written; a
 * person (no agent markers) may do all of it. Pure: the caller passes the agent marker and the fix to show.
 */
const MODE_RANK = { off: 0, warn: 1, block: 2 };
/** The guard settings of a configuration; `knownTools` filters the tool names setup can install. */
export function guardSettings(config, knownTools) {
    const tools = config.tools.filter((tool) => knownTools.includes(tool));
    return { mode: config.enforcement.mode, tools, cli: config.cli };
}
/** What in the request weakens the guard, one flag each (`--mode: block -> off`); empty when nothing does. */
export function guardWeakenings(current, request) {
    const out = [];
    if (request.mode !== undefined && MODE_RANK[request.mode] < MODE_RANK[current.mode]) {
        out.push(`--mode: ${current.mode} -> ${request.mode}`);
    }
    const tools = request.tools ?? current.tools;
    if (current.tools.some((tool) => !tools.includes(tool))) {
        out.push(`--tools: ${current.tools.join(',')} -> ${tools.join(',') || 'none'}`);
    }
    if (request.hooks === false && tools.includes('claude'))
        out.push('--no-hooks');
    if (request.cli !== undefined && request.cli !== current.cli)
        out.push(`--cli: ${current.cli} -> ${request.cli}`);
    return out;
}
/**
 * The guard binds the session: an agent runs it, the project keeps human decisions from agents
 * (`enforcement.forbidAgentApprovals`) and the guard is on (a person who set `off` has switched it off).
 */
export function guardBindsSession(config, agent) {
    return agent !== undefined && config.enforcement.forbidAgentApprovals && config.enforcement.mode !== 'off';
}
/** Refuses a setup request that weakens the guard inside an agent session (`agent_cannot_weaken_guard`). */
export function assertKeepsGuard(config, request, session) {
    if (!guardBindsSession(config, session.agent))
        return;
    const weakenings = guardWeakenings(guardSettings(config, session.knownTools), request);
    if (weakenings.length === 0)
        return;
    throw new SdlcError('agent_cannot_weaken_guard', { key: 'error.agent_cannot_weaken_guard', params: { agent: session.agent ?? '', changes: weakenings.join('; ') } }, session.fix);
}
