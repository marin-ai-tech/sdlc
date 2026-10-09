import { line } from './output.js';
import { recordAwaiting } from '../core/awaiting.js';
import { listActiveChanges, resolveChange } from '../core/changes.js';
import { nextBacklogItem, readBacklog } from '../core/backlog.js';
import { t } from '../core/i18n.js';
import { evaluateChange } from '../core/lifecycle.js';
/** Workflow slash form for the configured agent tools. */
export function workflowInvocation(ctx, workflow) {
    if (ctx.config.tools.includes('claude'))
        return `/sdlc:${workflow}`;
    return `/sdlc-${workflow}`;
}
/** Prefer configured cli prefix over the hardcoded `sdlc` in lifecycle.next.cli. */
export function withCliPrefix(cli, prefix) {
    return cli.replace(/^sdlc\b/, prefix);
}
function backlogHint(ctx) {
    const item = nextBacklogItem(readBacklog(ctx.root));
    if (!item)
        return undefined;
    const params = { id: item.id, title: item.title };
    return {
        actor: 'agent',
        action: 'start-backlog-item',
        item: item.id,
        key: 'next.startBacklog',
        params,
        message: t('next.startBacklog', params, 'en'),
        cli: `${ctx.config.cli} backlog start ${item.id}`,
    };
}
/** The change's next step; a gate that now waits for a person is recorded in the project log. */
function changeNext(ctx, ref) {
    const view = evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true });
    recordAwaiting(ctx.root, ctx.config, view, ctx.stamp);
    if (view.next.actor === 'none')
        return undefined;
    return view.next;
}
/**
 * Next action for a change id, or (with no id) the first active change /
 * ready backlog item — same sources as `sdlc next` / evaluateChange.next.
 */
export function resolveNext(ctx, changeId) {
    if (changeId)
        return changeNext(ctx, resolveChange(ctx.paths, changeId, { allowArchived: true }));
    const active = listActiveChanges(ctx.paths);
    if (active.length > 0)
        return changeNext(ctx, active[0]);
    return backlogHint(ctx);
}
function nextMessage(next) {
    if (next.key)
        return t(next.key, next.params);
    return next.message;
}
/** Last-line text: `Next: agent — …` or `Next: person — …`. */
export function formatNextLine(ctx, next) {
    if (next.actor === 'none')
        return undefined;
    const message = nextMessage(next);
    if (next.actor === 'human') {
        if (!next.cli)
            return undefined;
        const cmd = withCliPrefix(next.cli, ctx.config.cli);
        return t('next.personCmd', { message: message.replace(/[.\s]+$/, ''), cmd });
    }
    let how = '';
    if (next.workflow)
        how = workflowInvocation(ctx, next.workflow);
    else if (next.cli)
        how = withCliPrefix(next.cli, ctx.config.cli);
    if (how)
        return t('next.agentHow', { message, how });
    return t('next.agent', { message });
}
/** Print the Next: line (text mode). Returns the hint for JSON callers. */
export function emitNextHint(ctx, changeId) {
    const next = resolveNext(ctx, changeId);
    if (!next)
        return undefined;
    const text = formatNextLine(ctx, next);
    if (text)
        line(text);
    return next;
}
