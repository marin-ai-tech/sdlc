import { generatedNotice } from '../core/license.js';
import { AGENT_IDS, loadAgent, loadWorkflow, readAsset, WORKFLOW_IDS } from './assets.js';
import { appendNotice, renderBody, yamlString } from './render.js';
import type { GeneratedFile, RenderContext, ToolAdapter } from './types.js';

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
    if (ctx.delivery !== 'skills') {
      // With skills-only delivery OpenCode exposes each skill as `/sdlc-<id>` itself.
      for (const id of WORKFLOW_IDS) {
        const wf = loadWorkflow(id);
        const content = appendNotice([
          '---',
          `description: ${yamlString(wf.commandDescription)}`,
          '---',
          '',
          renderBody(wf.body, { surface: 'opencode-command', cli: ctx.cli }),
        ].join('\n'), notice);
        files.push({ path: `.opencode/commands/sdlc-${id}.md`, content, tool: 'opencode', kind: 'command' });
      }
    }
    for (const id of AGENT_IDS) {
      const agent = loadAgent(id);
      const cli = ctx.cli;
      const permission = agent.readonly
        ? id === 'verifier'
          ? ['permission:', '  edit: deny', '  bash: allow', '  webfetch: deny']
          : [
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
            ]
        : ['permission:', '  edit: allow', '  bash: allow', '  webfetch: deny'];
      const content = appendNotice([
        '---',
        `description: ${yamlString(agent.description)}`,
        'mode: subagent',
        ...permission,
        '---',
        '',
        renderBody(agent.body, { surface: 'opencode-agent', cli }),
      ].join('\n'), notice);
      files.push({ path: `.opencode/agents/${agent.name}.md`, content, tool: 'opencode', kind: 'agent' });
    }
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
