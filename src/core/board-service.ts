import type { SdlcConfig } from './config.js';
import type { ProjectPaths } from './project.js';
import type { BoardClaim } from './board-store.js';
import { boardTaskListing, claimTask, heartbeatClaim, releaseClaim, submitClaim } from './board.js';
import { bidTask, type BidOptions } from './board-market.js';
import { git } from './git.js';
import { runPrepared } from '../plugins/evaluation.js';
import type { Actor } from '../plugins/api.js';

export interface BoardContext { root: string; paths: ProjectPaths; config: SdlcConfig }
type ClaimInput = Parameters<typeof claimTask>[3];
type ClaimId = { claim: string; executor?: string; request?: string };

export function publicClaim(claim: BoardClaim): Record<string, unknown> {
  const { change: _change, task: _task, branch: _branch, head: _head, releasedAt: _releasedAt,
    expiredAt: _expiredAt, ...view } = claim;
  return view;
}

export async function listBoard(ctx: BoardContext, change: string | undefined, actor: Actor) {
  const { root, paths, config } = ctx;
  const listing = boardTaskListing(root, paths, config, change);
  const status = git(root, ['status', '--porcelain', '--', 'openspec/.sdlc/log.jsonl']);
  return { ...listing, uncommittedLog: status.ok && status.stdout.length > 0 };
}

export function claimBoard(ctx: BoardContext, input: ClaimInput, actor: Actor) {
  return runPrepared(ctx.root, ctx.config, { operation: 'claim', args: input, actor, board: true },
    () => claimTask(ctx.root, ctx.paths, ctx.config, input));
}

export function heartbeatBoard(ctx: BoardContext, input: ClaimId, actor: Actor) {
  return runPrepared(ctx.root, ctx.config, { operation: 'heartbeat', args: input, actor, board: true },
    () => heartbeatClaim(ctx.root, ctx.config, input.claim, input.executor, input.request));
}

export function releaseBoard(ctx: BoardContext, input: ClaimId & { note?: string }, actor: Actor) {
  return runPrepared(ctx.root, ctx.config, { operation: 'release', args: input, actor, board: true },
    () => releaseClaim(ctx.root, ctx.config, input.claim, input.note, input.executor, input.request));
}

export function submitBoard(ctx: BoardContext, input: ClaimId & { branch: string; base?: string }, actor: Actor) {
  return runPrepared(ctx.root, ctx.config, { operation: 'submit', args: input, actor, board: true },
    () => submitClaim(ctx.root, ctx.paths, ctx.config, input.claim, input.branch,
      input.base, input.executor, input.request));
}

export function bidBoard(ctx: BoardContext, input: BidOptions, actor: Actor) {
  return runPrepared(ctx.root, ctx.config, { operation: 'bid', args: input, actor, board: true },
    () => bidTask(ctx.root, ctx.paths, ctx.config, input));
}
