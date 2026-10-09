import * as path from 'node:path';
import { parse } from 'yaml';
import { listFilesRecursive, normalizeNewlines, readText } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { sha256 } from '../integrations/manifest.js';
import { acceptedRoles } from './accepted.js';
import { readTeam } from './record.js';
import { fetchSkills } from './skills.js';
import { scriptsOf, unsafeSkillPath } from './vetting.js';
/** A grant without a limit: the tool alone, or with `*`, `**`, `:*` or `/**` as its only pattern. */
const UNRESTRICTED = /^(?:bash|shell|write|edit|multiedit|notebookedit)(?:\((?:|\*|\*\*|:\*|\/\*\*|\.\/\*\*)\))?$/i;
const URL = /https?:\/\/[^\s<>"'`)\]]+/g;
const FRONT = /^---\n([\s\S]*?)\n---/;
/** Splits `Bash(npm run lint) Read, Grep` at commas and spaces outside parentheses. */
function splitTools(value) {
    const out = [];
    let depth = 0;
    let current = '';
    for (const char of value) {
        depth = Math.max(0, depth + (char === '(' ? 1 : char === ')' ? -1 : 0));
        const cut = depth === 0 && (char === ',' || /\s/.test(char));
        if (!cut)
            current += char;
        else if (current)
            out.push(current);
        if (cut)
            current = '';
    }
    return current ? [...out, current] : out;
}
/** The tools `allowed-tools` of the skill's SKILL.md grants. */
export function allowedToolsOf(files) {
    const skill = files.find((file) => file.path.toLowerCase() === 'skill.md');
    const match = skill ? normalizeNewlines(skill.content).match(FRONT) : null;
    if (!match)
        return [];
    try {
        const value = parse(match[1])?.['allowed-tools'];
        if (Array.isArray(value))
            return value.map(String).flatMap(splitTools);
        return typeof value === 'string' ? splitTools(value) : [];
    }
    catch {
        return [];
    }
}
export function isUnrestricted(tool) {
    return UNRESTRICTED.test(tool.trim());
}
function urlsOf(files) {
    return [...new Set(files.flatMap((file) => file.content.match(URL) ?? []))].sort();
}
function described(id, files, state, problems) {
    const allowedTools = allowedToolsOf(files);
    const grants = allowedTools.filter(isUnrestricted).map((tool) => t('team.check.unrestricted', { id, tool }));
    const warnings = [...problems, ...grants];
    return { id, ...state, scripts: scriptsOf(files), allowedTools, urls: urlsOf(files), warnings };
}
/** Files in the skill's folder that team.json does not list. */
function extraFiles(root, entry) {
    const found = listFilesRecursive(path.join(root, entry.dir)).map((rel) => rel.replace(/\\/g, '/'));
    return found.filter((rel) => !(rel in entry.files)).sort();
}
function installedCheck(root, id, entry) {
    const files = [];
    const problems = [];
    for (const rel of Object.keys(entry.files).sort()) {
        const content = unsafeSkillPath(rel) ? undefined : readText(path.join(root, entry.dir, rel));
        if (content === undefined)
            problems.push(t('team.check.missing', { id, path: rel }));
        else if (sha256(content) !== entry.files[rel])
            problems.push(t('team.check.edited', { id, path: rel }));
        if (content !== undefined)
            files.push({ path: rel, content });
    }
    const extra = extraFiles(root, entry);
    if (extra.length > 0)
        problems.push(t('team.check.extra', { id, list: extra.join(', ') }));
    const state = { version: entry.version, source: entry.source, checksumOk: problems.length === 0, installed: true,
        needsAcceptance: false };
    return described(id, files, state, problems);
}
function remoteCheck(id, fetched) {
    const vetted = fetched.skills[id];
    const source = fetched.origins[id]?.source ?? 'registry';
    const failed = { version: null, source, checksumOk: false, installed: false, needsAcceptance: false };
    if (!vetted)
        return { ...described(id, [], failed, []), reason: fetched.error ?? 'not fetched' };
    if (!('ok' in vetted))
        return { ...described(id, [], failed, []), reason: vetted.reason };
    const skill = vetted.ok;
    const needsAcceptance = scriptsOf(skill.files).length > 0;
    const state = { version: skill.version, source, checksumOk: true, installed: false, needsAcceptance };
    return described(id, skill.files, state, []);
}
/** The check of every skill of the team; the registry (then the packs) is asked only for the skills not installed. */
export async function checkTeamSkills(root, config) {
    const team = readTeam(root);
    const listedIds = acceptedRoles(root).flatMap((role) => role.skills);
    const ids = [...new Set([...listedIds, ...Object.keys(team.skills)])].sort();
    const missing = ids.filter((id) => !team.skills[id]);
    const none = { skills: {}, origins: {} };
    const fetched = missing.length > 0 ? await fetchSkills(root, config, missing) : none;
    const check = (id) => {
        const entry = team.skills[id];
        return entry ? installedCheck(root, id, entry) : remoteCheck(id, fetched);
    };
    const skills = ids.map(check);
    const warnings = skills.flatMap((skill) => skill.warnings);
    return { skills, warnings, ...(fetched.error ? { error: fetched.error } : {}) };
}
