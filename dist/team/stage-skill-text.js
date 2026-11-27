import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin, normalizeNewlines, readText } from '../core/fs-utils.js';
import { roleSkills } from '../integrations/role-skills.js';
import { stageSkillIds } from '../integrations/stage-resources.js';
import { acceptedRolesReport } from './accepted.js';
import { readTeam } from './record.js';
import { teamSkillFolders } from './skills.js';
/**
 * `sdlc team skills --stage <stage>` (B319): the SKILL.md texts of a stage's skills, for the stage commands of Claude
 * Code and OpenCode to inject. The list is the one the workflows name (configured skills, then the accepted roles'
 * installed skills). Each text comes from the project's skills folders, front matter dropped, under
 * `## Skill <name>`. A skill that is not there is named as missing; once the output would pass 48 KiB, each further
 * skill is named with "load it by name" instead. Read-only: the command writes nothing.
 */
export const STAGE_SKILL_CAP = 48 * 1024;
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** The text after the front matter; a leading BOM, an empty front matter and a closing line at the end count. */
function dropFrontMatter(text) {
    const body = normalizeNewlines(text).replace(/^﻿/, '');
    const match = /^---\n(?:[\s\S]*?\n)?---(?:\n|$)/.exec(body);
    return (match ? body.slice(match[0].length) : body).trim();
}
/**
 * Review F4: the file is read only when it resolves inside the project and is a regular file within the cap, so a
 * link to a device, a pipe or a huge file cannot stall the stage command.
 */
function readSkillFile(realRoot, file) {
    try {
        const real = fs.realpathSync(file);
        if (!isWithin(realRoot, real))
            return undefined;
        const stat = fs.statSync(real);
        if (!stat.isFile() || stat.size > STAGE_SKILL_CAP)
            return undefined;
        return readText(real);
    }
    catch {
        return undefined;
    }
}
/** The body of `name`'s SKILL.md in the first skills folder that has it, never through a link out of the project. */
function skillBody(root, folders, name) {
    if (!NAME.test(name))
        return undefined;
    const realRoot = fs.realpathSync(root);
    for (const folder of folders) {
        const text = readSkillFile(realRoot, path.join(root, folder, name, 'SKILL.md'));
        if (text !== undefined)
            return dropFrontMatter(text);
    }
    return undefined;
}
const MISSING = 'Missing: this skill is not installed in the project. Load it by name if your tool has it.';
const OVER_CAP = `Past the ${STAGE_SKILL_CAP / 1024} KiB limit of this output: load it by name.`;
function block(name, body) {
    return `## Skill ${name}\n\n${body}\n`;
}
/** The texts of the stage's skills, within the cap. */
export function stageSkillTexts(root, config, stage) {
    const installed = new Set(Object.keys(readTeam(root).skills));
    const accepted = acceptedRolesReport(root);
    const team = roleSkills(accepted.roles, installed);
    const folders = teamSkillFolders(config);
    const result = { stage, skills: [], text: '', refusedRoles: accepted.refused };
    let full = false;
    for (const name of stageSkillIds(config, stage, team)) {
        const body = full ? undefined : skillBody(root, folders, name);
        const text = body === undefined ? undefined : `${result.text ? '\n' : ''}${block(name, body)}`;
        // Review F3: the texts stop at the cap, separators counted; every later skill is only named.
        full = full || (text !== undefined && Buffer.byteLength(result.text + text) > STAGE_SKILL_CAP);
        const status = statusOf(full, text);
        result.text += status === 'injected' ? text : `${result.text ? '\n' : ''}${notice(name, status)}`;
        result.skills.push({ name, status });
    }
    return result;
}
function statusOf(full, text) {
    if (full)
        return 'over-cap';
    return text === undefined ? 'missing' : 'injected';
}
function notice(name, status) {
    return block(name, status === 'missing' ? MISSING : OVER_CAP);
}
