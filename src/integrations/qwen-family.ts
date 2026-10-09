import { generatedNotice } from '../core/license.js';
import type { RoleFile } from '../team/role-file.js';
import { agentNames, roleBody, subagentName } from '../team/render.js';
import { AGENT_IDS, loadAgent, loadWorkflow, WORKFLOW_IDS, type WorkflowId } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import { skillFile, type SkillTarget } from './skills.js';
import { stageResources, stageSection } from './stage-resources.js';
import type { GeneratedFile, RenderContext, ToolAdapter } from './types.js';

/**
 * Qwen Code and GigaCode integration (B83, 0.14.1): workflow skills, commands and subagents are generated under
 * `.qwen/` or `.gigacode/` and owned by sdlc's manifest. Delivery controls whether skills, commands or both are
 * written. Hooks and deny rules are merged into each tool's settings by qwen-settings.ts; MCP is merged separately.
 */
interface Family {
  id: 'qwen' | 'gigacode';
  name: string;
  dir: string;
}

interface FamilyAgent {
  name: string;
  description: string;
  readonly: boolean;
}

function agentFile(family: Family, agent: FamilyAgent, body: string, notice: string): GeneratedFile {
  const lines = ['---', `name: ${agent.name}`, `description: ${yamlString(agent.description)}`];
  if (agent.readonly) lines.push('disallowedTools: [write_file, edit]');
  lines.push('---', '', body);
  return {
    path: `${family.dir}/agents/${agent.name}.md`,
    content: appendNotice(lines.join('\n'), notice),
    tool: family.id,
    kind: 'agent',
  };
}

function agents(family: Family, ctx: RenderContext, notice: string): GeneratedFile[] {
  const team = ctx.team ?? [];
  const names = new Set(team.map(subagentName));
  const files: GeneratedFile[] = [];
  for (const id of AGENT_IDS) {
    const agent = loadAgent(id);
    if (names.has(agent.name)) continue;
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

function thinCommandBody(family: Family, id: WorkflowId, ctx: RenderContext): string {
  const root = `${family.dir}/skills/sdlc-${id}/SKILL.md`;
  return [
    `Run the \`sdlc-${id}\` skill (\`${root}\`): read it and follow it step by step.`,
    'Apply it to the text after this command; if there is none, ask.',
    `If the skill is missing, run \`${ctx.cli} update\` and stop.`,
  ].join('\n');
}

function fullCommandBody(id: WorkflowId, ctx: RenderContext): string {
  const wf = loadWorkflow(id);
  const body = renderBody(wf.body, {
    surface: 'qwen-command',
    cli: ctx.cli,
    agents: agentNames(ctx.team),
  });
  return body + stageSection(stageResources(ctx.config, id, ctx.team));
}

function command(family: Family, id: WorkflowId, ctx: RenderContext, notice: string): GeneratedFile {
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

function skillTarget(family: Family, ctx: RenderContext): SkillTarget {
  return {
    root: `${family.dir}/skills`,
    surface: 'qwen-skill',
    tool: family.id,
    extra: () => ({ head: [], tail: [] }),
    compatibility: `Requires the sdlc CLI (${ctx.cli}) from the sdlc package; written for ${family.name}.`,
  };
}

function generatedFiles(family: Family, ctx: RenderContext): GeneratedFile[] {
  const notice = generatedNotice(ctx.stamp, 'markdown');
  const files: GeneratedFile[] = [];
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

function adapter(family: Family): ToolAdapter {
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
