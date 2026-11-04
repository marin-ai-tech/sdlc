import type { RoleFile } from '../team/role-file.js';
import type { StageConfigId } from '../core/stage-config.js';

/** Keep only skills recorded as installed, preserving each role's order. */
export function roleSkills(team: readonly RoleFile[], installed: ReadonlySet<string>): RoleFile[] {
  return team.map((role) => ({ ...role, skills: [...new Set(role.skills.filter((id) => installed.has(id)))] }));
}

/** Installed skills of roles that own a stage, in role and skill order. */
export function stageRoleSkills(team: readonly RoleFile[], stage: StageConfigId): string[] {
  return team.filter((role) => role.stages.includes(stage))
    .flatMap((role) => role.skills);
}

/** Instructions for tools without a subagent skills field. */
export function roleSkillInstructions(role: RoleFile, body: string): string {
  if (role.skills.length === 0) return body;
  const names = role.skills.map((id) => `\`${id}\``).join(', ');
  return `${body.trimEnd()}\n\nSkills of this role: ${names}. Load them before you start.\n`;
}
