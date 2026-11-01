import { issueNumber } from '../core/backlog-issues.js';
import { t } from '../core/i18n.js';
import { queueCalls } from './outbox.js';
/** The two GitHub calls an archive owes a linked issue: the comment, then the close. */
function closeCalls(issues, number, change) {
    const base = { owner: issues.owner, repo: issues.repo, issue_number: number };
    const body = t('issues.archivedComment', { change });
    const comment = { server: issues.server, tool: 'add_issue_comment', args: { ...base, body } };
    const close = { server: issues.server, tool: 'update_issue', args: { ...base, state: 'closed' } };
    return [comment, close];
}
/**
 * Queues the comment and the close of the item's issue. Nothing is queued without an `issues` section or when
 * the field is not a `GH-<n>` link: an item without an issue never causes a GitHub call.
 */
export function queueIssueClose(root, config, input) {
    const issues = config.issues;
    const number = issueNumber(input.issue);
    if (!issues || number === undefined)
        return;
    const entry = {
        ts: new Date().toISOString(),
        event: 'change.archived',
        change: input.change,
        ...(input.by ? { by: input.by } : {}),
        sdlc: input.sdlc,
        license: input.license,
    };
    queueCalls(root, config, entry, closeCalls(issues, number, input.change));
}
