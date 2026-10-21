import { SdlcError } from '../core/errors.js';
const REPO = /^[^\s/]+\/[^\s/]+$/;
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
/**
 * `issues`: the registry server and the repository, in the file's order; absent = the backlog is not linked
 * to GitHub issues. `servers` are the names of `mcp.servers`.
 */
export function parseIssues(value, where, servers) {
    const raw = mapping(value, where('issues'));
    if (!raw)
        return undefined;
    const server = text(raw.server, `${where('issues')}.server`);
    if (!servers.includes(server)) {
        throw invalid('error.events_unknown_server', `${where('issues')}.server`, { server });
    }
    const repo = text(raw.repo, `${where('issues')}.repo`);
    if (!REPO.test(repo))
        throw invalid('error.x_must_be_x', `${where('issues')}.repo`, { p2: 'owner/name' });
    const [owner, name] = repo.split('/');
    return { server, owner, repo: name };
}
