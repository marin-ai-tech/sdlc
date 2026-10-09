import { generatedNotice } from '../core/license.js';
import { HUMAN_COMMANDS } from '../core/help-catalog.js';
import type { RoleFile } from '../team/role-file.js';
import { roleBody, subagentName } from '../team/render.js';
import { AGENT_IDS, loadAgent, WORKFLOW_IDS } from './assets.js';
import { renderBody } from './render.js';
import { skillFile, type SkillExtra, type SkillTarget } from './skills.js';
import type { GeneratedFile, RenderContext, ToolAdapter } from './types.js';

/**
 * Codex CLI integration (B82, 0.14.0):
 * - skills `.agents/skills/sdlc-<id>/SKILL.md` (Agent Skills format, rendered for Codex); in Codex the skills are the
 *   commands (`$sdlc-<id>`), so they are written whatever `delivery` says;
 * - subagents `.codex/agents/sdlc-<agent>.toml` (`name`, `description`, `developer_instructions`);
 * - command rules `.codex/rules/sdlc.rules`: a person's commands (HUMAN_COMMANDS) are `forbidden` for the agent.
 * The hooks (`.codex/hooks.json`, see codex-hooks.ts) and the MCP servers (`.codex/config.toml`, see codex-toml.ts)
 * are merged into files a person may share, so they are not generated files of the manifest.
 */
const SKILLS_ROOT = '.agents/skills';
export const CODEX_RULES_PATH = '.codex/rules/sdlc.rules';
const SEPARATION = "a person's decision; see `sdlc guide denials#separation-of-duties`";

function codexExtra(): SkillExtra {
  return { head: [], tail: [] };
}

function skillTarget(ctx: RenderContext): SkillTarget {
  const compatibility = `Requires the sdlc CLI (${ctx.cli}) from the sdlc package; written for Codex CLI.`;
  return { root: SKILLS_ROOT, surface: 'codex-skill', tool: 'codex', extra: codexExtra, compatibility };
}

/** A TOML basic string: JSON's escapes (`\"`, `\\`, `\n`, `\uXXXX`) are TOML's too. */
export function tomlString(value: string): string {
  return JSON.stringify(value);
}

interface CodexAgent {
  name: string;
  description: string;
  readonly: boolean;
}

/** A subagent `.codex/agents/<name>.toml`; a read-only one runs in Codex's read-only sandbox. */
function agentFile(agent: CodexAgent, body: string, notice: string): GeneratedFile {
  const lines = [
    notice,
    `name = ${tomlString(agent.name)}`,
    `description = ${tomlString(agent.description)}`,
    ...(agent.readonly ? ['sandbox_mode = "read-only"'] : []),
    `developer_instructions = ${tomlString(body.trimEnd())}`,
  ];
  return { path: `.codex/agents/${agent.name}.toml`, content: `${lines.join('\n')}\n`, tool: 'codex', kind: 'agent' };
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
    const body = renderBody(agent.body, { surface: 'codex-agent', cli: ctx.cli });
    files.push(agentFile(agent, body, notice));
  }
  for (const role of team) files.push(roleAgent(role, ctx, notice));
  return files;
}

/** The words of a person's command as Codex matches them: `config.cli`'s words, then the command's. */
export function humanCommandPatterns(cli: string): string[][] {
  const prefix = cli.trim().split(/\s+/);
  return HUMAN_COMMANDS.map((command) => [...prefix, ...command.split(' ')]);
}

function prefixRule(words: string[]): string {
  return [
    'prefix_rule(',
    `    pattern = [${words.map(tomlString).join(', ')}],`,
    '    decision = "forbidden",',
    `    justification = ${tomlString(SEPARATION)},`,
    ')',
  ].join('\n');
}

/** `.codex/rules/sdlc.rules` (Starlark): every person's command is forbidden for the agent (most restrictive wins). */
function rulesFile(ctx: RenderContext, notice: string): GeneratedFile {
  const rules = humanCommandPatterns(ctx.cli).map(prefixRule);
  const content = [notice, "# A person's commands: Codex refuses them for the agent (sdlc, B82).", ...rules].join('\n');
  return { path: CODEX_RULES_PATH, content: `${content}\n`, tool: 'codex', kind: 'rule' };
}

export const codexAdapter: ToolAdapter = {
  id: 'codex',
  name: 'Codex CLI',
  detectPaths: ['.codex'],

  invocation(workflow: string): string {
    return `$sdlc-${workflow}`;
  },

  render(ctx: RenderContext): GeneratedFile[] {
    const notice = generatedNotice(ctx.stamp, 'yaml');
    const files = WORKFLOW_IDS.map((id) => skillFile(id, ctx, skillTarget(ctx)));
    files.push(...agentFiles(ctx, notice));
    files.push(rulesFile(ctx, notice));
    return files;
  },
};