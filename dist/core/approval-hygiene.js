import { decidedAfter } from './decision-order.js';
import { SdlcError } from './errors.js';
import { git } from './git.js';
/**
 * Approval hygiene (0.11.2).
 * B56: after `sdlc rework <gate>`, approving the gate again with the digest approved before that rework needs a
 *      note: a rework closed by the same "yes" must say why nothing had to change.
 * B60: an approval proposes a commit message whose trailer `SDLC-Approval: <change>:<gate>:<digest12>` ties the
 *      commit to the approval; `sdlc approvals verify` reports whether such a commit is reachable from HEAD.
 */
/** True when the gate's latest rework came after an approval of exactly `digest` (the latest one before it). */
export function unchangedSinceRework(state, gate, digest) {
    const record = state.gates[gate];
    const rework = record?.rework;
    if (!rework || !digest)
        return false;
    const before = (record.approvals ?? []).filter((approval) => decidedAfter(rework, approval));
    const latest = before.reduce((found, approval) => (!found || decidedAfter(approval, found) ? approval : found), undefined);
    return latest?.digest === digest;
}
/** Refuses a bare re-approval of an unchanged gate after its rework (`unchanged_after_rework`). */
export function assertChangedSinceRework(state, gate, digest, note) {
    if (note?.trim() || !unchangedSinceRework(state, gate, digest))
        return;
    throw new SdlcError('unchanged_after_rework', { key: 'error.unchanged_after_rework', params: { gate } }, { key: 'fix.unchanged_after_rework', params: { gate } });
}
/** The first 12 hex digits of a digest (`sha256:<hex>`). */
export function shortDigest(digest) {
    return digest.replace(/^sha256:/, '').slice(0, 12);
}
export function approvalTrailer(change, gate, digest) {
    return `SDLC-Approval: ${change}:${gate}:${shortDigest(digest)}`;
}
/** A subject naming the change and gate, a blank line, then the trailer. */
export function approvalCommitMessage(change, gate, digest) {
    return `chore(${change}): approve the ${gate} gate\n\n${approvalTrailer(change, gate, digest)}`;
}
/** Every `SDLC-Approval:` trailer line in the commits reachable from HEAD, read in one pass. */
export function approvalTrailers(root) {
    const result = git(root, ['log', '--fixed-strings', '--grep=SDLC-Approval: ', '--format=%B', 'HEAD']);
    if (!result.ok)
        return new Set();
    const lines = result.stdout.split(/\r?\n/).map((text) => text.trim());
    return new Set(lines.filter((text) => text.startsWith('SDLC-Approval: ')));
}
