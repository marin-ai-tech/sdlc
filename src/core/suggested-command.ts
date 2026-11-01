import { assertCliValue } from './cli-value.js';
import type { SdlcConfig } from './config.js';
import type { NextAction } from './lifecycle.js';
import { roleForWorkflow } from '../team/execution-role.js';

export function withCliPrefix(command: string, prefix: string): string {
  assertCliValue(prefix, 'cli');
  return command.replace(/^sdlc(?=\s|$)/, prefix);
}

/** Shared by lifecycle, report, queue and CLI presenters; it grants no decision authority. */
export function configureNext(next: NextAction, config: SdlcConfig): NextAction {
  const executionRole = next.workflow ? roleForWorkflow(config, next.workflow) : undefined;
  return { ...next,
    ...(next.cli ? { cli: withCliPrefix(next.cli, config.cli) } : {}),
    ...(executionRole ? { executionRole } : {}),
  };
}
