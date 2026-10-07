import type { SdlcConfig } from '../core/config.js';
import type { StageConfigId } from '../core/stage-config.js';
import type { RoleFile } from '../team/role-file.js';

/**
 * Stage resources in the generated workflows (B14). A workflow of a stage ends with the skills, subagents and MCP
 * servers of that stage, and nothing from other stages; the Claude Code skill and command pre-allow that stage's MCP
 * tools. Skills and subagents come from `stages.<stage>`, MCP servers from the registry's `stages` (one source).
 * A workflow without a stage, or a stage with nothing configured, renders exactly as before.
 */
const WORKFLOW_STAGE: Record<string, StageConfigId> = {
  explore: 'plan',
  intent: 'plan',
  spec: 'design',
  plan: 'build',
  build: 'build',
  verify: 'test',
  review: 'deploy',
  release: 'deploy',
  archive: 'maintain',
  triage: 'maintain',
};

export interface StageResources {
  stage: StageConfigId;
  skills: string[];
  agents: string[];
  /** Registry server names, in the registry's order. */
  servers: string[];
}

/** The subagents of a stage: the configured ones, then the accepted roles of the team for that stage (B70). */
function stageAgents(configured: string[], stage: StageConfigId, team: readonly RoleFile[]): string[] {
  const roles = team.filter((role) => role.stages.includes(stage)).map((role) => `sdlc-${role.id}`);
  return [...new Set([...configured, ...roles])];
}

/** The resources of a workflow's stage; undefined when the workflow has no stage or the stage has none. */
export function stageResources(
  config: SdlcConfig,
  workflow: string,
  team: readonly RoleFile[] = []
): StageResources | undefined {
  const stage = WORKFLOW_STAGE[workflow];
  if (!stage) return undefined;
  const own = config.stages[stage];
  const servers = (config.mcp?.servers ?? []).filter((s) => s.stages.includes(stage)).map((s) => s.name);
  const skills = own?.skills ?? [];
  const agents = stageAgents(own?.agents ?? [], stage, team);
  if (skills.length + agents.length + servers.length === 0) return undefined;
  return { stage, skills, agents, servers };
}

/** `allowed-tools` of a Claude Code skill or command: the CLI, then the stage's MCP tools. */
export function stageAllowedTools(base: string, resources: StageResources | undefined): string {
  const mcp = (resources?.servers ?? []).map((name) => `mcp__${name}__*`);
  return [base, ...mcp].join(', ');
}

function list(values: string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

/** The section appended to the workflow body; empty without resources. */
export function stageSection(resources: StageResources | undefined): string {
  if (!resources) return '';
  const lines = ['', `## Stage resources (${resources.stage})`, ''];
  if (resources.skills.length > 0) lines.push(`- Skills for this stage: ${list(resources.skills)}.`);
  if (resources.agents.length > 0) lines.push(`- Subagents for this stage: ${list(resources.agents)}.`);
  if (resources.servers.length > 0) {
    const servers = resources.servers.map((name) => `\`${name}\` (tools \`mcp__${name}__*\`)`).join(', ');
    lines.push(`- MCP servers for this stage: ${servers}.`);
  }
  lines.push('- Other skills, subagents and MCP servers of the project are not for this stage.');
  return `${lines.join('\n')}\n`;
}
