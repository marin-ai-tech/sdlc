import { agentEnvironment } from './agent-env.js';
import { SdlcError } from './errors.js';
import { humanCommandFix } from './human-command.js';
import { logFile } from './log-write.js';
import { recoverWriterLock } from './writer-lock.js';

/** Recovery grants no claim or gate authority and cannot force a live/unknown writer. */
export function recoverBoard(root: string, expected: string): { recovered: boolean; owner: string } {
  if (agentEnvironment()) {
    throw new SdlcError('agent_cannot_recover_board', 'Board recovery requires a person in their own terminal',
      humanCommandFix('board recover'));
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(expected)) {
    throw new SdlcError('invalid_option', 'Expected owner must be the complete sha256 digest from doctor');
  }
  const previous = recoverWriterLock(logFile(root, 'board.lock'), expected);
  return { recovered: previous.state !== 'absent', owner: previous.digest };
}
