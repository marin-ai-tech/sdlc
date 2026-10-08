import { generatedNotice } from '../core/license.js';
import type { RoleFile } from '../team/role-file.js';
import { agentNames, roleBody, subagentName } from '../team/render.js';
import { AGENT_IDS, loadAgent, loadWorkflow, WORKFLOW_IDS, type WorkflowId } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import { skillFile, type SkillExtra, type SkillTarget } from './skills.js';
import { stageResources, stageSection } from './stage-resources.js';
import type { GeneratedFile, RenderContext, ToolAdapter } from './types.js';

/**
 * Cursor integration (B80, 0.13.0), everything under `.cursor/`:
 * - skills `.cursor/skills/sdlc-<id>/SKILL.md` (Agent Skills format, rendered for Cursor);
 * - thin commands `.cursor/commands/sdlc-<id>.md` (the file name is the slash name `/sdlc-<id>`) that run the skill;
 *   with `delivery: commands` there are no skills, so each command carries the whole workflow instead, and with
 *   `delivery: skills` there are no commands;
 * - subagents `.cursor/agents/sdlc-<agent>.md` (`model: inherit`, `readonly` from the asset or the role);
 * - one rule `.cursor/rules/sdlc.mdc` that is always applied.
 * The hooks (`.cursor/hooks.json`, see cursor-hooks.ts) and the MCP entry (`.cursor/mcp.json`, see mcp-config.ts)
 * are merged into files a person may share, so they are not generated files of the manifest.
 */
const SKILLS_ROOT = '.cursor/skills';
export const CURSOR_RULE_PATH = '.cursor/rules/sdlc.mdc';

function cursorExtra(): SkillExtra {
  return { head: [], tail: [] };
}

function skillTarget(ctx: RenderContext): SkillTarget {
  const compatibility = `Requires the sdlc CLI (${ctx.cli}) from the sdlc package; written for Cursor.`;
  return { root: SKILLS_ROOT, surface: 'cursor-skill', tool: 'cursor', extra: cursorExtra, compatibility };
}

/** A thin command: it names the skill and hands it the text typed after the command. */
function thinCommandBody(id: WorkflowId, ctx: RenderContext): string {
  const skill = `sdlc-${id}`;
  return [
    `Run the \`${skill}\` skill (\`${SKILLS_ROOT}/${skill}/SKILL.md\`): read it and follow it step by step.`,
    'Apply it to the text after this command (a change id, or a description of the work); if there is none, ask.',
    `If the skill is missing, run \`${ctx.cli} update\` and stop.`,
  ].join('\n');
}

/** The whole workflow as a command, for `delivery: commands` (no skills are written then). */
function fullCommandBody(id: WorkflowId, ctx: RenderContext): string {
  const wf = loadWorkflow(id);
  const section = stageSection(stageResources(ctx.config, id, ctx.team));
  const body = renderBody(wf.body, { surface: 'cursor-command', cli: ctx.cli, agents: agentNames(ctx.team) });
  return body + section;
}

function commandFile(id: WorkflowId, ctx: RenderContext, notice: string): GeneratedFile {
  const wf = loadWorkflow(id);
  const body = ctx.delivery === 'commands' ? fullCommandBody(id, ctx) : thinCommandBody(id, ctx);
  const content = appendNotice([`# /sdlc-${id}`, '', wf.commandDescription, '', body].join('\n'), notice);
  return { path: `.cursor/commands/sdlc-${id}.md`, content, tool: 'cursor', kind: 'command' };
}

interface CursorAgent {
  name: string;
  description: string;
  readonly: boolean;
}

/** A subagent `.cursor/agents/<name>.md`: name, description, the parent's model, read-only or not. */
function agentFile(agent: CursorAgent, body: string, notice: string): GeneratedFile {
  const content = appendNotice([
    '---',
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    'model: inherit',
    `readonly: ${agent.readonly ? 'true' : 'false'}`,
    '---',
    '',
    body,
  ].join('\n'), notice);
  return { path: `.cursor/agents/${agent.name}.md`, content, tool: 'cursor', kind: 'agent' };
}

function roleAgent(role: RoleFile, ctx: RenderContext, notice: string): GeneratedFile {
  const agent = { name: subagentName(role), description: role.description, readonly: role.readonly };
  return agentFile(agent, roleBody(role, ctx), notice);
}

/** The built-in subagents, then one per accepted role (B70); a role named like a built-in one takes its file. */
function agentFiles(ctx: RenderContext, notice: string): GeneratedFile[] {
  const team = ctx.team ?? [];
  const names = new Set(team.map(subagentName));
  const files: GeneratedFile[] = [];
  for (const id of AGENT_IDS) {
    const agent = loadAgent(id);
    if (names.has(agent.name)) continue;
    const body = renderBody(agent.body, { surface: 'cursor-agent', cli: ctx.cli });
    files.push(agentFile(agent, body, notice));
  }
  for (const role of team) files.push(roleAgent(role, ctx, notice));
  return files;
}

/** The rule every Cursor agent reads: this project follows sdlc and its gates belong to people. */
function ruleFile(ctx: RenderContext, notice: string): GeneratedFile {
  const content = appendNotice([
    '---',
    'description: This project follows the sdlc process; its gates are decisions of people.',
    'globs:',
    'alwaysApply: true',
    '---',
    '',
    'This project follows sdlc (spec-driven development on OpenSpec).',
    '- The gates (approving an intent, a spec, a plan, a release) are decisions of people: never take them,',
    '  never run the approval commands for a person, never edit what records them.',
    `- Not sure how something works here? Ask \`${ctx.cli} guide\`.`,
    `- Before you start and after each step, run \`${ctx.cli} next\` and do what it says.`,
    '- The workflows are the `/sdlc-<workflow>` commands and the `sdlc-<workflow>` skills.',
  ].join('\n'), notice);
  return { path: CURSOR_RULE_PATH, content, tool: 'cursor', kind: 'rule' };
}

export const cursorAdapter: ToolAdapter = {
  id: 'cursor',
  name: 'Cursor',
  detectPaths: ['.cursor'],

  invocation(workflow: string): string {
    return `/sdlc-${workflow}`;
  },

  render(ctx: RenderContext): GeneratedFile[] {
    const notice = generatedNotice(ctx.stamp, 'markdown');
    const files: GeneratedFile[] = [];
    if (ctx.delivery !== 'commands') files.push(...WORKFLOW_IDS.map((id) => skillFile(id, ctx, skillTarget(ctx))));
    // With skills-only delivery the skills are the workflows, as for the other tools.
    if (ctx.delivery !== 'skills') files.push(...WORKFLOW_IDS.map((id) => commandFile(id, ctx, notice)));
    files.push(...agentFiles(ctx, notice));
    files.push(ruleFile(ctx, notice));
    return files;
  },
};
