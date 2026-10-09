import * as fs from 'node:fs';
import * as path from 'node:path';
import { readContextPack } from '../core/context-packs.js';
import { t } from '../core/i18n.js';
import { layoutRole } from '../core/layout.js';
import { readRolesFile, ROLES_PATH } from '../core/roles.js';
/**
 * `{{project}}` of a role (B70): what sdlc knows about THIS project and the role does not. The checks, protected and
 * test paths, the people per role and the separation rules, the language, the AI-ready documents that exist, and the
 * context packs and MCP servers of the role's stages. Read at generation, so `sdlc update` follows the project.
 */
const DOCUMENTS = ['agents-guide', 'architecture', 'conventions'];
function code(values) {
    return values.map((value) => `\`${value.replace(/`/g, "'")}\``).join(', ');
}
function orNone(values, locale) {
    return values.length > 0 ? code(values) : t('team.project.none', {}, locale);
}
function checks(config, locale) {
    if (config.verify.commands.length === 0)
        return t('team.project.none', {}, locale);
    return config.verify.commands.map((command) => {
        const kind = command.required === false ? 'team.project.optional' : 'team.project.required';
        return `\`${command.run.replace(/`/g, "'")}\` (${t(kind, {}, locale)})`;
    }).join(', ');
}
function rolesFile(root) {
    try {
        return readRolesFile(root);
    }
    catch {
        return undefined;
    }
}
function peopleLines(roles, locale) {
    if (!roles)
        return [];
    const name = (id) => roles.people.find((person) => person.id === id)?.name ?? id;
    const held = Object.entries(roles.roles).map(([role, ids]) => `\`${role}\`: ${ids.map(name).join(', ')}`);
    if (held.length === 0)
        return [];
    return [t('team.project.people', { path: ROLES_PATH, list: held.join('; ') }, locale)];
}
function separationLines(roles, locale) {
    if (!roles)
        return [];
    const rules = roles.separation;
    const parts = [
        ...(rules.authorCannotApprove.length > 0
            ? [t('team.separation.author', { gates: code(rules.authorCannotApprove) }, locale)] : []),
        ...(rules.distinctApprovers.length > 0
            ? [t('team.separation.distinct', { pairs: rules.distinctApprovers.map((p) => code(p)).join('; ') }, locale)]
            : []),
        ...(rules.maxGatesPerPerson > 0 ? [t('team.separation.max', { max: rules.maxGatesPerPerson }, locale)] : []),
    ];
    return parts.length > 0 ? [t('team.project.separation', { list: parts.join('; ') }, locale)] : [];
}
function documents(root, config) {
    const paths = DOCUMENTS.map((id) => config.layout[id] ?? layoutRole(id).path);
    return paths.filter((rel) => fs.existsSync(path.join(root, rel)));
}
function packs(root, stages) {
    const found = new Set();
    for (const stage of stages) {
        for (const source of readContextPack(root, stage)?.sources ?? [])
            found.add(source.path);
    }
    return [...found].sort();
}
function servers(config, stages) {
    const wanted = stages;
    const own = (config.mcp?.servers ?? []).filter((server) => server.stages.some((stage) => wanted.includes(stage)));
    return own.map((server) => server.name);
}
function optionalLine(key, values, locale) {
    return values.length > 0 ? [t(key, { list: code(values) }, locale)] : [];
}
/** The "This project" block for a role with these stages, in the locale. */
export function projectBlock(input) {
    const { root, config, stages, locale } = input;
    const roles = rolesFile(root);
    return [
        t('team.project.title', {}, locale),
        '',
        t('team.project.checks', { list: checks(config, locale) }, locale),
        t('team.project.protected', { list: orNone(config.enforcement.protectedPaths, locale) }, locale),
        t('team.project.tests', { list: orNone(config.enforcement.testPaths, locale) }, locale),
        ...peopleLines(roles, locale),
        ...separationLines(roles, locale),
        t('team.project.language', { locale: `\`${locale}\`` }, locale),
        ...optionalLine('team.project.documents', documents(root, config), locale),
        ...optionalLine('team.project.packs', packs(root, stages), locale),
        ...optionalLine('team.project.servers', servers(config, stages), locale),
    ].join('\n');
}
