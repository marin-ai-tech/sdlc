import * as path from 'node:path';
import { readChangeState } from './change-state.js';
import { listChangeFolders, listArchivedChanges } from './changes.js';
import { changeAgentCommits } from './agent-commits.js';
import { commitsTouching } from './git.js';
/** True when `at` (an ISO timestamp) is at or after `since`; everything is in the period without `since`. */
export function atOrAfter(at, since) {
    if (since === undefined)
        return true;
    return Date.parse(at) >= Date.parse(since);
}
/** A path relative to the root with forward slashes, as git's pathspecs take it on every platform. */
function gitPath(root, dir) {
    return path.relative(root, dir).split(path.sep).join('/');
}
/**
 * The folders the change's commits touched: the current one and, for an archived change, the pre-archive
 * openspec/changes/<id>/ (the history did not follow the move to openspec/changes/archive/<date>-<id>/).
 */
export function changeFolders(paths, ref) {
    const current = gitPath(paths.root, ref.dir);
    const before = gitPath(paths.root, path.join(paths.changesDir, ref.id));
    return current === before ? [current] : [current, before];
}
/** The commits touching any of the change's folders (one `git log`, so de-duplicated), within the period. */
function changeCommits(paths, ref, since) {
    const commits = commitsTouching(paths.root, changeFolders(paths, ref));
    return commits.filter((commit) => atOrAfter(commit.date, since));
}
/** Reads the audit of one change; `since` (ISO) limits its history and commits to the period. */
export function auditChange(paths, ref, since) {
    const state = readChangeState(ref.dir);
    return {
        state,
        history: state.history.filter((event) => atOrAfter(event.at, since)),
        commits: changeCommits(paths, ref, since),
        agentCommits: changeAgentCommits(paths.root, ref.id, since),
    };
}
/** True when the change has any history event at or after `since` (always true without `since`). */
function activeSince(ref, since) {
    if (since === undefined)
        return true;
    return readChangeState(ref.dir).history.some((event) => atOrAfter(event.at, since));
}
/** The active and archived changes; with `since`, only those with any history event in the period (B104). */
export function changesInPeriod(paths, since) {
    const refs = [...listChangeFolders(paths), ...listArchivedChanges(paths)];
    return refs.filter((ref) => activeSince(ref, since));
}
