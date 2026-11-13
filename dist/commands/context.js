import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { t } from '../core/i18n.js';
import { pullContextSources } from '../mcp/context-pull.js';
/** The text output: one line per pulled or failed source, or a note when nothing is configured. */
function printPull(result) {
    for (const item of result.pulled)
        line(`${c.green('✓')} ${t('context.pullWrote', { file: item.file })}`);
    for (const item of result.failed) {
        line(`${c.red('✗')} ${t('context.pullFailed', { name: item.name, reason: item.reason })}`);
    }
    if (result.pulled.length === 0 && result.failed.length === 0)
        line(t('context.noSources'));
}
/**
 * `sdlc context pull [--name <name>] [--json]` (B101): packs pulled from the team's knowledge servers into
 * `docs/context/`. Anyone may run it, an agent too: it only writes documentation files and never touches state.
 * JSON: `{ pulled: [{ name, file }], failed: [{ name, reason }] }`; the exit code is 1 when a source failed.
 */
export async function contextPullCommand(opts) {
    try {
        const ctx = loadProject();
        const result = await pullContextSources(ctx.root, ctx.config, opts.name);
        if (result.failed.length > 0)
            process.exitCode = 1;
        if (opts.json)
            return printJson(result);
        printPull(result);
    }
    catch (error) {
        reportFailure(error, opts.json, { pulled: [], failed: [] });
    }
}
