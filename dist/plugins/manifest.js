import { createRequire } from 'node:module';
import { API_VERSION, HOOKS, NAME, fail, json, keys, object, text } from './api.js';
const semver = createRequire(import.meta.url)('semver');
export const RESERVED = new Set(('adopt config roles ci team backlog defer layout init update uninstall new '
    + 'explore import status explain help guide next gate approve reject waive rework drop track takeover '
    + 'release-control tests verify judge review task board mcp context inbox report dashboard log license doctor '
    + 'health plugin plugins trace hook openspec core sdlc setup change summary statusline events triage '
    + 'release approvals instructions validate archive audit changelog answer '
    + 'deferred executor exploration harness question').split(' '));
export function pluginName(value) {
    const name = text(value, 'plugin name');
    if (!NAME.test(name) || RESERVED.has(name) || ['constructor', 'prototype'].includes(name)) {
        fail('plugin_name', 'Plugin namespace is invalid or reserved');
    }
    return name;
}
function schema(value, where) {
    if (typeof value === 'boolean' || typeof value === 'string')
        return value;
    return object(value, where);
}
function routes(value, operations, where) {
    const result = Object.create(null);
    for (const [name, op] of Object.entries(object(value, where))) {
        if (!NAME.test(name) || !Object.hasOwn(operations, text(op, where)))
            fail('plugin_manifest', `Invalid ${where}`);
        result[name] = op;
    }
    return result;
}
export function parseManifest(value) {
    const m = object(value, 'manifest');
    keys(m, ['format', 'name', 'version', 'api', 'entry', 'initialState', 'schemas', 'operations',
        'commands', 'tools', 'hooks', 'events'], 'manifest');
    if (m.format !== 'sdlc.plugin/1')
        fail('plugin_manifest', 'Unsupported manifest format');
    const name = pluginName(m.name);
    const version = text(m.version, 'version');
    const api = text(m.api, 'api');
    if (!semver.valid(version) || !semver.validRange(api))
        fail('plugin_manifest', 'Invalid semantic version/range');
    if (!semver.satisfies(API_VERSION, api))
        fail('plugin_api', 'Plugin API is incompatible');
    const rawSchemas = object(m.schemas, 'schemas');
    keys(rawSchemas, ['config', 'state', 'facts', 'taskExt', 'bidExt'], 'schemas');
    const schemas = Object.fromEntries(Object.entries(rawSchemas).map(([k, v]) => [k, schema(v, k)]));
    for (const required of ['config', 'state', 'facts']) {
        if (!Object.hasOwn(schemas, required))
            fail('plugin_manifest', `Missing ${required} schema`);
    }
    const operations = Object.create(null);
    for (const [id, raw] of Object.entries(object(m.operations, 'operations'))) {
        if (!NAME.test(id))
            fail('plugin_manifest', 'Invalid operation name');
        const op = object(raw, id);
        keys(op, ['access', 'input', 'output'], id);
        if (typeof op.access !== 'string' || !['read', 'executor', 'person'].includes(op.access)) {
            fail('plugin_manifest', 'Invalid access class');
        }
        operations[id] = { access: op.access,
            input: schema(op.input, 'input'), output: schema(op.output, 'output') };
    }
    const hooks = {};
    for (const [point, op] of Object.entries(object(m.hooks, 'hooks'))) {
        if (!HOOKS.includes(point) || typeof op !== 'string'
            || operations[op]?.access !== 'read')
            fail('plugin_manifest', 'Invalid pure hook operation');
        hooks[point] = op;
    }
    const events = Object.create(null);
    for (const [event, value] of Object.entries(object(m.events, 'events'))) {
        if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/.test(event) || event.length > 96) {
            fail('plugin_manifest', 'Invalid event suffix');
        }
        events[event] = schema(value, 'event');
    }
    const entry = text(m.entry, 'entry');
    if (!entry.endsWith('.wasm'))
        fail('plugin_manifest', 'Entrypoint must be WebAssembly');
    return { format: 'sdlc.plugin/1', name, version, api, entry, initialState: json(m.initialState),
        schemas: schemas, operations, hooks, events,
        commands: routes(m.commands, operations, 'commands'), tools: routes(m.tools, operations, 'tools') };
}
