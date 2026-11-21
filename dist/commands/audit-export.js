import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { writeEvidenceBundle } from '../core/evidence-export.js';
import { t } from '../core/i18n.js';
import { parseSince, projectName } from '../report/model.js';
import { staleOutputWarnings, warnStaleOutput } from './out-inside-warning.js';
/** `sdlc audit --export <dir> [--since <date>] [--change <id>] [--json]` (B21): anyone may run it. */
export function auditExportCommand(opts) {
    try {
        if (opts.export === undefined) {
            throw new SdlcError('invalid_option', { key: 'error.since_needs_export' });
        }
        const ctx = loadProject();
        const project = { root: ctx.root, paths: ctx.paths, stamp: ctx.stamp, name: projectName(ctx.root) };
        const since = parseSince(opts.since);
        const summary = writeEvidenceBundle(project, { dir: opts.export, since, change: opts.change });
        if (opts.json) {
            const warnings = staleOutputWarnings(ctx.root, summary.dir, { folder: true, locale: 'en' });
            printJson({ export: summary, warnings });
            return;
        }
        line(t('audit.exported', { ...summary }));
        warnStaleOutput(ctx.root, summary.dir, { folder: true });
    }
    catch (error) {
        reportFailure(error, opts.json, { export: null });
    }
}
