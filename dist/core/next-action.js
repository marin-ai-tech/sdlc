/**
 * The next-step builder (moved out of lifecycle.ts, B123): `nextAction` walks the evaluated gates in
 * order and names the first thing a person or agent must do — write an artifact, approve a gate,
 * implement, verify, fix findings, release or archive. `approveCli` builds the approval invocation.
 */
import * as path from 'node:path';
import { isFile } from './fs-utils.js';
import { t } from './i18n.js';
import { awaitedRoles } from './approval-quorum.js';
import { qaNext } from './qa-gate.js';
import { activeReviewRevision, effectiveGates, reviseNext } from './rework.js';
function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}
/** "a product-owner", "an engineer" - roles read as nouns in next-step messages. */
function withArticle(roles) {
    const text = roles.join(', ');
    return `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;
}
function gate(view, id) {
    return view.gates.find((g) => g.id === id);
}
export function approveCli(change, gateId, role) {
    return `sdlc approve ${gateId} --change ${change}${role ? ` --as ${role}` : ''}`;
}
export function nextAction(view, config, mapping, state) {
    const withKey = (action, key, params = {}) => ({
        ...action,
        key,
        params,
        message: t(key, params, 'en'),
    });
    if (view.archived)
        return withKey({ actor: 'none', action: 'none' }, 'next.archived');
    const art = new Map(view.artifacts.map((a) => [a.id, a]));
    const firstMissing = (ids) => ids.map((id) => art.get(id)).find((a) => a && a.status !== 'done' && a.status !== 'skipped');
    for (const id of ['intent', 'spec', 'plan']) {
        const g = gate(view, id);
        if (g.satisfied)
            continue;
        const workflow = id;
        const missing = firstMissing(mapping[id]);
        if (missing) {
            return withKey({
                actor: 'agent', action: 'write-artifact', workflow, artifact: missing.id,
                cli: `sdlc instructions ${missing.id} --change ${view.change} --json`,
            }, 'next.writeArtifact', { artifact: missing.id, file: missing.generates, gate: id });
        }
        const rejection = effectiveGates(state)[id]?.rejection;
        const revisionOpen = !rejection?.digest || rejection.digest === g.digest;
        if (g.status === 'rejected' && revisionOpen) {
            return reviseNext(id, mapping[id].join(', '), g.reason ?? '');
        }
        const awaited = awaitedRoles(g.missingRoles, config.gates[id]);
        const role = awaited[0]?.split(' | ')[0];
        const who = g.status === 'stale' ? withArticle(awaited) : capitalize(withArticle(awaited));
        return withKey({
            actor: 'human', action: 'approve-gate', gate: id, workflow,
            cli: approveCli(view.change, id, role && role !== 'any approver' ? role : undefined),
        }, g.status === 'stale' ? 'next.reapprove' : 'next.approve', 
        // `who` is English with an article; `roles` is the bare list other languages build their own sentence from.
        { gate: id, who, roles: awaited.join(', '), artifacts: mapping[id].join(', ') });
    }
    const verify = gate(view, 'verify');
    if (!verify.satisfied) {
        const planWaived = gate(view, 'plan').status === 'waived';
        if (view.tasks.remaining > 0 || (view.tasks.total === 0 && !planWaived)) {
            if (view.tasks.total === 0) {
                return withKey({ actor: 'agent', action: 'implement', workflow: 'build' }, 'next.implementNone');
            }
            return withKey({ actor: 'agent', action: 'implement', workflow: 'build' }, 'next.implementRemain', { remaining: view.tasks.remaining, total: view.tasks.total });
        }
        const verifyKey = verify.status === 'failed'
            ? 'next.verifyFailed'
            : verify.status === 'stale'
                ? 'next.verifyStale'
                : 'next.verifyRun';
        return withKey({ actor: 'agent', action: 'verify', workflow: 'verify', cli: `sdlc verify --change ${view.change}` }, verifyKey);
    }
    const qa = qaNext(view, config);
    if (qa)
        return qa;
    const review = gate(view, 'review');
    if (!review.satisfied) {
        const revision = activeReviewRevision(review, state);
        if (revision)
            return reviseNext('review', 'review.md', revision);
        if (!view.review) {
            return withKey({ actor: 'agent', action: 'review', workflow: 'review' }, 'next.reviewRun');
        }
        if (view.review.blocking.length > 0) {
            return withKey({ actor: 'agent', action: 'fix-findings', workflow: 'review' }, 'next.fixFindings', { count: view.review.blocking.length });
        }
        return withKey({
            actor: 'human', action: 'approve-gate', gate: 'review', workflow: 'review',
            cli: approveCli(view.change, 'review'),
        }, review.status === 'stale' ? 'next.reviewReapprove' : 'next.reviewApprove');
    }
    const release = gate(view, 'release');
    if (config.gates.release.required && !release.satisfied) {
        if (!isFile(path.join(view.dir, 'release.md'))) {
            return withKey({ actor: 'agent', action: 'release', workflow: 'release' }, 'next.releasePrepare');
        }
        return withKey({
            actor: 'human', action: 'approve-gate', gate: 'release', workflow: 'release',
            cli: approveCli(view.change, 'release'),
        }, 'next.releaseApprove');
    }
    return withKey({
        actor: 'agent', action: 'archive', workflow: 'archive',
        cli: `sdlc archive ${view.change} --yes`,
    }, 'next.archive');
}
