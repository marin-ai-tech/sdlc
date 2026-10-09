import { SdlcError } from '../core/errors.js';
import { findSecrets } from '../core/policy-secrets.js';
/** The lifecycle's six stages (lifecycle.ts `STAGES`); not imported, because config.ts loads this module. */
const STAGE_IDS = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'];
/** A name that fits both tools' tool names (`mcp__<name>__<tool>`, `<name>_<tool>`); `sdlc` is the CLI's own. */
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
export const RESERVED_SERVER = 'sdlc';
const REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
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
function strings(value, where) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw invalid('error.x_must_be_a_list_of_strings', where);
    }
    return value;
}
/** A map of strings (`env`, `headers`); absent = empty. */
function stringMap(value, where) {
    const raw = mapping(value, where) ?? {};
    for (const [key, item] of Object.entries(raw)) {
        if (typeof item !== 'string')
            throw invalid('error.x_must_be_a_non_empty_string', `${where}.${key}`);
    }
    return raw;
}
function stages(value, where) {
    if (value === undefined || value === null)
        return [];
    const list = strings(value, where);
    const unknown = list.find((stage) => !STAGE_IDS.includes(stage));
    if (unknown !== undefined)
        throw invalid('error.x_must_be_x', where, { p2: STAGE_IDS.join(', ') });
    return list;
}
function parseServer(name, value, where) {
    if (!SERVER_NAME.test(name) || name === RESERVED_SERVER)
        throw invalid('error.mcp_server_name', where);
    const raw = mapping(value, where) ?? {};
    const type = raw.type ?? 'stdio';
    const common = { name, stages: stages(raw.stages, `${where}.stages`) };
    if (type === 'http') {
        const url = text(raw.url, `${where}.url`);
        return { ...common, type, url, headers: stringMap(raw.headers, `${where}.headers`) };
    }
    if (type !== 'stdio')
        throw invalid('error.x_must_be_x', `${where}.type`, { p2: 'stdio, http' });
    const command = strings(raw.command, `${where}.command`);
    if (command.length === 0 || command[0].trim() === '')
        throw invalid('error.x_is_required', `${where}.command`);
    return { ...common, type, command, env: stringMap(raw.env, `${where}.env`) };
}
/** `mcp.servers`: name -> server, in the file's order. */
export function parseMcpServers(value, where) {
    const raw = mapping(value, where('mcp.servers')) ?? {};
    return Object.entries(raw).map(([name, item]) => parseServer(name, item, where(`mcp.servers.${name}`)));
}
function parseCheck(value, where, index) {
    const raw = mapping(value, where) ?? {};
    const required = raw.required ?? true;
    if (typeof required !== 'boolean')
        throw invalid('error.x_must_be_true_or_false', `${where}.required`);
    return {
        name: raw.name === undefined ? `mcp-${index + 1}` : text(raw.name, `${where}.name`),
        server: text(raw.server, `${where}.server`),
        tool: text(raw.tool, `${where}.tool`),
        args: mapping(raw.args, `${where}.args`) ?? {},
        expect: raw.expect ?? {},
        required,
    };
}
/** `verify.mcp` (or `release.mcp`, B47, the same format): the checks the CLI calls; absent = none. */
export function parseMcpChecks(value, where, key = 'verify.mcp') {
    if (value === undefined || value === null)
        return [];
    if (!Array.isArray(value))
        throw invalid('error.x_must_be_a_list', where(key));
    return value.map((item, index) => parseCheck(item, where(`${key}[${index}]`), index));
}
/** The values a server is given through its configuration: `env` (stdio) or `headers` (http). */
export function secretCarriers(server) {
    return server.type === 'stdio' ? server.env : server.headers;
}
/** A value that holds a secret literal: the patterns of B16, on the value alone and as `key = "value"`. */
function holdsSecret(key, value) {
    if (findSecrets(value).length > 0)
        return true;
    return !/[\s"'`]/.test(value) && findSecrets(`${key} = "${value}"`).length > 0;
}
/** The values to scan for a literal secret, by key: `env.X` / `headers.X`, and an http server's `url`. */
function scanned(server) {
    const kind = server.type === 'stdio' ? 'env' : 'headers';
    const entries = Object.entries(secretCarriers(server));
    const values = entries.map(([key, value]) => [`${kind}.${key}`, value]);
    return server.type === 'http' ? [...values, ['url', server.url]] : values;
}
/** Refuses a literal secret in `env` or `headers` (`mcp_secret_literal`); names the server and the key only. */
export function assertNoSecretLiterals(servers) {
    for (const server of servers) {
        const hit = scanned(server).find(([key, value]) => holdsSecret(key.split('.').pop() ?? key, value));
        if (!hit)
            continue;
        throw new SdlcError('mcp_secret_literal', { key: 'error.mcp_secret_literal', params: { server: server.name, key: hit[0] } }, { key: 'fix.mcp_secret_literal', params: { server: server.name } });
    }
}
/** `${VAR}` replaced by the variable's value (empty when unset). */
export function expandRefs(value, env) {
    return value.replace(REFERENCE, (_match, name) => env[name] ?? '');
}
/** `${VAR}` in OpenCode's spelling, `{env:VAR}`. */
export function openCodeRefs(value) {
    return value.replace(REFERENCE, (_match, name) => `{env:${name}}`);
}
/** `${VAR}` references as Cursor writes them: `${env:VAR}` (B81). */
export function cursorRefs(value) {
    return value.replace(REFERENCE, (_match, name) => `\${env:${name}}`);
}
/** Each value of a map passed through `fn`. */
export function mapValues(map, fn) {
    return Object.fromEntries(Object.entries(map).map(([key, value]) => [key, fn(value)]));
}
/** The values a server receives after expansion: these are the secrets its answers must never echo. */
export function expandedSecrets(server, env) {
    const values = Object.values(secretCarriers(server));
    const expanded = values.flatMap((value) => [...value.matchAll(REFERENCE)].map((m) => env[m[1]] ?? ''));
    return expanded.filter((value) => value.length >= 4);
}
