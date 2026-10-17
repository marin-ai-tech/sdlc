import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { boardTasks, claimTask, heartbeatClaim, releaseClaim, submitClaim, } from '../core/board.js';
import { reopenTask } from '../core/board-reopen.js';
import { dispatchTask } from '../core/board-dispatch.js';
import { openAuction, bidTask, awardTask } from '../core/board-market.js';
import { t } from '../core/i18n.js';
export function boardDispatchCommand(opts) {
    try {
        const ctx = loadProject();
        const dispatch = dispatchTask(ctx.root, ctx.paths, ctx.config, opts);
        if (opts.json) {
            printJson({ dispatch });
            return;
        }
        line(t('board.dispatch.done', {
            item: dispatch.item, executor: dispatch.executor, at: dispatch.expiresAt,
        }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardAuctionCommand(opts) {
    try {
        const ctx = loadProject();
        const auction = openAuction(ctx.root, ctx.paths, ctx.config, opts);
        if (opts.json)
            printJson({ auction });
        else
            line(t('board.auction.done', { item: auction.item, at: auction.closesAt }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardBidCommand(opts) {
    try {
        const ctx = loadProject();
        const bid = bidTask(ctx.root, ctx.paths, ctx.config, opts);
        if (opts.json)
            printJson({ bid });
        else
            line(t('board.bid.done', { executor: bid.executor, minutes: String(bid.minutes) }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardAwardCommand(opts) {
    try {
        const ctx = loadProject();
        const dispatch = awardTask(ctx.root, ctx.paths, ctx.config, opts);
        if (opts.json)
            printJson({ dispatch });
        else
            line(t('board.award.done', { item: dispatch.item, executor: dispatch.executor }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
/** The claim as the JSON output shows it: everything but the internal change/task duplication. */
function publicClaim(claim) {
    return {
        id: claim.id, item: claim.item, executor: claim.executor, agent: claim.agent,
        claimedAt: claim.claimedAt, expiresAt: claim.expiresAt, leaseSeconds: claim.leaseSeconds,
        state: claim.state,
        ...(claim.reason ? { reason: claim.reason, reopenedAt: claim.reopenedAt, escalate: claim.escalate } : {}),
    };
}
export function boardListCommand(opts) {
    try {
        const ctx = loadProject();
        const tasks = boardTasks(ctx.root, ctx.paths, ctx.config, opts.change);
        if (opts.json) {
            printJson({ tasks });
            return;
        }
        if (tasks.length === 0) {
            line(t('board.list.empty'));
            return;
        }
        line(t('board.list.heading'));
        for (const task of tasks) {
            const who = task.executor === undefined ? '' : `  ${task.executor}/${task.agent ?? '?'}`;
            const until = task.expiresAt === undefined ? '' : `  ${t('board.list.until', { at: task.expiresAt })}`;
            const attempts = task.attempts === undefined ? '' : `  ${t('board.list.attempts', {
                count: String(task.attempts), reason: task.lastReason ?? '',
            })}`;
            const excluded = task.excluded === undefined ? '' : `  ${t('board.list.excluded', {
                executors: task.excluded.join(', '),
            })}`;
            line(`  ${task.id}  ${task.status}${who}${until}${attempts}${excluded}`);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardClaimCommand(opts) {
    try {
        const ctx = loadProject();
        const { claim, item } = claimTask(ctx.root, ctx.paths, ctx.config, opts);
        if (opts.json) {
            printJson({ claim: publicClaim(claim), item });
            return;
        }
        line(t('board.claim.done', {
            item: claim.item, executor: claim.executor, agent: claim.agent, at: claim.expiresAt,
        }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardHeartbeatCommand(opts) {
    try {
        const ctx = loadProject();
        const claim = heartbeatClaim(ctx.root, ctx.config, opts.claim, opts.executor, opts.request);
        if (opts.json) {
            printJson({ claim: publicClaim(claim) });
            return;
        }
        line(t('board.heartbeat.done', { item: claim.item, at: claim.expiresAt }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardReleaseCommand(opts) {
    try {
        const ctx = loadProject();
        const claim = releaseClaim(ctx.root, ctx.config, opts.claim, opts.note, opts.executor, opts.request);
        if (opts.json) {
            printJson({ claim: publicClaim(claim) });
            return;
        }
        line(t('board.release.done', { item: claim.item }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function problemDetail(problem) {
    if (problem.file !== undefined)
        return problem.file;
    if (problem.task !== undefined)
        return `${problem.sha?.slice(0, 10)} ${problem.task}`;
    return problem.executor ?? problem.sha ?? '';
}
export function boardSubmitCommand(opts) {
    try {
        const ctx = loadProject();
        const { claim, result } = submitClaim(ctx.root, ctx.paths, ctx.config, opts.claim, opts.branch, opts.base, opts.executor, opts.request);
        if (!result.ok)
            process.exitCode = 1;
        if (opts.json) {
            printJson({ claim: publicClaim(claim), result });
            return;
        }
        if (result.ok) {
            line(t('board.submit.done', { item: claim.item, branch: claim.branch ?? opts.branch }));
            return;
        }
        line(t('task.check.problems', { count: result.problems.length }));
        for (const problem of result.problems) {
            line(`  ${t('task.issue', { code: problem.code, detail: problemDetail(problem) })}`);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export function boardReopenCommand(opts) {
    try {
        const ctx = loadProject();
        const claim = reopenTask(ctx.root, ctx.paths, ctx.config, opts);
        if (opts.json) {
            printJson({ claim: publicClaim(claim) });
            return;
        }
        line(t('board.reopen.done', { item: claim.item, reason: claim.reason ?? '' }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
