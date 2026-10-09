/**
 * `sdlc review suggest`: who could review a change (B17). The candidates are the people `sdlc roles who review`
 * allows for the change now; the authors of its code never are. Owners of the changed paths by CODEOWNERS come
 * first (more owned files first), then the one with fewer open reviews, then the person id. It decides nothing and
 * writes nothing: the person still approves.
 */
import picomatch from 'picomatch';
import { codeOwnerRules } from './adopt.js';
import { readChangeState } from './change-state.js';
import { listActiveChanges } from './changes.js';
import { SdlcError } from './errors.js';
import { evaluateChange, sharedFingerprint } from './lifecycle.js';
import { approvalEmails, changeAuthors, checkApproval, readRolesFile, ROLES_PATH, } from './roles.js';
/** Rule refused when a code author would review and roles.yaml has no `author_cannot_approve` for the gate. */
const CODE_AUTHOR = 'code_author';
/** roles.yaml, required: without it nobody is known to be allowed to approve the review gate. */
export function requireRoles(root) {
    const roles = readRolesFile(root);
    if (roles)
        return roles;
    throw new SdlcError('roles_required', { key: 'error.roles_required', params: { path: ROLES_PATH } }, { key: 'fix.roles_required', params: { path: ROLES_PATH } });
}
/** The rules refusing this person the review gate (as `sdlc roles who` reports them), authors always refused. */
function refusedRules(ev, person, approvals) {
    const context = { gate: 'review', roles: ev.accepted, email: person.emails[0], authors: ev.authors,
        approvals };
    const rules = checkApproval(ev.roles, context).refusals.map((item) => item.rule);
    const author = person.emails.some((email) => ev.authors.includes(email));
    if (author && !rules.includes('author_cannot_approve'))
        rules.push(CODE_AUTHOR);
    return rules;
}
/** A CODEOWNERS pattern as GitHub reads it: `/` anchors, a trailing `/` means a directory, a name a file or dir. */
function patternMatcher(pattern) {
    const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
    const anchored = pattern.startsWith('/') || body.includes('/');
    const glob = anchored ? body : `**/${body}`;
    const exact = picomatch(glob, { dot: true });
    const lastSegment = body.split('/').pop() ?? '';
    const inside = lastSegment.includes('*') && body !== '**' ? () => false : picomatch(`${glob}/**`, { dot: true });
    const directoryOnly = pattern.endsWith('/');
    return (file) => (!directoryOnly && exact(file)) || inside(file);
}
/** The owners of a file: those of the last matching rule (git semantics), none when no rule matches. */
function fileOwners(rules, file) {
    for (let index = rules.length - 1; index >= 0; index -= 1) {
        if (rules[index].matches(file))
            return rules[index].owners;
    }
    return [];
}
function ownsBy(person, owner) {
    if (owner.startsWith('@'))
        return owner.slice(1).toLowerCase() === person.id.toLowerCase();
    return person.emails.includes(owner.toLowerCase());
}
/** Changed files (openspec/ left out) and the CODEOWNERS owners of each. */
function ownersByFile(root, files) {
    const rules = codeOwnerRules(root).map((row) => ({ owners: row.owners, matches: patternMatcher(row.pattern) }));
    const owned = files.filter((file) => !file.startsWith('openspec/'));
    return new Map(owned.map((file) => [file, fileOwners(rules, file)]));
}
/** Approvals recorded in the other active changes whose next step is a person approving the review gate. */
function waitingForReview(ctx, current) {
    const fingerprint = sharedFingerprint(ctx.root);
    const waiting = [];
    for (const ref of listActiveChanges(ctx.paths)) {
        if (ref.id === current)
            continue;
        const next = evaluateChange(ctx.root, ref, ctx.config, { fingerprint, skipPeople: true }).next;
        if (next.actor !== 'human' || next.gate !== 'review')
            continue;
        waiting.push(approvalEmails(readChangeState(ref.dir)));
    }
    return waiting;
}
/** Changes in `waiting` whose review this person may approve and has not approved yet. */
function openReviews(ev, person, waiting) {
    const approved = (approvals) => (approvals.review ?? []).some((email) => person.emails.includes(email.toLowerCase()));
    return waiting.filter((approvals) => !approved(approvals) && refusedRules(ev, person, approvals).length === 0)
        .length;
}
function byPriority(a, b) {
    if (a.owns.length !== b.owns.length)
        return b.owns.length - a.owns.length;
    if (a.openReviews !== b.openReviews)
        return a.openReviews - b.openReviews;
    if (a.person === b.person)
        return 0;
    return a.person < b.person ? -1 : 1;
}
/**
 * The reviewer proposal for a change. `files` are the change's changed files (`sdlc review context`), `base` the
 * ref they and the code authors are computed against.
 */
export function suggestReviewers(ctx, roles, ref, base, files) {
    const review = ctx.config.gates.review;
    const ev = { roles, accepted: [...review.approvers, ...review.highRiskApprovers],
        authors: changeAuthors(ctx.root, base) };
    const holders = new Set(ev.accepted.flatMap((role) => roles.roles[role] ?? []));
    const approvals = approvalEmails(readChangeState(ref.dir));
    const owners = ownersByFile(ctx.root, files);
    const waiting = waitingForReview(ctx, ref.id);
    const candidates = [];
    const excluded = [];
    for (const person of roles.people) {
        const rules = refusedRules(ev, person, approvals);
        if (rules.length === 0) {
            const owns = [...owners].filter(([, list]) => list.some((owner) => ownsBy(person, owner))).map(([file]) => file);
            candidates.push({ person: person.id, name: person.name, owns, openReviews: openReviews(ev, person, waiting) });
        }
        else if (holders.has(person.id)) {
            excluded.push({ person: person.id, name: person.name, rules });
        }
    }
    candidates.sort(byPriority);
    const suggested = candidates[0]?.person ?? null;
    return { change: ref.id, gate: 'review', base: base ?? null, suggested, candidates, excluded };
}
