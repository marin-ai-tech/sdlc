import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { t } from '../core/i18n.js';
import { assertNoSecretLiterals } from '../mcp/registry.js';
import { checkServers } from '../mcp/server-check.js';
import { serveStdio } from '../mcp/server.js';
/**
 * `sdlc mcp serve [--project <path>]...`: the MCP server over stdio (B13, B46). Read-only; any actor may start it.
 * A failure to start (a path that is not an sdlc project, two projects with one name) is reported on stderr only,
 * because stdout belongs to the protocol, and the exit code is not 0.
 */
export async function mcpServeCommand(opts = {}) {
    try {
        await serveStdio(process.cwd(), opts.project ?? []);
    }
    catch (error) {
        reportFailure(error, false);
    }
}
/** One server's lines: available or not, its tools, its warnings. */
function printServer(report) {
    const label = `${report.name} (${report.type})`;
    if (!report.available) {
        line(`${c.red('✗')} ${t('mcp.unavailable', { server: label, error: report.error ?? '' })}`);
        return;
    }
    line(`${c.green('✓')} ${t('mcp.available', { server: label, count: report.tools.length })}`);
    if (report.tools.length > 0)
        line(c.dim(`    ${report.tools.join(', ')}`));
    for (const warning of report.warnings)
        warn(warning);
}
/**
 * `sdlc mcp check [--json]` (B11): connects to each registry server and lists its tools. It reports and exits 0;
 * a registry with a literal secret is refused before any server is reached.
 */
export async function mcpCheckCommand(opts) {
    try {
        const ctx = loadProject();
        const servers = ctx.config.mcp?.servers ?? [];
        assertNoSecretLiterals(servers);
        const reports = await checkServers(servers);
        if (opts.json)
            return printJson({ servers: reports });
        if (reports.length === 0)
            line(t('mcp.noServers'));
        for (const report of reports)
            printServer(report);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
