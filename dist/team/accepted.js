import * as path from 'node:path';
import { readText } from '../core/fs-utils.js';
import { acceptedPath, AGENTS_DIR, draftPath, readTeam, roleDigest, roleIdsIn } from './record.js';
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
/**
 * The roles the generated subagents come from: only files whose digest is the one a person accepted. An accepted
 * file edited since (by anyone) generates nothing until a person accepts it again, so an edit that slipped past the
 * hook never reaches the subagent.
 */
export function acceptedRoles(root) {
    const team = readTeam(root);
    const roles = [];
    for (const id of roleIdsIn(root, AGENTS_DIR)) {
        if (roleStatus(root, id, team) !== 'accepted')
            continue;
        roles.push(parseRoleFile(id, readText(path.join(root, acceptedPath(id))) ?? ''));
    }
    return roles;
}
