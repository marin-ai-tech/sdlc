import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { writeEvidenceBundle } from '../core/evidence-export.js';
import { t } from '../core/i18n.js';
import { parseSince, projectName } from '../report/model.js';

export interface AuditExportOptions {
  export?: string;
  since?: string;
  change?: string;
  json?: boolean;
}

/** `sdlc audit --export <dir> [--since <date>] [--change <id>] [--json]` (B21): anyone may run it. */
export function auditExportCommand(opts: AuditExportOptions): void {
  try {
    if (opts.export === undefined) {
      throw new SdlcError('invalid_option', { key: 'error.since_needs_export' });
    }
    const ctx = loadProject();
    const project = { root: ctx.root, paths: ctx.paths, stamp: ctx.stamp, name: projectName(ctx.root) };
    const since = parseSince(opts.since);
    const summary = writeEvidenceBundle(project, { dir: opts.export, since, change: opts.change });
    if (opts.json) {
      printJson({ export: summary });
      return;
    }
    line(t('audit.exported', { ...summary }));
  } catch (error) {
    reportFailure(error, opts.json, { export: null });
  }
}
