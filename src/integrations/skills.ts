import { generatedNotice, LICENSE_SUMMARY, LICENSOR } from '../core/license.js';
import { loadWorkflow, WORKFLOW_IDS, type WorkflowId, type WorkflowTemplate } from './assets.js';
import { appendNotice, renderBody, yamlString, type Surface } from './render.js';
import { stageAllowedTools, stageResources, stageSection, type StageResources } from './stage-resources.js';
import type { GeneratedFile, RenderContext, ToolId } from './types.js';
import { agentNames } from '../team/render.js';

/**
 * Skills follow the Agent Skills format and are written ONCE per project.
 *
 * OpenCode reads `.claude/skills/**` in addition to `.opencode/skills/**`, and
 * a skill name found in two places produces a "duplicate skill name" warning
 * with a nondeterministic winner. So when Claude Code is installed the skills
 * go to `.claude/skills/` only (both tools load them); `.opencode/skills/` is
 * used only for OpenCode-only projects.
 */
export function skillsRoot(tools: ToolId[]): string | undefined {
  if (tools.includes('claude')) return '.claude/skills';
  if (tools.includes('opencode')) return '.opencode/skills';
  return undefined;
}

export function allowedToolsFor(cli: string): string {
  return `Bash(${cli} *)`;
}

/** How one tool writes a skill: its folder, the surface its body is rendered for, and its front matter. */
export interface SkillTarget {
  root: string;
  surface: Surface;
  tool: GeneratedFile['tool'];
  /** Extra front matter lines: `head` after `description`, `tail` after `compatibility`. */
  extra: (wf: WorkflowTemplate, ctx: RenderContext, resources: StageResources | undefined) => SkillExtra;
  compatibility: string;
}

export interface SkillExtra {
  head: string[];
  tail: string[];
}

/** One workflow as a skill `<root>/sdlc-<id>/SKILL.md` (Agent Skills format). */
export function skillFile(id: WorkflowId, ctx: RenderContext, target: SkillTarget): GeneratedFile {
  const wf = loadWorkflow(id);
  const name = `sdlc-${id}`;
  const resources = stageResources(ctx.config, id, ctx.team);
  const body = renderBody(wf.body, { surface: target.surface, cli: ctx.cli, agents: agentNames(ctx.team) });
  const extra = target.extra(wf, ctx, resources);
  const content = appendNotice([
    '---',
    `name: ${name}`,
    `description: ${yamlString(wf.description)}`,
    ...extra.head,
    `license: ${yamlString(LICENSE_SUMMARY)}`,
    `compatibility: ${yamlString(target.compatibility)}`,
    ...extra.tail,
    'metadata:',
    `  author: ${yamlString(LICENSOR)}`,
    '  version: "1"',
    `  generatedBy: "sdlc ${ctx.version}"`,
    '---',
    '',
    body + stageSection(resources),
  ].join('\n'), generatedNotice(ctx.stamp, 'markdown'));
  return { path: `${target.root}/${name}/SKILL.md`, content, tool: target.tool, kind: 'skill' };
}

/** The Claude Code and OpenCode skill lines: `when_to_use`, then the pre-allowed tools of the stage. */
function sharedExtra(wf: WorkflowTemplate, ctx: RenderContext, resources: StageResources | undefined): SkillExtra {
  return {
    head: wf.whenToUse ? [`when_to_use: ${yamlString(wf.whenToUse)}`] : [],
    tail: [`allowed-tools: ${stageAllowedTools(allowedToolsFor(ctx.cli), resources)}`],
  };
}

export function renderSkills(ctx: RenderContext): GeneratedFile[] {
  if (ctx.delivery === 'commands') return [];
  const root = skillsRoot(ctx.tools);
  if (!root) return [];
  const compatibility = `Requires the sdlc CLI (${ctx.cli}) from the sdlc package; works in Claude Code and OpenCode.`;
  const target: SkillTarget = { root, surface: 'skill', tool: 'shared', extra: sharedExtra, compatibility };
  return WORKFLOW_IDS.map((id) => skillFile(id, ctx, target));
}
