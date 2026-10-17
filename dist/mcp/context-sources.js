import { SdlcError } from '../core/errors.js';
/** A pack file name: letters, digits, `-` and `_` — no `/`, `\`, `..`, so it stays inside `docs/context/`. */
const PACK_NAME = /^[A-Za-z0-9_-]+$/;
/** The lifecycle's six stages (lifecycle.ts `STAGES`); not imported, because config.ts loads this module. */
const STAGE_IDS = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'];
function invalid(key, where, extra = {}) {
    return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}
function mapping(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw invalid('error.x_must_be_a_mapping', where);
    return value;
}
function text(value, where) {
    if (typeof value !== 'string' || value.trim() === '')
        throw invalid('error.x_must_be_a_non_empty_string', where);
    return value;
}
/** The stages the pack is for: a required list of known stage ids. */
function stages(value, where) {
    if (value === undefined || value === null)
        throw invalid('error.x_is_required', where);
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw invalid('error.x_must_be_a_list_of_strings', where);
    }
    const unknown = value.find((stage) => !STAGE_IDS.includes(stage));
    if (unknown !== undefined)
        throw invalid('error.x_must_be_x', where, { p2: STAGE_IDS.join(', ') });
    return value;
}
/** `fresh_days`: a positive whole number of days; absent = none declared. */
function freshDays(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
        throw invalid('error.x_must_be_an_integer_of_1_or_more', where);
    }
    return value;
}
/** Exactly one of `resource`/`tool`: both set, or neither, is an invalid configuration. */
function sourceKind(raw, where) {
    const resource = raw.resource === undefined || raw.resource === null
        ? undefined
        : text(raw.resource, `${where}.resource`);
    const tool = raw.tool === undefined || raw.tool === null
        ? undefined
        : text(raw.tool, `${where}.tool`);
    if ((resource === undefined) === (tool === undefined)) {
        throw invalid('error.x_must_be_x', where, { p2: 'exactly one of `resource` or `tool`' });
    }
    return resource === undefined ? { tool } : { resource };
}
function parseSource(value, where, servers) {
    const raw = mapping(value, where) ?? {};
    const name = text(raw.name, `${where}.name`);
    if (!PACK_NAME.test(name)) {
        throw invalid('error.x_must_be_x', `${where}.name`, { p2: 'a plain file name (letters, digits, - and _)' });
    }
    const server = text(raw.server, `${where}.server`);
    if (!servers.includes(server))
        throw invalid('error.context_unknown_server', `${where}.server`, { server });
    const fresh = freshDays(raw.fresh_days, `${where}.fresh_days`);
    const source = {
        name,
        server,
        ...sourceKind(raw, where),
        args: mapping(raw.args, `${where}.args`) ?? {},
        stages: stages(raw.stages, `${where}.stages`),
        owner: text(raw.owner, `${where}.owner`),
    };
    if (fresh !== undefined)
        source.freshDays = fresh;
    return source;
}
/** The name an invalid entry is reported under: its `name` when that is a string, else its position. */
function entryName(value, index) {
    const name = value && typeof value === 'object' ? value.name : undefined;
    return typeof name === 'string' ? name : `context.sources[${index}]`;
}
/** One entry into a source or into `invalid` with the parse reason (English, like every skip reason). */
function parseEntry(value, index, where, servers) {
    try {
        return { source: parseSource(value, where(`context.sources[${index}]`), servers) };
    }
    catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { invalid: { name: entryName(value, index), reason } };
    }
}
/** `context.sources`: valid sources and invalid entries, in the file's order; absent = none. */
export function parseContextSources(value, where, servers) {
    const config = { sources: [], invalid: [] };
    if (value === undefined || value === null)
        return config;
    if (!Array.isArray(value))
        throw invalid('error.x_must_be_a_list', where('context.sources'));
    const names = new Set();
    for (const [index, item] of value.entries()) {
        const parsed = parseEntry(item, index, where, servers);
        if (parsed.source) {
            if (names.has(parsed.source.name)) {
                const reason = invalid('error.x_must_be_x', where('context.sources'), { p2: `unique names (again: ${parsed.source.name})` }).message;
                config.invalid.push({ name: parsed.source.name, reason });
                continue;
            }
            names.add(parsed.source.name);
            config.sources.push(parsed.source);
        }
        if (parsed.invalid)
            config.invalid.push(parsed.invalid);
    }
    return config;
}
