import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { t } from '../core/i18n.js';
import { DRAFTS_DIR } from '../team/record.js';
import { checkTeamSkills } from '../team/skill-check.js';
import { acceptSkill, installRoleSkills } from '../team/skills.js';
import { acceptRole, listTeam, syncTeam } from '../team/team.js';
import { assertHuman } from './gates.js';
function printPack(pack) {
    const source = pack.source;
    const at = source?.commit ? `${source.ref ?? ''} ${source.commit.slice(0, 12)}` : source?.version ?? '';
    const counts = { roles: pack.roles.length, skills: pack.skills.length };
    if (pack.error)
        line(t('team.sync.packError', { name: pack.name, error: pack.error }));
    else
        line(t('team.sync.pack', { name: pack.name, at: at.trim(), ...counts }));
    const spec = source?.npm ?? pack.name;
    if (pack.warning)
        line(`${t('label.warning')}: ${t('team.sync.packFloating', { name: pack.name, spec })}`);
}
function printSync(result) {
    const registry = result.registry;
    if (registry?.reachable)
        line(t('team.sync.registry', { server: registry.server, count: registry.roles.length }));
    if (registry && !registry.reachable) {
        line(t('team.sync.unreachable', { server: registry.server, error: registry.error ?? '' }));
    }
    for (const pack of result.packs ?? [])
        printPack(pack);
    for (const item of result.refused)
        line(t('team.sync.refused', { id: item.id, reason: item.reason }));
    for (const file of result.created)
        line(t('team.sync.created', { path: file }));
    for (const kept of result.kept)
        line(t(`team.sync.kept.${kept.reason}`, { id: kept.id }));
    if (result.created.length > 0)
        line(t('team.sync.next', { dir: DRAFTS_DIR }));
}
export async function teamSyncCommand(opts) {
    try {
        const ctx = loadProject();
        const result = await syncTeam(ctx.root, ctx.config);
        if (opts.json)
            return printJson(result);
        printSync(result);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function identity(root) {
    const who = formatIdentity(gitIdentity(root));
    if (who)
        return who;
    throw new SdlcError('no_identity', { key: 'error.cannot_tell_who_is_deciding_git_user_name_user_e' }, { key: 'fix.set_them_with_git_config_user_email_you_example_' });
}
function printSkills(skills) {
    for (const item of skills.installed)
        line(t('team.accept.skillInstalled', { ...item, path: item.dir }));
    for (const id of skills.unchanged)
        line(t('team.accept.skillUnchanged', { id }));
    for (const item of skills.needsAcceptance) {
        line(t('team.accept.skillNeedsAcceptance', { id: item.id, scripts: item.scripts.join(', ') }));
    }
    for (const item of skills.refused)
        line(t('team.accept.skillRefused', { id: item.id, reason: item.reason }));
    for (const item of skills.unavailable)
        line(t('team.accept.skillUnavailable', { id: item.id, reason: item.reason }));
}
async function acceptRoleWithSkills(role, opts) {
    const ctx = loadProject();
    assertHuman(ctx.config, 'team accept');
    const by = identity(ctx.root);
    const result = acceptRole(ctx.root, ctx.config, role, by);
    const skills = await installRoleSkills(ctx.root, ctx.config, result.skills, by);
    if (opts.json)
        return printJson({ ...result, skillStatus: skills });
    line(t('team.accept.done', { id: result.role, path: result.file, team: result.team, subagent: result.subagent }));
    if (result.changedFromSource) {
        line(t('team.accept.changed', { id: result.role }));
        line(result.diff.trimEnd());
    }
    printSkills(skills);
}
async function acceptSkillCommand(id, opts) {
    const ctx = loadProject();
    assertHuman(ctx.config, 'team accept');
    const result = await acceptSkill(ctx.root, ctx.config, id, identity(ctx.root));
    if (opts.json)
        return printJson(result);
    line(t('team.acceptSkill.done', { id: result.skill, version: result.version, path: result.dir, team: result.team }));
    if (result.scripts.length > 0)
        line(t('team.acceptSkill.scripts', { list: result.scripts.join(', ') }));
}
/** A person's command: refused in an agent session (`agent_cannot_approve`), like a gate decision. */
export async function teamAcceptCommand(role, opts) {
    try {
        if (opts.skill !== undefined)
            return await acceptSkillCommand(opts.skill, opts);
        if (role === undefined)
            throw new SdlcError('usage', { key: 'error.team_accept_what' });
        await acceptRoleWithSkills(role, opts);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function row(role) {
    return [role.id, role.title, role.stages.join(', '), t(`team.status.${role.status}`), role.subagent ?? '-'];
}
function printTable(roles) {
    if (roles.length === 0)
        return line(t('team.list.empty'));
    const header = ['id', 'team.list.colTitle', 'team.list.colStages', 'team.list.colStatus', 'team.list.colSubagent'];
    const rows = [header.map((key, index) => (index === 0 ? key : t(key)))];
    rows.push(...roles.map(row));
    const widths = rows[0].map((_cell, index) => Math.max(...rows.map((r) => r[index].length)));
    for (const cells of rows)
        line(cells.map((cell, index) => cell.padEnd(widths[index])).join('  ').trimEnd());
    for (const role of roles.filter((r) => r.status === 'changed'))
        line(t('team.list.changed', { id: role.id }));
}
export function teamListCommand(opts) {
    try {
        const ctx = loadProject();
        const roles = listTeam(ctx.root);
        if (opts.json)
            return printJson({ roles });
        printTable(roles);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function skillState(skill) {
    if (!skill.checksumOk)
        return t('team.check.notOk', { reason: skill.reason ?? '' });
    if (skill.installed)
        return t('team.check.installed');
    return skill.needsAcceptance ? t('team.check.needsAcceptance', { id: skill.id }) : t('team.check.notInstalled');
}
function printCheck(skills, warnings) {
    if (skills.length === 0)
        line(t('team.check.empty'));
    for (const skill of skills) {
        line(`${skill.id} ${skill.version ?? '?'} (${skill.source}): ${skillState(skill)}`);
        if (skill.scripts.length > 0)
            line(`  ${t('team.check.scripts', { list: skill.scripts.join(', ') })}`);
        if (skill.allowedTools.length > 0)
            line(`  allowed-tools: ${skill.allowedTools.join(' ')}`);
        if (skill.urls.length > 0)
            line(`  ${t('team.check.urls', { list: skill.urls.join(', ') })}`);
    }
    for (const warning of warnings)
        line(`${t('label.warning')}: ${warning}`);
}
/** `sdlc team check [--json]`: the skills of the team, what they may do, and whether they are still as checked. */
export async function teamCheckCommand(opts) {
    try {
        const ctx = loadProject();
        const result = await checkTeamSkills(ctx.root, ctx.config);
        if (opts.json)
            return printJson(result);
        printCheck(result.skills, result.warnings);
        if (result.error)
            line(t('team.check.registryError', { error: result.error }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
