import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { failingReleaseChecks, releaseChecks, runReleaseChecks } from '../mcp/release-checks.js';
/** The JSON answer's `mcp`: each check with the server's answer (masked). */
function checksJson(outcomes) {
    return outcomes.map(({ name, server, tool, ok, reason, result }) => ({ name, server, tool, ok, ...(reason === undefined ? {} : { reason }), result }));
}
function printChecks(outcomes) {
    for (const check of outcomes) {
        const call = c.dim(`(${check.server}/${check.tool}, ${(check.duration_ms / 1000).toFixed(1)}s)`);
        line(`${check.ok ? c.green('✓') : c.red('✗')} ${check.name} ${call}`);
        if (check.reason)
            line(c.dim(`    ${check.reason}`));
    }
}
/**
 * `sdlc release check --change <id>` (B47): runs the release checks without approving, so whoever prepares the
 * release (a person or an agent) sees beforehand what `sdlc approve release` will meet. It writes nothing; exit 1
 * when a required check fails.
 */
export async function releaseCheckCommand(opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, opts.change);
        const none = releaseChecks(ctx.config).length === 0;
        const outcomes = none ? [] : await runReleaseChecks(ctx.config, ctx.root, ref.id);
        const failing = failingReleaseChecks(outcomes);
        if (failing.length > 0)
            process.exitCode = 1;
        if (opts.json)
            return printJson({ change: ref.id, mcp: checksJson(outcomes) });
        if (none)
            return line(t('release.noChecks', { change: ref.id }));
        printChecks(outcomes);
        const failed = c.red(t('release.checksFailed', { count: failing.length }));
        line(failing.length > 0 ? failed : c.green(t('release.checksPassed')));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
