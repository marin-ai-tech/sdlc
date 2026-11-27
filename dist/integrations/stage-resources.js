import { stageRoleSkills } from './role-skills.js';
import { roleForWorkflow } from '../team/solo.js';
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
const ROLE_STAGE = {
    analyst: 'plan', architect: 'design', developer: 'build', tester: 'test', reviewer: 'deploy',
};
/** The subagent the build workflow runs after the last task (B109). */
const SIMPLIFIER = 'sdlc-simplifier';
const SIMPLIFY_STEP = `- After the last task, run the \`${SIMPLIFIER}\` subagent on this change, before \`sdlc verify\`.`;
/** Only the build workflow gets the simplifier step, and only while `stages.build.simplify` is not false. */
function simplifies(config, workflow) {
    return workflow === 'build' && config.stages.build?.simplify !== false;
}
/** The accepted roles of the team for a stage. */
function stageRoles(stage, team) {
    return team.filter((role) => role.stages.includes(stage));
}
/** The subagent of a role. */
function roleAgentId(role) {
    return `sdlc-${role.id}`;
}
/**
 * Review F1, F2, F6: the roles that may be handed the stage work. A read-only role checks and never writes; a role
 * named like the simplifier runs only as the build's simplifier step.
 */
function writingRoleAgentIds(roles) {
    return roles
        .filter((role) => !role.readonly)
        .map(roleAgentId)
        .filter((agent) => agent !== SIMPLIFIER);
}
/** The subagents of a stage: the configured ones, then the accepted roles of the team for that stage (B70). */
function stageAgents(configured, roles) {
    return [...new Set([...configured, ...roles])];
}
/** Whom the hand-off line names: one subagent, or the one that fits each part of the work. */
function handOffTarget(agents) {
    if (agents.length === 1)
        return `the role subagent ${list(agents)}`;
    const names = agents.map((agent) => `\`${agent}\``);
    const last = names.pop();
    return `the role subagent that fits each part (${names.join(', ')} or ${last})`;
}
/**
 * In team mode, the main agent hands the stage work to the role subagents that may write, keeps the questions to
 * the person and the gate, or says in its final report why it did the work itself.
 */
function handOffStep(resources) {
    if (resources.executionRole || resources.roleAgents.length === 0)
        return [];
    return [
        `- Main agent: hand the stage work to ${handOffTarget(resources.roleAgents)}; you keep the questions to the`
            + ' person and the stop at the gate. If you do the work yourself, say in your final report why you did it'
            + ' yourself.',
    ];
}
/** The skills of a stage, without the solo execution role's: configured first, then the accepted roles' (B319). */
export function stageSkillIds(config, stage, team) {
    return [...new Set([...(config.stages[stage]?.skills ?? []), ...stageRoleSkills(team, stage)])];
}
/** The resources of a workflow's stage; undefined when the workflow has no stage or the stage has none. */
export function stageResources(config, workflow, team = []) {
    const executionRole = roleForWorkflow(config, workflow);
    const stage = WORKFLOW_STAGE[workflow] ?? (executionRole ? ROLE_STAGE[executionRole] : undefined);
    if (!stage)
        return undefined;
    const own = config.stages[stage];
    const servers = (config.mcp?.servers ?? [])
        .filter((s) => s.agents && s.stages.includes(stage))
        .map((s) => s.name);
    const configuredSkills = own?.skills ?? [];
    const fromRoles = stageRoleSkills(team, stage);
    const soloSkill = executionRole ? [`sdlc-role-${executionRole}`] : [];
    const skills = fromRoles.length > 0
        ? [...new Set([...configuredSkills, ...fromRoles, ...soloSkill])]
        : [...configuredSkills, ...soloSkill];
    const simplify = simplifies(config, workflow);
    const configured = [...(own?.agents ?? []), ...(simplify ? [SIMPLIFIER] : [])];
    const roles = stageRoles(stage, team);
    const agents = stageAgents(configured, roles.map(roleAgentId));
    const roleAgents = writingRoleAgentIds(roles);
    if (skills.length + agents.length + servers.length === 0)
        return undefined;
    const stageSkills = stageSkillIds(config, stage, team);
    const role = executionRole ? { executionRole } : {};
    return { stage, skills, stageSkills, agents, roleAgents, servers, simplify, ...role };
}
/** `allowed-tools` of a Claude Code skill or command: the CLI, then the stage's MCP tools. */
export function stageAllowedTools(base, resources) {
    const mcp = (resources?.servers ?? []).map((name) => `mcp__${name}__*`);
    return [base, ...mcp].join(', ');
}
function list(values) {
    return values.map((value) => `\`${value}\``).join(', ');
}
/**
 * B319: on a command that runs `!` lines (Claude Code, OpenCode), the stage's skill texts are printed into the
 * command itself; the skills it cannot print (the solo execution role's) are still loaded by name.
 */
function injectedStep(resources) {
    const rest = resources.skills.filter((skill) => !resources.stageSkills.includes(skill));
    return [
        "- First step, before any stage work: follow the stage's skills printed at the start of this command. Load the"
            + ` skills ${list(resources.stageSkills)} by name only when their text is missing there.`,
        ...(rest.length > 0 ? [`- Also load the skills ${list(rest)} by name.`] : []),
    ];
}
/**
 * B319, review F8: the head of a stage command that runs `!` lines; the texts of the stage's skills are printed
 * there when the command starts. Empty for a stage without skills.
 */
export function stageInjection(resources, cli) {
    if (!resources || resources.stageSkills.length === 0)
        return '';
    const command = `${cli} team skills --stage ${resources.stage}`;
    return [
        `## Skills of this stage (${resources.stage})`,
        '',
        `!\`${command}\``,
        `If the output above is missing, run \`${command}\`.`,
        '',
        '',
    ].join('\n');
}
/** The section appended to the workflow body; empty without resources. */
export function stageSection(resources, options = {}) {
    if (!resources)
        return '';
    const lines = ['', `## Stage resources (${resources.stage})`, ''];
    if (options.inject && resources.stageSkills.length > 0)
        lines.push(...injectedStep(resources));
    else if (resources.skills.length > 0) {
        lines.push(`- First step, before any stage work: load the skills ${list(resources.skills)} by name.`);
    }
    if (resources.executionRole) {
        lines.push(`- Active execution role: ${resources.executionRole}. Follow its bundled skill for this workflow.`);
        lines.push('- The execution role is guidance; human authority and project commit rules still apply.');
    }
    if (resources.skills.length > 0)
        lines.push(`- Skills for this stage: ${list(resources.skills)}.`);
    if (resources.skills.length > 0) {
        lines.push('- In your final report, name the skills loaded and explain why any listed skill could not be loaded.');
    }
    if (resources.agents.length > 0)
        lines.push(`- Subagents for this stage: ${list(resources.agents)}.`);
    lines.push(...handOffStep(resources));
    if (resources.simplify)
        lines.push(SIMPLIFY_STEP);
    if (resources.servers.length > 0) {
        const servers = resources.servers.map((name) => `\`${name}\` (tools \`mcp__${name}__*\`)`).join(', ');
        lines.push(`- MCP servers for this stage: ${servers}.`);
    }
    lines.push('- Other skills, subagents and MCP servers of the project are not for this stage.');
    return `${lines.join('\n')}\n`;
}
