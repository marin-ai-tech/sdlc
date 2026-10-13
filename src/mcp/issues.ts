import { issueNumber } from '../core/backlog-issues.js';
import { t } from '../core/i18n.js';
import type { LogEntry } from '../core/log.js';
import type { IssuesConfig } from './issues-config.js';
import { queueCalls, type QueueConfig, type QueuedCall } from './outbox.js';

/**
 * The GitHub issue calls of an archive (B93): archiving a change whose backlog item links `Issue: GH-<n>`
 * comments on the issue (the body names the change and that it was archived) and closes it (`update_issue`,
 * state closed). The calls go through the event outbox (src/mcp/outbox.ts): they are queued here and delivered
 * after the command or by `sdlc events flush` — a server that fails never fails the archive; a later flush
 * delivers them.
 */

/** What an archive needs to queue the issue calls; mirrors the fields of the log entry just written. */
export interface IssueCloseInput {
  change: string;
  /** The item's `Issue` field (`GH-<n>`). */
  issue: string;
  sdlc: string;
  license: string;
  by?: string;
}

/** The two GitHub calls an archive owes a linked issue: the comment, then the close. */
function closeCalls(issues: IssuesConfig, number: number, change: string): QueuedCall[] {
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
export function queueIssueClose(
  root: string,
  config: QueueConfig & { issues?: IssuesConfig },
  input: IssueCloseInput,
): void {
  const issues = config.issues;
  const number = issueNumber(input.issue);
  if (!issues || number === undefined) return;
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    event: 'change.archived',
    change: input.change,
    ...(input.by ? { by: input.by } : {}),
    sdlc: input.sdlc,
    license: input.license,
  };
  queueCalls(root, config, entry, closeCalls(issues, number, input.change));
}
