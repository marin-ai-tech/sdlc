import { assertCliValue } from './cli-value.js';
import { roleForWorkflow } from '../team/execution-role.js';
export function withCliPrefix(command, prefix) {
    assertCliValue(prefix, 'cli');
    return command.replace(/^sdlc(?=\s|$)/, prefix);
}
/** Shared by lifecycle, report, queue and CLI presenters; it grants no decision authority. */
export function configureNext(next, config) {
    const executionRole = next.workflow ? roleForWorkflow(config, next.workflow) : undefined;
    return { ...next,
        ...(next.cli ? { cli: withCliPrefix(next.cli, config.cli) } : {}),
        ...(executionRole ? { executionRole } : {}),
    };
}
