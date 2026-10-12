import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { healthReport, runHealth, type Finding, type HealthReport } from '../core/health/index.js';
import { recordHealthSignals } from '../core/health/signal.js';
import { healthThresholds } from '../core/health/thresholds.js';
import { currentLocale, t, type Locale } from '../core/i18n.js';
import { daysWindow, requestedWindow, windowJson, type WindowOptions } from './health-window.js';

interface Options extends WindowOptions {
  json?: boolean;
}

function badge(finding: Finding): string {
  const word = t(`health.level.${finding.level}`);
  if (finding.level === 'bad') return c.red(`✗ ${word}`);
  if (finding.level === 'warn') return c.yellow(`! ${word}`);
  return c.dim(`i ${word}`);
}

function printFinding(finding: Finding): void {
  line(`${badge(finding)} ${c.bold(finding.title)} ${c.dim(`(${finding.id})`)}`);
  for (const fact of finding.facts) line(`    - ${fact}`);
  line(`    ${t('health.recommendationLabel', { text: finding.recommendation })}`);
}

function printText(report: HealthReport): void {
  line(c.bold(t('health.heading', { ...report.counts })));
  if (report.findings.length === 0) {
    line(t('health.none'));
    return;
  }
  for (const finding of report.findings) printFinding(finding);
}

/**
 * `sdlc health [--since <date> | --days <n>] [--json]`: advice, not a gate. Exit 0 always; an invalid configuration
 * or option is the usual failure.
 */
export function healthCommand(opts: Options): void {
  try {
    const ctx = loadProject();
    // JSON payloads stay English in every locale; text uses the active locale.
    const locale: Locale = opts.json ? 'en' : currentLocale();
    const now = new Date();
    const requested = requestedWindow(opts, now);
    const window = requested ?? daysWindow(healthThresholds(ctx.config).windowDays, now);
    const run = runHealth(ctx.root, ctx.paths, ctx.config, { locale, now, window });
    // B67: a bad finding that appears is logged as health.degraded, one that is gone as health.recovered.
    // B106: a one-off window (--since, --days) records nothing, so a look at another period never flaps them.
    if (!requested) recordHealthSignals(ctx.root, ctx.config, run, ctx.stamp);
    const report = healthReport(run.drafts, locale);
    if (opts.json) printJson({ ...report, window: windowJson(window), harness: ctx.stamp });
    else printText(report);
  } catch (error) {
    reportFailure(error, opts.json, { findings: null });
  }
}
