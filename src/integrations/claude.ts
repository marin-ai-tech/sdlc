import { generatedNotice } from '../core/license.js';
import { agentNames, roleBody, subagentName } from '../team/render.js';
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

/** A subagent file `.claude/agents/<name>.md`: name, description and Claude tool names in the front matter. */
function agentFile(agent: { name: string; description: string; tools: string[] }, body: string, notice: string) {
  const tools = agent.tools.map((t) => CLAUDE_TOOL_NAMES[t] ?? t).join(', ');
  const content = appendNotice([
    '---',
    `name: ${agent.name}`,
    `description: ${yamlString(agent.description)}`,
    `tools: ${tools}`,
    '---',
    '',
    body,
  ].join('\n'), notice);
  return { path: `.claude/agents/${agent.name}.md`, content, tool: 'claude' as const, kind: 'agent' as const };
}

/**
 * The subagents: the built-in ones, then one per accepted role of the team (B70). A role named like a built-in
 * subagent (`sdlc-reviewer`) takes its file; the others (`sdlc-verifier`) stay as aliases.
 */
function agentFiles(ctx: RenderContext, notice: string): GeneratedFile[] {
  const team = ctx.team ?? [];
  const names = new Set(team.map(subagentName));
  const files: GeneratedFile[] = [];
  for (const id of AGENT_IDS) {
    const agent = loadAgent(id);
    if (names.has(agent.name)) continue;
    files.push(agentFile(agent, renderBody(agent.body, { surface: 'claude-agent', cli: ctx.cli }), notice));
  }
  for (const role of team) {
    const agent = { name: subagentName(role), description: role.description, tools: role.tools };
    files.push(agentFile(agent, roleBody(role, ctx), notice));
  }
  return files;
}

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
    const agents = agentNames(ctx.team);
    if (ctx.delivery !== 'skills') {
      for (const id of WORKFLOW_IDS) {
        const wf = loadWorkflow(id);
        const resources = stageResources(ctx.config, id, ctx.team);
        const content = appendNotice([
          '---',
          `description: ${yamlString(wf.commandDescription)}`,
          ...(wf.argumentHint ? [`argument-hint: ${yamlString(wf.argumentHint)}`] : []),
          `allowed-tools: ${stageAllowedTools(allowedToolsFor(ctx.cli), resources)}`,
          '---',
          '',
          renderBody(wf.body, { surface: 'claude-command', cli: ctx.cli, agents }) + stageSection(resources),
        ].join('\n'), notice);
        files.push({ path: `.claude/commands/sdlc/${id}.md`, content, tool: 'claude', kind: 'command' });
      }
    }
    files.push(...agentFiles(ctx, notice));
    return files;
  },
};
