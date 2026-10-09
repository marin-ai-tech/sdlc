import { SdlcError } from '../core/errors.js';
function invalid(key, where, extra = {}) {
    return new SdlcError('invalid_config', { key, params: { p1: where, where, ...extra } });
}
/** `team`: absent = undefined. `servers` are the names of `mcp.servers`. */
export function parseTeamConfig(value, where, servers) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value))
        throw invalid('error.x_must_be_a_mapping', where('team'));
    const registry = value.registry;
    if (registry === undefined || registry === null)
        return {};
    if (typeof registry !== 'string' || registry.trim() === '') {
        throw invalid('error.x_must_be_a_non_empty_string', where('team.registry'));
    }
    if (!servers.includes(registry)) {
        throw invalid('error.team_unknown_registry', where('team.registry'), { server: registry });
    }
    return { registry };
}
