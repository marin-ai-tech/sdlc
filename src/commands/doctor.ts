import { c, line, printJson, reportFailure } from '../cli/output.js';
import { doctorChecks, type DoctorCheck } from '../core/doctor.js';
import { currentLocale, t, type Locale } from '../core/i18n.js';
import { REQUIRED_NOTICE } from '../core/license.js';
import { findProjectRoot } from '../core/project.js';
import { doctorFix, type DoctorFixResult } from './doctor-fix.js';

function printChecks(checks: DoctorCheck[], loc: Locale): void {
  line(c.dim(REQUIRED_NOTICE));
  for (const ch of checks) {
    const icon = ch.status === 'ok' ? c.green('✓') : ch.status === 'warn' ? c.yellow('!') : c.red('✗');
    line(`${icon} ${ch.check.padEnd(16)} ${ch.message}`);
    if (ch.fix && ch.status !== 'ok') {
      line(`  ${''.padEnd(16)} ${c.dim(t('doctor.fixLabel', { fix: ch.fix }, loc))}`);
    }
  }
}

/** After --fix: one line per repaired check, then the checks left to a person. */
function printFixes(result: DoctorFixResult, loc: Locale): void {
  line();
  if (result.fixed.length === 0) line(t('doctor.fixedNone', undefined, loc));
  for (const name of result.fixed) line(`${c.green('✓')} ${t('doctor.fixed', { check: name }, loc)}`);
  if (result.manual.length === 0) return;
  line(c.bold(t('doctor.leftToYou', undefined, loc)));
  for (const item of result.manual) {
    line(item.fix ? `  - ${item.name}: ${item.fix}` : `  - ${item.name}`);
  }
}

function runChecks(fix: boolean | undefined, loc: Locale): { checks: DoctorCheck[]; fixes?: DoctorFixResult } {
  const root = findProjectRoot();
  if (!fix) return { checks: doctorChecks({ root, locale: loc }) };
  const fixes = doctorFix(root, loc);
  return { checks: fixes.checks, fixes };
}

export async function doctorCommand(opts: { json?: boolean; fix?: boolean }): Promise<void> {
  try {
    // JSON payloads stay English in every locale; text uses the active locale.
    const loc: Locale = opts.json ? 'en' : currentLocale();
    const { checks, fixes } = runChecks(opts.fix, loc);
    const errors = checks.filter((ch) => ch.status === 'error').length;
    const fixJson = fixes ? { fixed: fixes.fixed, manual: fixes.manual } : {};
    if (opts.json) printJson({ healthy: errors === 0, checks, ...fixJson });
    else printChecks(checks, loc);
    if (!opts.json && fixes) printFixes(fixes, loc);
    if (errors > 0) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
