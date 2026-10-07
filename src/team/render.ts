import { applyCliPrefix } from '../integrations/render.js';
import type { RenderContext } from '../integrations/types.js';
import { artifactsBlock } from './artifacts.js';
import { projectBlock } from './facts.js';
import type { RoleFile } from './role-file.js';
import { teamLocale } from './sources.js';

/**
 * Generation of the team's subagents (B70): each accepted role becomes `sdlc-<role>` for each tool, its body with
 * `{{artifacts}}` and `{{project}}` filled for this project. A role without a placeholder gets the block appended,
 * so every subagent knows where to write and what this project checks.
 */

/** Built-in subagents a role replaces in the workflows' text: the tester for the verifier, the reviewer for itself. */
const REPLACES: Record<string, string> = { tester: 'verifier', reviewer: 'reviewer' };

export function subagentName(role: Pick<RoleFile, 'id'>): string {
  return `sdlc-${role.id}`;
}

/** Built-in agent id -> the subagent the workflows name instead (`{{agent:<id>}}`), for the accepted roles. */
export function agentNames(team: readonly RoleFile[] | undefined): Record<string, string> {
  const names: Record<string, string> = {};
  for (const role of team ?? []) {
    const replaced = REPLACES[role.id];
    if (replaced) names[replaced] = subagentName(role);
  }
  return names;
}

/** True for a role that runs the project's checks in place of the built-in verifier. */
export function runsChecks(role: Pick<RoleFile, 'id'>): boolean {
  return REPLACES[role.id] === 'verifier';
}

function fill(body: string, placeholder: string, block: string): string {
  if (!body.includes(placeholder)) return `${body.trimEnd()}\n\n${block}\n`;
  return body.split(placeholder).join(`\n${block}\n`);
}

/** The subagent body of an accepted role: placeholders filled, `sdlc` commands in the project's CLI prefix. */
export function roleBody(role: RoleFile, ctx: RenderContext): string {
  const locale = teamLocale(ctx.config);
  const artifacts = artifactsBlock(role.stages, locale, 'sdlc');
  const withArtifacts = applyCliPrefix(fill(role.body, '{{artifacts}}', artifacts), ctx.cli);
  const project = ctx.root ? projectBlock({ root: ctx.root, config: ctx.config, stages: role.stages, locale }) : '';
  const out = project ? fill(withArtifacts, '{{project}}', project) : withArtifacts.split('{{project}}').join('');
  return `${out.replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
