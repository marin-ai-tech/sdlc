import { generatedNotice } from '../core/license.js';
import type { RoleFile } from '../team/role-file.js';
import { agentNames, roleBody, runsChecks, subagentName } from '../team/render.js';
import { AGENT_IDS, loadAgent, loadWorkflow, readAsset, WORKFLOW_IDS } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import { stageResources, stageSection } from './stage-resources.js';
import type { GeneratedFile, RenderContext, ToolAdapter } from './types.js';

type Access = 'checks' | 'read' | 'write' | 'nobash';

/** The OpenCode `permission` map: a verifier runs any check, a reader runs read-only commands, a writer edits. */
function permission(access: Access, cli: string): string[] {
  if (access === 'checks') return ['permission:', '  edit: deny', '  bash: allow', '  webfetch: deny'];
  if (access === 'write') return ['permission:', '  edit: allow', '  bash: allow', '  webfetch: deny'];
  if (access === 'nobash') return ['permission:', '  edit: deny', '  bash: deny', '  webfetch: deny'];
  return [
    'permission:',
    '  edit: deny',
    '  webfetch: deny',
    '  bash:',
    '    "*": ask',
    '    "git *": allow',
    `    "${cli} *": allow`,
    '    "grep *": allow',
    '    "rg *": allow',
    '    "ls *": allow',
    '    "cat *": allow',
  ];
}

/** A role's access from its front matter: `readonly` and `tools`; the tester runs checks like the verifier. */
function roleAccess(role: RoleFile): Access {
  if (!role.readonly) return 'write';
  if (!role.tools.includes('bash')) return 'nobash';
  return runsChecks(role) ? 'checks' : 'read';
}

function agentFile(name: string, description: string, access: Access, body: string, ctx: RenderContext) {
  const content = appendNotice([
    '---',
    `description: ${yamlString(description)}`,
    'mode: subagent',
    ...permission(access, ctx.cli),
    '---',
    '',
    body,
  ].join('\n'), generatedNotice(ctx.stamp, 'markdown'));
  return { path: `.opencode/agents/${name}.md`, content, tool: 'opencode' as const, kind: 'agent' as const };
}

/** The built-in subagents, then one per accepted role (B70); a role named like a built-in one takes its file. */
function agentFiles(ctx: RenderContext): GeneratedFile[] {
  const team = ctx.team ?? [];
  const names = new Set(team.map(subagentName));
  const files: GeneratedFile[] = [];
  for (const id of AGENT_IDS) {
    const agent = loadAgent(id);
    if (names.has(agent.name)) continue;
    const access: Access = !agent.readonly ? 'write' : id === 'verifier' ? 'checks' : 'read';
    const body = renderBody(agent.body, { surface: 'opencode-agent', cli: ctx.cli });
    files.push(agentFile(agent.name, agent.description, access, body, ctx));
  }
  for (const role of team) {
    files.push(agentFile(subagentName(role), role.description, roleAccess(role), roleBody(role, ctx), ctx));
  }
  return files;
}

/**
 * OpenCode integration:
 * - commands `.opencode/commands/sdlc-<id>.md` invoked as `/sdlc-<id>`
 *   (frontmatter: description only - an `agent:` line breaks setups with
 *   custom agents, and arguments only arrive through `$ARGUMENTS`);
 * - skills come from `.claude/skills/` when Claude Code is also installed,
 *   otherwise from `.opencode/skills/` (see skills.ts);
 * - subagents `.opencode/agents/sdlc-<id>.md` with an OpenCode `permission`
 *   map (a Claude-style `tools:` string would stop OpenCode from starting);
 * - a plugin `.opencode/plugins/sdlc.js` bridging `tool.execute.before/after`,
 *   `shell.env` and the system prompt to the same `sdlc hook` engine the
 *   Claude Code hooks use.
 */
export const opencodeAdapter: ToolAdapter = {
  id: 'opencode',
  name: 'OpenCode',
  detectPaths: ['.opencode', 'opencode.json', 'opencode.jsonc', 'AGENTS.md'],

  invocation(workflow: string): string {
    return `/sdlc-${workflow}`;
  },

  render(ctx: RenderContext): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const notice = generatedNotice(ctx.stamp, 'markdown');
    const agents = agentNames(ctx.team);
    if (ctx.delivery !== 'skills') {
      // With skills-only delivery OpenCode exposes each skill as `/sdlc-<id>` itself.
      for (const id of WORKFLOW_IDS) {
        const wf = loadWorkflow(id);
        const section = stageSection(stageResources(ctx.config, id, ctx.team));
        const content = appendNotice([
          '---',
          `description: ${yamlString(wf.commandDescription)}`,
          '---',
          '',
          renderBody(wf.body, { surface: 'opencode-command', cli: ctx.cli, agents }) + section,
        ].join('\n'), notice);
        files.push({ path: `.opencode/commands/sdlc-${id}.md`, content, tool: 'opencode', kind: 'command' });
      }
    }
    files.push(...agentFiles(ctx));
    files.push({
      path: '.opencode/plugins/sdlc.js',
      content: readAsset('opencode', 'plugin.js')
        .replace('// __SDLC_NOTICE__', generatedNotice(ctx.stamp, 'js'))
        .replace('__SDLC_CLI__', JSON.stringify(ctx.cli.split(/\s+/)))
        .replace('__SDLC_VERSION__', ctx.version),
      tool: 'opencode',
      kind: 'plugin',
    });
    return files;
  },
};
