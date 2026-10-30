import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { addBacklogItem, readBacklog } from '../core/backlog.js';
import { missingIssueItems, parseIssueList } from '../core/backlog-issues.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { t } from '../core/i18n.js';
import { appendLog } from '../core/log.js';
import { callServerTool } from '../mcp/client.js';
/**
 * `sdlc backlog import --issues` (B93): one backlog item per open issue of `issues.repo` that is not linked
 * yet, with the item's `Issue: GH-<n>` field. The issue list comes from the team's GitHub MCP server
 * (`issues.server`), so sdlc holds no token; pull requests are skipped and a second import adds nothing.
 * Anyone may run it (like `backlog add`): it imports work, it decides nothing.
 */
const LIST_ISSUES_MS = 10_000;
/** The registry server of the issues section; guarded although parseIssues already refuses an unknown name. */
function issuesServer(servers, issues) {
    const server = (servers ?? []).find((entry) => entry.name === issues.server);
    if (!server) {
        throw new SdlcError('invalid_config', { key: 'error.events_unknown_server', params: { p1: 'issues.server', server: issues.server } });
    }
    return server;
}
async function listOpenIssues(server, issues) {
    const args = { owner: issues.owner, repo: issues.repo, state: 'open' };
    const answer = await callServerTool(server, 'list_issues', args, LIST_ISSUES_MS);
    if (answer.isError) {
        throw new SdlcError('issues_list_failed', { key: 'error.issues_list_failed', params: { server: issues.server } });
    }
    return parseIssueList(answer.result);
}
export async function backlogImportIssues(opts) {
    try {
        const ctx = loadProject();
        if (opts.issues !== true) {
            throw new SdlcError('invalid_option', { key: 'error.backlog_import_needs_source' });
        }
        const issues = ctx.config.issues;
        if (!issues) {
            throw new SdlcError('issues_not_configured', { key: 'error.issues_not_configured' }, { key: 'fix.issues_not_configured' });
        }
        const listed = await listOpenIssues(issuesServer(ctx.config.mcp?.servers, issues), issues);
        const added = missingIssueItems(readBacklog(ctx.root), listed)
            .map((input) => addBacklogItem(ctx.root, input));
        appendLog(ctx.root, ctx.config, {
            event: 'backlog.imported',
            by: formatIdentity(gitIdentity(ctx.root)),
            detail: `${added.length} from ${issues.owner}/${issues.repo}`,
        }, ctx.stamp);
        if (opts.json) {
            printJson({ imported: added.length, items: added, harness: ctx.stamp });
            return;
        }
        line(t('backlog.imported', { count: added.length }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
