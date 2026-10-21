import { SOURCE_FIELDS } from '../mcp/context-sources.js';
import { RECEIVER_FIELDS } from '../mcp/event-config.js';
import { SERVER_FIELDS } from '../mcp/registry.js';
function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function entries(value, prefix, fields) {
    return Object.keys(object(value)).filter((key) => !fields.includes(key)).map((key) => `${prefix}.${key}`);
}
/** Paths that a permissive installed-file parser ignores, but a new proposal must refuse. */
export function integrationUnknownKeys(raw) {
    const mcp = object(raw.mcp);
    const context = object(raw.context);
    const servers = Object.entries(object(mcp.servers)).flatMap(([name, value]) => entries(value, `mcp.servers.${name}`, SERVER_FIELDS));
    const receivers = Array.isArray(raw.events) ? raw.events.flatMap((value, index) => entries(value, `events[${index}]`, RECEIVER_FIELDS)) : [];
    const sources = Array.isArray(context.sources) ? context.sources.flatMap((value, index) => {
        const prefix = `context.sources[${index}]`;
        return [...entries(value, prefix, SOURCE_FIELDS),
            ...(!object(value).server ? [`${prefix}.server`] : [])];
    }) : [];
    return [...servers, ...receivers, ...sources];
}
function emptyValues(value, prefix) {
    if (Array.isArray(value))
        return value.flatMap((item, index) => emptyValues(item, `${prefix}[${index}]`));
    if (value === null || typeof value !== 'object')
        return value === '' ? [prefix] : [];
    return Object.entries(value).flatMap(([key, item]) => emptyValues(item, `${prefix}.${key}`));
}
/** An empty argument or carrier is often the result of shell expansion before sdlc sees a reference. */
export function integrationEmptyWarnings(raw) {
    const mcp = object(raw.mcp);
    const context = object(raw.context);
    const paths = [];
    for (const [name, value] of Object.entries(object(mcp.servers))) {
        for (const key of ['env', 'headers'])
            paths.push([object(value)[key], `mcp.servers.${name}.${key}`]);
    }
    const lists = [[raw.events, 'events'], [object(raw.verify).mcp, 'verify.mcp'],
        [object(raw.release).mcp, 'release.mcp'], [context.sources, 'context.sources']];
    for (const [list, prefix] of lists) {
        if (Array.isArray(list))
            list.forEach((item, index) => paths.push([object(item).args, `${prefix}[${index}].args`]));
    }
    return paths.flatMap(([value, prefix]) => emptyValues(value, prefix))
        .map((path) => `${path} is empty; a shell may have expanded \${…}: single-quote the value`);
}
