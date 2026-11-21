/** Keep only skills recorded as installed, preserving each role's order. */
export function roleSkills(team, installed) {
    return team.map((role) => ({ ...role, skills: [...new Set(role.skills.filter((id) => installed.has(id)))] }));
}
/** Installed skills of roles that own a stage, in role and skill order. */
export function stageRoleSkills(team, stage) {
    return team.filter((role) => role.stages.includes(stage))
        .flatMap((role) => role.skills);
}
/** Instructions for tools without a subagent skills field. */
export function roleSkillInstructions(role, body) {
    if (role.skills.length === 0)
        return body;
    const names = role.skills.map((id) => `\`${id}\``).join(', ');
    return `${body.trimEnd()}\n\nSkills of this role: ${names}. Load them before you start.\n`;
}
