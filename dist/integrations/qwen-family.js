import { generatedNotice } from '../core/license.js';
import { agentNames, roleBody, subagentName } from '../team/render.js';
import { AGENT_IDS, loadAgent, loadWorkflow, WORKFLOW_IDS } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import { skillFile } from './skills.js';
import { stageResources, stageSection } from './stage-resources.js';
function agentFile(family, agent, body, notice) {
    const lines = ['---', `name: ${agent.name}`, `description: ${yamlString(agent.description)}`];
    if (agent.readonly)
        lines.push('disallowedTools: [write_file, edit]');
    lines.push('---', '', body);
    return {
        path: `${family.dir}/agents/${agent.name}.md`,
        content: appendNotice(lines.join('\n'), notice),
        tool: family.id,
        kind: 'agent',
    };
}
function agents(family, ctx, notice) {
    const team = ctx.team ?? [];
    const names = new Set(team.map(subagentName));
    const files = [];
    for (const id of AGENT_IDS) {
        const agent = loadAgent(id);
        if (names.has(agent.name))
            continue;
        const body = renderBody(agent.body, { surface: 'qwen-agent', cli: ctx.cli });
        files.push(agentFile(family, agent, body, notice));
    }
    for (const role of team) {
        const agent = {
            name: subagentName(role),
            description: role.description,
            readonly: role.readonly,
        };
        files.push(agentFile(family, agent, roleBody(role, ctx), notice));
    }
    return files;
}
function thinCommandBody(family, id, ctx) {
    const root = `${family.dir}/skills/sdlc-${id}/SKILL.md`;
    return [
        `Run the \`sdlc-${id}\` skill (\`${root}\`): read it and follow it step by step.`,
        'Apply it to the text after this command; if there is none, ask.',
        `If the skill is missing, run \`${ctx.cli} update\` and stop.`,
    ].join('\n');
}
function fullCommandBody(id, ctx) {
    const wf = loadWorkflow(id);
    const body = renderBody(wf.body, {
        surface: 'qwen-command',
        cli: ctx.cli,
        agents: agentNames(ctx.team),
    });
    return body + stageSection(stageResources(ctx.config, id, ctx.team));
}
function command(family, id, ctx, notice) {
    const wf = loadWorkflow(id);
    const body = ctx.delivery === 'commands'
        ? fullCommandBody(id, ctx)
        : thinCommandBody(family, id, ctx);
    const content = appendNotice([`# /sdlc-${id}`, '', wf.commandDescription, '', body].join('\n'), notice);
    return {
        path: `${family.dir}/commands/sdlc-${id}.md`,
        content,
        tool: family.id,
        kind: 'command',
    };
}
function skillTarget(family, ctx) {
    return {
        root: `${family.dir}/skills`,
        surface: 'qwen-skill',
        tool: family.id,
        extra: () => ({ head: [], tail: [] }),
        compatibility: `Requires the sdlc CLI (${ctx.cli}) from the sdlc package; written for ${family.name}.`,
    };
}
function generatedFiles(family, ctx) {
    const notice = generatedNotice(ctx.stamp, 'markdown');
    const files = [];
    const target = skillTarget(family, ctx);
    if (ctx.delivery !== 'commands') {
        files.push(...WORKFLOW_IDS.map((id) => skillFile(id, ctx, target)));
    }
    if (ctx.delivery !== 'skills') {
        files.push(...WORKFLOW_IDS.map((id) => command(family, id, ctx, notice)));
    }
    files.push(...agents(family, ctx, notice));
    return files;
}
function adapter(family) {
    return {
        id: family.id,
        name: family.name,
        detectPaths: [family.dir],
        invocation: (workflow) => `/sdlc-${workflow}`,
        render: (ctx) => generatedFiles(family, ctx),
    };
}
export const qwenAdapter = adapter({
    id: 'qwen',
    name: 'Qwen Code',
    dir: '.qwen',
});
export const gigacodeAdapter = adapter({
    id: 'gigacode',
    name: 'GigaCode (experimental)',
    dir: '.gigacode',
});
