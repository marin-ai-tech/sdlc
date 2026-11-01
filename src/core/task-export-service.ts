import { resolveChange } from './changes.js';
import type { BoardContext } from './board-service.js';
import { exportTasks } from './task-contract.js';
import { harnessStamp } from './license.js';
import { runPrepared } from '../plugins/evaluation.js';
import { fail, type Actor, type Extensions } from '../plugins/api.js';

export interface ExportInput { change?: string; task?: string; executor?: string; ext?: Extensions }

export async function exportTaskContract(ctx: BoardContext, input: ExportInput, actor: Actor) {
  if (actor.origin === 'mcp' && input.executor !== undefined && input.executor !== actor.executor) {
    fail('executor_token_required', 'Export attribution requires the matching authenticated executor token');
  }
  const ref = resolveChange(ctx.paths, input.change);
  const args = { ...input, change: ref.id };
  const items = await runPrepared(ctx.root, ctx.config, { operation: 'export', board: false, args, actor },
    () => exportTasks(ctx.root, ref, ctx.config, input.task, input.executor, input.ext));
  return { items, harness: harnessStamp(ctx.config) };
}
