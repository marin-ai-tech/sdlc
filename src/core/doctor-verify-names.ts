import type { SdlcConfig } from './config.js';
import type { DoctorCheck } from './doctor.js';
import { t } from './i18n.js';
import { duplicateCheckNames } from './verify-names.js';
import { withPackChecks } from '../team/pack-effect.js';

/** The final names verify runs with; the project's own when the team file cannot be read (doctor reports that). */
function effectiveVerify(root: string, config: SdlcConfig): SdlcConfig['verify'] {
  try { return withPackChecks({ root, config }).config.verify; }
  catch { return config.verify; }
}

export function verifyNameChecks(root: string, config: SdlcConfig): DoctorCheck[] {
  return duplicateCheckNames(effectiveVerify(root, config)).map(({ name, keys }) => ({
    check: `verify names ${name}`,
    status: 'error',
    message: t('doctor.duplicateCheckNames', { name, keys: keys.join(', ') }),
    fix: t('doctor.fix.duplicateCheckNames'),
  }));
}
