import type { DoctorCheck } from './doctor.js';
import { t } from './i18n.js';
import { readLoops } from './loop-budget.js';

export function loopChecks(root: string): DoctorCheck[] {
  return readLoops(root).invalid.map((key) => ({
    check: `loops ${key}`,
    status: 'error',
    message: t('doctor.loopsInvalid', { key }),
    fix: t('doctor.fix.loopsInvalid', { key }),
  }));
}
