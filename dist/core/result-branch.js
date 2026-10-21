import * as crypto from 'node:crypto';
import { SdlcError } from './errors.js';
import { git } from './git.js';
/** Resolve a result branch locally or fetch it from origin into a private, unique ref. */
export function resultBranch(root, branch) {
    if (!branch || branch.startsWith('-') || branch.includes('..') || branch.includes(':')
        || /\s|[\0\r\n]/.test(branch)) {
        throw new SdlcError('invalid_branch', { key: 'error.invalid_result_branch_x', params: { branch } });
    }
    if (!git(root, ['check-ref-format', '--branch', branch]).ok) {
        throw new SdlcError('invalid_branch', { key: 'error.invalid_result_branch_x', params: { branch } });
    }
    if (git(root, ['rev-parse', '--verify', '--end-of-options', `${branch}^{commit}`]).ok)
        return branch;
    const fetched = `refs/sdlc/fetched/${crypto.randomUUID()}`;
    const source = `refs/heads/${branch}`;
    const result = git(root, ['fetch', '--no-tags', 'origin', `${source}:${fetched}`]);
    if (!result.ok) {
        throw new SdlcError('branch_fetch_failed', {
            key: 'error.result_branch_fetch_failed_x', params: { branch },
        });
    }
    return fetched;
}
