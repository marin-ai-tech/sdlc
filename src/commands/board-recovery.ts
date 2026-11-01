import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { recoverBoard } from '../core/board-recovery.js';
import { SdlcError } from '../core/errors.js';
import { humanCommandFix } from '../core/human-command.js';

export function boardRecoverCommand(opts: { expectOwner: string; json?: boolean }): void {
  try {
    if (agentEnvironment()) {
      throw new SdlcError('agent_cannot_recover_board', 'Board recovery requires a person in their own terminal',
        humanCommandFix('board recover'));
    }
    const ctx = loadProject();
    const result = recoverBoard(ctx.root, opts.expectOwner);
    if (opts.json) printJson(result);
    else line(result.recovered ? `Recovered board writer ${result.owner}` : 'No board writer lock remains');
  } catch (error) { reportFailure(error, opts.json); }
}
