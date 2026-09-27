import { generatedNotice, LICENSE_SUMMARY, LICENSOR } from '../core/license.js';
import { loadWorkflow, WORKFLOW_IDS } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import type { GeneratedFile, RenderContext, ToolId } from './types.js';

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

export function renderSkills(ctx: RenderContext): GeneratedFile[] {
  if (ctx.delivery === 'commands') return [];
  const root = skillsRoot(ctx.tools);
  if (!root) return [];
  return WORKFLOW_IDS.map((id) => {
    const wf = loadWorkflow(id);
    const name = `sdlc-${id}`;
    const content = appendNotice([
      '---',
      `name: ${name}`,
      `description: ${yamlString(wf.description)}`,
      `license: ${yamlString(LICENSE_SUMMARY)}`,
      `compatibility: ${yamlString(`Requires the sdlc CLI (${ctx.cli}) from the scdl package; works in Claude Code and OpenCode.`)}`,
      `allowed-tools: ${allowedToolsFor(ctx.cli)}`,
      'metadata:',
      `  author: ${yamlString(LICENSOR)}`,
      '  version: "1"',
      `  generatedBy: "scdl ${ctx.version}"`,
      '---',
      '',
      renderBody(wf.body, { surface: 'skill', cli: ctx.cli }),
    ].join('\n'), generatedNotice(ctx.stamp, 'markdown'));
    return { path: `${root}/${name}/SKILL.md`, content, tool: 'shared' as const, kind: 'skill' as const };
  });
}
