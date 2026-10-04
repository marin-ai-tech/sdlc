import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { SdlcError } from '../core/errors.js';
import { isWithin, writeTextAtomic } from '../core/fs-utils.js';
import { buildReport } from '../report/model.js';
import { renderReportMarkdown } from '../report/markdown.js';
import { renderReportHtml } from '../report/html.js';
import { t } from '../core/i18n.js';

export function reportCommand(opts: { format?: string; json?: boolean; since?: string; change?: string; out?: string }): void {
  const format = opts.json ? 'json' : opts.format ?? 'md';
  try {
    if (!(['md', 'json', 'html'] as string[]).includes(format)) throw new SdlcError(
      'invalid_option',
      { key: 'error.unknown_report_format_x', params: { format: format } }
    );
    const ctx = loadProject();
    const model = buildReport(ctx, { since: opts.since, change: opts.change });
    const content = format === 'json' ? JSON.stringify(model, null, 2) : format === 'html' ? renderReportHtml(model) : renderReportMarkdown(model);
    if (opts.out) {
      const target = path.resolve(ctx.root, opts.out);
      if (!isWithin(ctx.root, target)) throw new SdlcError(
        'invalid_option',
        { key: 'error.out_must_stay_inside_the_project' }
      );
      writeTextAtomic(target, `${content}\n`);
      line(t('report.written', { path: target }));
    } else if (format === 'json') printJson(model);
    else line(content);
  } catch (error) { reportFailure(error, format === 'json' && !opts.out); }
}
