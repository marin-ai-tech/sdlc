import { c, line, printJson, reportFailure } from '../cli/output.js';
import { doctorChecks, type DoctorCheck } from '../core/doctor.js';
import { currentLocale, t, type Locale } from '../core/i18n.js';
import { REQUIRED_NOTICE } from '../core/license.js';
import { findProjectRoot } from '../core/project.js';

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

export async function doctorCommand(opts: { json?: boolean }): Promise<void> {
  try {
    // JSON payloads stay English in every locale; text uses the active locale.
    const loc: Locale = opts.json ? 'en' : currentLocale();
    const checks = doctorChecks({ root: findProjectRoot(), locale: loc });
    const errors = checks.filter((ch) => ch.status === 'error').length;
    if (opts.json) printJson({ healthy: errors === 0, checks });
    else printChecks(checks, loc);
    if (errors > 0) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
