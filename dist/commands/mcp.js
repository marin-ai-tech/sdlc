import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { t } from '../core/i18n.js';
import { assertNoSecretLiterals } from '../mcp/registry.js';
import { checkServers } from '../mcp/server-check.js';
import { serveHttp } from '../mcp/http.js';
import { serveStdio } from '../mcp/server.js';
/**
 * `sdlc mcp serve [--project <path>]... [--http <host:port>]`: MCP over stdio (B13, B46) or Streamable HTTP (B100).
 * Read-only; any actor may start it. HTTP always needs SDLC_MCP_TOKEN. A failure to start is reported on stderr only
 * (stdout belongs to the protocol for stdio), and the exit code is not 0.
 */
export async function mcpServeCommand(opts = {}) {
    try {
        if (opts.http !== undefined)
            await serveHttp(opts.http, process.cwd(), opts.project ?? []);
        else
            await serveStdio(process.cwd(), opts.project ?? []);
    }
    catch (error) {
        reportFailure(error, false);
    }
}
/** One tool line for `--args`: `name(arg: type, opt?: type)`. */
function formatToolWithArgs(name, args) {
    const parts = args.map((arg) => {
        const mark = arg.required ? '' : '?';
        const type = arg.type ?? 'any';
        return `${arg.name}${mark}: ${type}`;
    });
    return `${name}(${parts.join(', ')})`;
}
/** One server's lines: available or not, its tools, its warnings. */
function printServer(report, showArgs) {
    const label = `${report.name} (${report.type})`;
    if (!report.available) {
        line(`${c.red('✗')} ${t('mcp.unavailable', { server: label, error: report.error ?? '' })}`);
        return;
    }
    line(`${c.green('✓')} ${t('mcp.available', { server: label, count: report.tools.length })}`);
    if (showArgs) {
        for (const name of report.tools) {
            line(c.dim(`    ${formatToolWithArgs(name, report.args[name] ?? [])}`));
        }
    }
    else if (report.tools.length > 0) {
        line(c.dim(`    ${report.tools.join(', ')}`));
    }
    for (const warning of report.warnings)
        warn(warning);
}
/**
 * `sdlc mcp check [--json] [--strict] [--args]` (B11, B96): connects to each registry server and lists its tools.
 * With --strict, an unavailable server sets exit code 1; a registry with a literal secret is refused first.
 */
export async function mcpCheckCommand(opts) {
    try {
        const ctx = loadProject();
        const servers = ctx.config.mcp?.servers ?? [];
        assertNoSecretLiterals(servers);
        const reports = await checkServers(servers);
        if (opts.strict && reports.some((report) => !report.available)) {
            process.exitCode = 1;
        }
        if (opts.json)
            return printJson({ servers: reports });
        if (reports.length === 0)
            line(t('mcp.noServers'));
        for (const report of reports)
            printServer(report, opts.args === true);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
