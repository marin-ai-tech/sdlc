import { loadConfig } from '../core/config.js';
import { projectPaths } from '../core/project.js';
import { listBoard, claimBoard, heartbeatBoard, releaseBoard, submitBoard, bidBoard, publicClaim } from '../core/board-service.js';
import { exportTaskContract } from '../core/task-export-service.js';
import { fail, type Actor, type Extensions } from '../plugins/api.js';

export const DIRECT_TOOLS = new Set(['task_export', 'board_list', 'board_claim', 'board_heartbeat',
  'board_release', 'board_submit', 'board_bid']);

/** Only the host's authenticated caller value supplies executor identity. No CLI presenters are invoked. */
export async function callDirectTool(name: string, args: Record<string, string | undefined>, root: string,
  executor?: string, ext?: Extensions): Promise<Record<string, unknown>> {
  const paths = projectPaths(root);
  const ctx = { root, paths, config: loadConfig(paths.sdlcConfig) };
  const actor: Actor = { origin: 'mcp', ...(executor ? { executor } : {}) };
  const required = (key: string) => args[key] ?? fail('invalid_arguments', `Missing ${key}`);
  if (name === 'task_export') return exportTaskContract(ctx, { ...args, ext }, actor);
  if (name === 'board_list') {
    const { tasks, errors, uncommittedLog } = await listBoard(ctx, args.change, actor);
    return { tasks, uncommittedLog, ...(errors.length ? { errors } : {}) };
  }
  if (!executor) fail('executor_token_required', 'An authenticated executor is required');
  const claimInput = { claim: args.claim ?? '', executor, request: args.request };
  if (name === 'board_claim') {
    const { claim, item } = await claimBoard(ctx, { ...args, ext,
      task: required('task'), agent: required('agent'), executor }, actor);
    return { claim: publicClaim(claim), item };
  }
  if (name === 'board_bid') return { bid: await bidBoard(ctx, { ...args, ext,
    change: required('change'), task: required('task'), agent: required('agent'),
    minutes: required('minutes'), executor }, actor) };
  if (name === 'board_heartbeat') return { claim: publicClaim(await heartbeatBoard(ctx, claimInput, actor)) };
  if (name === 'board_release') return { claim: publicClaim(await releaseBoard(ctx,
    { ...claimInput, note: args.note }, actor)) };
  if (name === 'board_submit') {
    const { claim, result } = await submitBoard(ctx, { ...claimInput, branch: required('branch'), base: args.base }, actor);
    return { claim: publicClaim(claim), result };
  }
  return fail('unknown_tool', 'Unknown direct operation');
}
