import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { healthReport, runHealth } from '../core/health/index.js';
import { recordHealthSignals } from '../core/health/signal.js';
import { currentLocale, t } from '../core/i18n.js';
function badge(finding) {
    const word = t(`health.level.${finding.level}`);
    if (finding.level === 'bad')
        return c.red(`✗ ${word}`);
    if (finding.level === 'warn')
        return c.yellow(`! ${word}`);
    return c.dim(`i ${word}`);
}
function printFinding(finding) {
    line(`${badge(finding)} ${c.bold(finding.title)} ${c.dim(`(${finding.id})`)}`);
    for (const fact of finding.facts)
        line(`    - ${fact}`);
    line(`    ${t('health.recommendationLabel', { text: finding.recommendation })}`);
}
function printText(report) {
    line(c.bold(t('health.heading', { ...report.counts })));
    if (report.findings.length === 0) {
        line(t('health.none'));
        return;
    }
    for (const finding of report.findings)
        printFinding(finding);
}
/** `sdlc health [--json]`: advice, not a gate. Exit 0 always; an invalid configuration is the usual failure. */
export function healthCommand(opts) {
    try {
        const ctx = loadProject();
        // JSON payloads stay English in every locale; text uses the active locale.
        const locale = opts.json ? 'en' : currentLocale();
        const run = runHealth(ctx.root, ctx.paths, ctx.config, { locale });
        // B67: a bad finding that appears is logged as health.degraded, one that is gone as health.recovered.
        recordHealthSignals(ctx.root, ctx.config, run, ctx.stamp);
        const report = healthReport(run.drafts, locale);
        if (opts.json)
            printJson({ ...report, harness: ctx.stamp });
        else
            printText(report);
    }
    catch (error) {
        reportFailure(error, opts.json, { findings: null });
    }
}
