/**
 * Stage resources in the generated workflows (B14, B97). A workflow of a stage ends with the skills, subagents and MCP
 * servers of that stage, and nothing from other stages; the Claude Code skill and command pre-allow that stage's MCP
 * tools. Skills and subagents come from `stages.<stage>`, MCP servers from the registry's `stages` (one source).
 * CLI-only servers (`agents: false`) are omitted from these agent-facing lists.
 * A workflow without a stage, or a stage with nothing configured, renders exactly as before.
 * The build workflow also runs the `sdlc-simplifier` subagent after the last task and before `sdlc verify` unless
 * `stages.build.simplify` is false (B109); other workflows of the build stage do not.
 */
const WORKFLOW_STAGE = {
    explore: 'plan',
    intent: 'plan',
    spec: 'design',
    plan: 'build',
    build: 'build',
    verify: 'test',
    review: 'deploy',
    release: 'deploy',
    archive: 'maintain',
    triage: 'maintain',
};
/** The subagent the build workflow runs after the last task (B109). */
const SIMPLIFIER = 'sdlc-simplifier';
const SIMPLIFY_STEP = `- After the last task, run the \`${SIMPLIFIER}\` subagent on this change, before \`sdlc verify\`.`;
/** Only the build workflow gets the simplifier step, and only while `stages.build.simplify` is not false. */
function simplifies(config, workflow) {
    return workflow === 'build' && config.stages.build?.simplify !== false;
}
/** The subagents of a stage: the configured ones, then the accepted roles of the team for that stage (B70). */
function stageAgents(configured, stage, team) {
    const roles = team.filter((role) => role.stages.includes(stage)).map((role) => `sdlc-${role.id}`);
    return [...new Set([...configured, ...roles])];
}
/** The resources of a workflow's stage; undefined when the workflow has no stage or the stage has none. */
export function stageResources(config, workflow, team = []) {
    const stage = WORKFLOW_STAGE[workflow];
    if (!stage)
        return undefined;
    const own = config.stages[stage];
    const servers = (config.mcp?.servers ?? [])
        .filter((s) => s.agents && s.stages.includes(stage))
        .map((s) => s.name);
    const skills = own?.skills ?? [];
    const simplify = simplifies(config, workflow);
    const configured = [...(own?.agents ?? []), ...(simplify ? [SIMPLIFIER] : [])];
    const agents = stageAgents(configured, stage, team);
    if (skills.length + agents.length + servers.length === 0)
        return undefined;
    return { stage, skills, agents, servers, simplify };
}
/** `allowed-tools` of a Claude Code skill or command: the CLI, then the stage's MCP tools. */
export function stageAllowedTools(base, resources) {
    const mcp = (resources?.servers ?? []).map((name) => `mcp__${name}__*`);
    return [base, ...mcp].join(', ');
}
function list(values) {
    return values.map((value) => `\`${value}\``).join(', ');
}
/** The section appended to the workflow body; empty without resources. */
export function stageSection(resources) {
    if (!resources)
        return '';
    const lines = ['', `## Stage resources (${resources.stage})`, ''];
    if (resources.skills.length > 0)
        lines.push(`- Skills for this stage: ${list(resources.skills)}.`);
    if (resources.agents.length > 0)
        lines.push(`- Subagents for this stage: ${list(resources.agents)}.`);
    if (resources.simplify)
        lines.push(SIMPLIFY_STEP);
    if (resources.servers.length > 0) {
        const servers = resources.servers.map((name) => `\`${name}\` (tools \`mcp__${name}__*\`)`).join(', ');
        lines.push(`- MCP servers for this stage: ${servers}.`);
    }
    lines.push('- Other skills, subagents and MCP servers of the project are not for this stage.');
    return `${lines.join('\n')}\n`;
}
