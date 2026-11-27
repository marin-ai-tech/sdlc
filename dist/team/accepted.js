import * as path from 'node:path';
import { SdlcError } from '../core/errors.js';
import { readText } from '../core/fs-utils.js';
import { acceptedPath, AGENTS_DIR, draftPath, readTeam, roleDigest, roleIdsIn, } from './record.js';
import { parseRoleFile } from './role-file.js';
/**
 * A role's status: `accepted` while the file in docs/agents/ still has the digest team.json recorded, `changed` when
 * it differs or was never recorded (a person edited or added it: re-accepting records it), `draft` with only a draft.
 */
export function roleStatus(root, id, team = readTeam(root)) {
    const accepted = readText(path.join(root, acceptedPath(id)));
    if (accepted !== undefined)
        return team.roles[id]?.digest === roleDigest(accepted) ? 'accepted' : 'changed';
    return readText(path.join(root, draftPath(id))) === undefined ? undefined : 'draft';
}
/** The ids of the roles whose file still has the digest a person accepted: the ones the refresh reads. */
function acceptedIds(root, team) {
    return roleIdsIn(root, AGENTS_DIR).filter((id) => roleStatus(root, id, team) === 'accepted');
}
function parseAccepted(root, id) {
    return parseRoleFile(id, readText(path.join(root, acceptedPath(id))) ?? '');
}
/** The accepted role in its file, or why the parser refuses it; any other failure is thrown. */
function readAccepted(root, id) {
    try {
        return { ok: parseAccepted(root, id) };
    }
    catch (error) {
        if (error instanceof SdlcError)
            return { refused: error };
        throw error;
    }
}
/** The role as the generated files use it: with the registry's source marker team.json recorded. */
function withMarker(role, entry) {
    return { ...role, ...(entry.source === 'registry' && entry.marker ? { marker: entry.marker } : {}) };
}
/**
 * The roles the refresh of the generated files reads (B249 review F3, round 2 F2): those whose file still has the
 * accepted digest, minus `except` (the role a person is accepting now; its new text is checked on its own). Checked
 * before a command writes anything: a refused one stops it naming the file and the next step. An edited (`changed`)
 * or never recorded file is not read by the refresh, so it never blocks a command.
 */
export function assertRolesReadable(root, except) {
    const team = readTeam(root);
    for (const id of acceptedIds(root, team)) {
        if (id === except)
            continue;
        const read = readAccepted(root, id);
        if ('ok' in read)
            continue;
        const file = acceptedPath(id);
        const message = { key: 'error.accepted_role_file_refused', params: { file, reason: read.refused.message } };
        throw new SdlcError(read.refused.code, message, { key: 'fix.fix_role_file_then_accept', params: { file, id } });
    }
}
/**
 * The roles the generated subagents come from: only files whose digest is the one a person accepted. An accepted
 * file edited since (by anyone) generates nothing until a person accepts it again, so an edit that slipped past the
 * hook never reaches the subagent.
 */
export function acceptedRoles(root) {
    const team = readTeam(root);
    return acceptedIds(root, team).map((id) => withMarker(parseAccepted(root, id), team.roles[id]));
}
/**
 * The accepted roles split into those sdlc reads and those it refuses (B249 review round 2, F4), for the read-only
 * commands (`team check`, `team skills`): they list a refused role instead of failing as a whole.
 */
export function acceptedRolesReport(root) {
    const team = readTeam(root);
    const roles = [];
    const refused = [];
    for (const id of acceptedIds(root, team)) {
        const read = readAccepted(root, id);
        if ('ok' in read)
            roles.push(withMarker(read.ok, team.roles[id]));
        else
            refused.push({ role: id, reason: read.refused.localizedMessage() });
    }
    return { roles, refused };
}
