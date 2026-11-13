import { boardTaskListing, claimTask, heartbeatClaim, releaseClaim, submitClaim } from './board.js';
import { bidTask } from './board-market.js';
import { git } from './git.js';
import { runPrepared } from '../plugins/evaluation.js';
export function publicClaim(claim) {
    const { change: _change, task: _task, branch: _branch, head: _head, releasedAt: _releasedAt, expiredAt: _expiredAt, ...view } = claim;
    return view;
}
export async function listBoard(ctx, change, actor) {
    const { root, paths, config } = ctx;
    const listing = boardTaskListing(root, paths, config, change);
    const status = git(root, ['status', '--porcelain', '--', 'openspec/.sdlc/log.jsonl']);
    return { ...listing, uncommittedLog: status.ok && status.stdout.length > 0 };
}
export function claimBoard(ctx, input, actor) {
    return runPrepared(ctx.root, ctx.config, { operation: 'claim', args: input, actor, board: true }, () => claimTask(ctx.root, ctx.paths, ctx.config, input));
}
export function heartbeatBoard(ctx, input, actor) {
    return runPrepared(ctx.root, ctx.config, { operation: 'heartbeat', args: input, actor, board: true }, () => heartbeatClaim(ctx.root, ctx.config, input.claim, input.executor, input.request));
}
export function releaseBoard(ctx, input, actor) {
    return runPrepared(ctx.root, ctx.config, { operation: 'release', args: input, actor, board: true }, () => releaseClaim(ctx.root, ctx.config, input.claim, input.note, input.executor, input.request));
}
export function submitBoard(ctx, input, actor) {
    return runPrepared(ctx.root, ctx.config, { operation: 'submit', args: input, actor, board: true }, () => submitClaim(ctx.root, ctx.paths, ctx.config, input.claim, input.branch, input.base, input.executor, input.request));
}
export function bidBoard(ctx, input, actor) {
    return runPrepared(ctx.root, ctx.config, { operation: 'bid', args: input, actor, board: true }, () => bidTask(ctx.root, ctx.paths, ctx.config, input));
}
