import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { isWithin, writeTextAtomic } from '../core/fs-utils.js';
import { buildReport } from '../report/model.js';
import { warnStaleOutput } from './out-inside-warning.js';
import { renderReportMarkdown } from '../report/markdown.js';
import { renderReportHtml } from '../report/html.js';
import { t } from '../core/i18n.js';
const REPORT_FORMATS = ['md', 'json', 'html'];
/** The report of the project in `ctx`, rendered as md, json or html. */
export function renderReport(ctx, opts, format) {
    const model = buildReport(ctx, { since: opts.since, change: opts.change });
    if (format === 'json')
        return JSON.stringify(model, null, 2);
    if (format === 'html')
        return renderReportHtml(model);
    return renderReportMarkdown(model);
}
/** The absolute path `--out` names, resolved against the project root; it must stay inside the project. */
export function reportTarget(root, out) {
    const target = path.resolve(root, out);
    if (!isWithin(root, target)) {
        throw new SdlcError('invalid_option', { key: 'error.out_must_stay_inside_the_project' });
    }
    return target;
}
/**
 * Renders the report and writes it to `out`; returns the absolute path written. It prints nothing: the caller
 * reports the write and warns about output inside the project (B103: `dashboard --watch` warns once).
 */
export function writeReport(ctx, opts, format) {
    const content = renderReport(ctx, opts, format);
    const target = reportTarget(ctx.root, opts.out);
    writeTextAtomic(target, `${content}\n`);
    return target;
}
function checkFormat(format) {
    if (REPORT_FORMATS.includes(format))
        return;
    throw new SdlcError('invalid_option', { key: 'error.unknown_report_format_x', params: { format: format } });
}
export function reportCommand(opts) {
    const format = opts.json ? 'json' : opts.format ?? 'md';
    try {
        checkFormat(format);
        const ctx = loadProject();
        if (opts.out) {
            const target = writeReport(ctx, { ...opts, out: opts.out }, format);
            line(t('report.written', { path: target }));
            warnStaleOutput(ctx.root, target);
        }
        else if (format === 'json') {
            printJson(buildReport(ctx, { since: opts.since, change: opts.change }));
        }
        else {
            line(renderReport(ctx, opts, format));
        }
    }
    catch (error) {
        reportFailure(error, format === 'json' && !opts.out);
    }
}
