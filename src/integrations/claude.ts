import { generatedNotice } from '../core/license.js';
import { AGENT_IDS, loadAgent, loadWorkflow, WORKFLOW_IDS } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import { allowedToolsFor } from './skills.js';
import { stageAllowedTools, stageResources, stageSection } from './stage-resources.js';
import type { GeneratedFile, RenderContext, ToolAdapter } from './types.js';

const CLAUDE_TOOL_NAMES: Record<string, string> = {
  read: 'Read',
  grep: 'Grep',
  glob: 'Glob',
  bash: 'Bash',
  edit: 'Edit',
  write: 'Write',
};

/**
 * Claude Code integration:
 * - skills (shared, see skills.ts) invoked as `/sdlc-<id>` or automatically;
 * - namespaced commands `.claude/commands/sdlc/<id>.md` invoked as `/sdlc:<id>`
 *   (the same shape as OpenSpec's `/opsx:<id>`);
 * - subagents `.claude/agents/sdlc-<id>.md`;
 * - hooks merged into `.claude/settings.json` (see settings.ts).
 */
export const claudeAdapter: ToolAdapter = {
  id: 'claude',
  name: 'Claude Code',
  detectPaths: ['.claude', 'CLAUDE.md'],

  invocation(workflow: string, ctx: RenderContext): string {
    return ctx.delivery === 'skills' ? `/sdlc-${workflow}` : `/sdlc:${workflow}`;
  },

  render(ctx: RenderContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const notice = generatedNotice(ctx.stamp, 'markdown');
    if (ctx.delivery !== 'skills') {
      for (const id of WORKFLOW_IDS) {
        const wf = loadWorkflow(id);
        const resources = stageResources(ctx.config, id);
        const content = appendNotice([
          '---',
          `description: ${yamlString(wf.commandDescription)}`,
          ...(wf.argumentHint ? [`argument-hint: ${yamlString(wf.argumentHint)}`] : []),
          `allowed-tools: ${stageAllowedTools(allowedToolsFor(ctx.cli), resources)}`,
          '---',
          '',
          renderBody(wf.body, { surface: 'claude-command', cli: ctx.cli }) + stageSection(resources),
        ].join('\n'), notice);
        files.push({ path: `.claude/commands/sdlc/${id}.md`, content, tool: 'claude', kind: 'command' });
      }
    }
    for (const id of AGENT_IDS) {
      const agent = loadAgent(id);
      const tools = agent.tools.map((t) => CLAUDE_TOOL_NAMES[t] ?? t).join(', ');
      const content = appendNotice([
        '---',
        `name: ${agent.name}`,
        `description: ${yamlString(agent.description)}`,
        `tools: ${tools}`,
        '---',
        '',
        renderBody(agent.body, { surface: 'claude-agent', cli: ctx.cli }),
      ].join('\n'), notice);
      files.push({ path: `.claude/agents/${agent.name}.md`, content, tool: 'claude', kind: 'agent' });
    }
    return files;
  },
};
