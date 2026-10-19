import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import {
  boardTasks, claimTask, heartbeatClaim, releaseClaim, submitClaim,
} from '../core/board.js';
import type { BoardClaim } from '../core/board-store.js';
import { reopenTask } from '../core/board-reopen.js';
import { dispatchTask } from '../core/board-dispatch.js';
import { openAuction, bidTask, awardTask, type BidOptions } from '../core/board-market.js';
import { t } from '../core/i18n.js';
import { git } from '../core/git.js';
import type { ResultProblem } from '../core/task-result.js';

/**
 * `sdlc board *` (epic E16): list, dispatch, claim, heartbeat, release and submit tasks.
 * Anyone may run them, an agent too - they decide no gate
 * and write only the board's own state file, so they are not on the human-only list.
 */

interface ListOptions {
  change?: string;
  json?: boolean;
}

interface ClaimOptions {
  change?: string;
  task: string;
  executor: string;
  agent: string;
  lease?: string;
  request?: string;
  json?: boolean;
}

interface ClaimIdOptions {
  claim: string;
  executor?: string;
  request?: string;
  json?: boolean;
}

interface DispatchOptions {
  change: string;
  task: string;
  executor: string;
  lease?: string;
  json?: boolean;
}

export function boardDispatchCommand(opts: DispatchOptions): void {
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
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardAuctionCommand(opts: { change: string; task: string; window?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    const auction = openAuction(ctx.root, ctx.paths, ctx.config, opts);
    if (opts.json) printJson({ auction });
    else line(t('board.auction.done', { item: auction.item, at: auction.closesAt }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardBidCommand(opts: BidOptions & { json?: boolean }): void {
  try {
    const ctx = loadProject();
    const bid = bidTask(ctx.root, ctx.paths, ctx.config, opts);
    if (opts.json) printJson({ bid });
    else line(t('board.bid.done', { executor: bid.executor, minutes: String(bid.minutes) }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardAwardCommand(opts: { change: string; task: string; executor: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    const dispatch = awardTask(ctx.root, ctx.paths, ctx.config, opts);
    if (opts.json) printJson({ dispatch });
    else line(t('board.award.done', { item: dispatch.item, executor: dispatch.executor }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

interface ReleaseOptions extends ClaimIdOptions {
  note?: string;
}

interface SubmitOptions extends ClaimIdOptions {
  branch: string;
  base?: string;
}

interface ReopenOptions {
  change: string;
  task: string;
  reason?: string;
  escalate?: boolean;
  json?: boolean;
}

/** The claim as the JSON output shows it: everything but the internal change/task duplication. */
function publicClaim(claim: BoardClaim): Record<string, unknown> {
  return {
    id: claim.id, item: claim.item, executor: claim.executor, agent: claim.agent,
    claimedAt: claim.claimedAt, expiresAt: claim.expiresAt, leaseSeconds: claim.leaseSeconds,
    state: claim.state,
    ...(claim.reason ? { reason: claim.reason, reopenedAt: claim.reopenedAt, escalate: claim.escalate } : {}),
  };
}

export function boardListCommand(opts: ListOptions): void {
  try {
    const ctx = loadProject();
    const tasks = boardTasks(ctx.root, ctx.paths, ctx.config, opts.change);
    const status = git(ctx.root, ['status', '--porcelain', '--', 'openspec/.sdlc/log.jsonl']);
    const uncommittedLog = status.ok && status.stdout.length > 0;
    if (opts.json) {
      printJson({ tasks, uncommittedLog });
      return;
    }
    if (tasks.length === 0) {
      line(t('board.list.empty'));
      if (uncommittedLog) line(t('board.list.commitLog'));
      return;
    }
    line(t('board.list.heading'));
    for (const task of tasks) {
      const who = task.executor === undefined ? ''
        : `  ${task.executor}${task.agent === undefined ? '' : `/${task.agent}`}`;
      const until = task.expiresAt === undefined ? '' : `  ${t('board.list.until', { at: task.expiresAt })}`;
      const attempts = task.attempts === undefined ? '' : `  ${t('board.list.attempts', {
        count: String(task.attempts), reason: task.lastReason ?? '',
      })}`;
      const excluded = task.excluded === undefined ? '' : `  ${t('board.list.excluded', {
        executors: task.excluded.join(', '),
      })}`;
      line(`  ${task.id}  ${task.status}${who}${until}${attempts}${excluded}`);
    }
    if (uncommittedLog) line(t('board.list.commitLog'));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardClaimCommand(opts: ClaimOptions): void {
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
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardHeartbeatCommand(opts: ClaimIdOptions): void {
  try {
    const ctx = loadProject();
    const claim = heartbeatClaim(ctx.root, ctx.config, opts.claim, opts.executor, opts.request);
    if (opts.json) {
      printJson({ claim: publicClaim(claim) });
      return;
    }
    line(t('board.heartbeat.done', { item: claim.item, at: claim.expiresAt }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardReleaseCommand(opts: ReleaseOptions): void {
  try {
    const ctx = loadProject();
    const claim = releaseClaim(ctx.root, ctx.config, opts.claim, opts.note, opts.executor, opts.request);
    if (opts.json) {
      printJson({ claim: publicClaim(claim) });
      return;
    }
    line(t('board.release.done', { item: claim.item }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

function problemDetail(problem: ResultProblem): string {
  if (problem.file !== undefined) return problem.file;
  if (problem.task !== undefined) return `${problem.sha?.slice(0, 10)} ${problem.task}`;
  return problem.executor ?? problem.sha ?? '';
}

export function boardSubmitCommand(opts: SubmitOptions): void {
  try {
    const ctx = loadProject();
    const { claim, result } = submitClaim(
      ctx.root, ctx.paths, ctx.config, opts.claim, opts.branch, opts.base, opts.executor, opts.request,
    );
    if (!result.ok) process.exitCode = 1;
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
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function boardReopenCommand(opts: ReopenOptions): void {
  try {
    const ctx = loadProject();
    const claim = reopenTask(ctx.root, ctx.paths, ctx.config, opts);
    if (opts.json) {
      printJson({ claim: publicClaim(claim) });
      return;
    }
    line(t('board.reopen.done', { item: claim.item, reason: claim.reason ?? '' }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
