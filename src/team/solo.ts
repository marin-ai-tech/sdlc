import { generatedNotice } from '../core/license.js';
import { appendNotice, yamlString } from '../integrations/render.js';
import { teamSkillRoots } from '../integrations/skills.js';
import type { GeneratedFile, RenderContext } from '../integrations/types.js';
import { parseRoleFile } from './role-file.js';
import { roleBody } from './render.js';
import { BUILTIN_ROLE_IDS, builtinRoleText, teamLocale } from './sources.js';

import type { ExecutionRole } from './execution-role.js';
export { roleForWorkflow, type ExecutionRole } from './execution-role.js';

function soloSkill(role: ExecutionRole, root: string, ctx: RenderContext): GeneratedFile {
  const text = builtinRoleText(role, teamLocale(ctx.config))!;
  const parsed = parseRoleFile(role, text);
  const content = appendNotice([
    '---',
    `name: sdlc-role-${role}`,
    `description: ${yamlString(parsed.description)}`,
    '---', '',
    `Active execution role: ${role}. Use this bundled skill for one role at a time.`,
    'This is execution guidance. It grants no human authority or registry trust.',
    'Human signing roles, approval separation and project commit rules still apply.', '',
    roleBody(parsed, ctx),
  ].join('\n'), generatedNotice(ctx.stamp, 'markdown'));
  return { path: `${root}/sdlc-role-${role}/SKILL.md`, content, tool: 'shared', kind: 'skill' };
}

/** Bundled instructions require no third-party acceptance and use normal generated-file ownership. */
export function renderSoloSkills(ctx: RenderContext): GeneratedFile[] {
  if (ctx.config.team?.mode !== 'solo') return [];
  return teamSkillRoots(ctx.tools).flatMap((root) => BUILTIN_ROLE_IDS.map((role) => soloSkill(role, root, ctx)));
}
