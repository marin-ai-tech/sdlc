import { currentLocale, t } from '../core/i18n.js';
import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { LICENSE_FIELD, LICENSE_TYPES, saveConfig, type LicenseType } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { isFile } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { effectiveLicense, harnessStamp, LICENSE_TERMS, REQUIRED_NOTICE, stampTextLocalized } from '../core/license.js';
import { appendLog, LOG_PATH } from '../core/log.js';
import { harnessPackageDir } from '../core/openspec-schema.js';
import { assessLicense, detectProjectLicense } from '../core/project-license.js';
import { refreshGeneratedFiles } from '../integrations/install.js';
import { assertHuman } from './gates.js';

export interface LicenseOptions {
  agreement?: string;
  licensee?: string;
  json?: boolean;
}

/**
 * `sdlc license` shows the sdlc version, the license the project uses sdlc
 * under, and whether that fits the project; `sdlc license set` records a
 * change of license (a human decision) and refreshes the generated files'
 * notices so logs, artifacts and agent files all name the license in force.
 */
export async function licenseCommand(action: string | undefined, type: string | undefined, opts: LicenseOptions): Promise<void> {
  try {
    if (action === undefined || action === 'show') return showLicense(opts);
    if (action === 'set') return setLicense(type, opts);
    throw new SdlcError(
      'invalid_action',
      { key: 'error.unknown_action_x', params: { action: action } },
      { key: 'fix.use_sdlc_license_or_sdlc_license_set_community_c' }
    );
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

function legalFiles(): { license: string; commercial: string } {
  const dir = harnessPackageDir();
  return { license: path.join(dir, 'LICENSE'), commercial: path.join(dir, 'COMMERCIAL-LICENSE.md') };
}

function showLicense(opts: LicenseOptions): void {
  const ctx = loadProject();
  const detected = detectProjectLicense(ctx.root);
  const assessment = assessLicense(
    ctx.config.license,
    detected,
    opts.json ? 'en' : currentLocale(),
  );
  const files = legalFiles();
  if (opts.json) {
    printJson({
      harness: ctx.stamp,
      license: effectiveLicense(ctx.config),
      terms: LICENSE_TERMS,
      requiredNotice: REQUIRED_NOTICE,
      project: detected ?? null,
      assessment,
      files,
    });
    return;
  }
  line(c.bold(stampTextLocalized(ctx.stamp)));
  line(t('license.declared'));
  line(t('license.projectLicense', { value: detected ? `${detected.id} (${detected.source})${detected.osi ? t('license.osiApproved') : ''}` : t('license.projectNone') }));
  line(`  ${assessment.status === 'ok' ? c.green('✓') : c.yellow('!')} ${assessment.message}`);
  if (assessment.fix && assessment.status !== 'ok') line(`    ${c.dim(assessment.fix)}`);
  line(t('license.terms', { terms: LICENSE_TERMS }));
  line(`  ${REQUIRED_NOTICE}`);
  line(t('license.files', { license: files.license, commercial: files.commercial }));
}

function setLicense(typeArg: string | undefined, opts: LicenseOptions): void {
  const ctx = loadProject();
  if (!isFile(ctx.paths.sdlcConfig)) {
    throw new SdlcError(
      'not_initialized',
      { key: 'error.this_openspec_project_has_no_openspec_sdlc_yaml' },
      { key: 'fix.run_sdlc_init_first' }
    );
  }
  assertHuman(ctx.config, 'license set');
  if (!typeArg || !(LICENSE_TYPES as readonly string[]).includes(typeArg)) {
    throw new SdlcError(
      'invalid_license',
      { key: 'error.license_type_must_be_x', params: { p1: LICENSE_TYPES.join(' or ') } },
      { key: 'fix.sdlc_license_set_community_sdlc_license_set_comm' }
    );
  }
  const type = typeArg as LicenseType;
  for (const [flag, value] of [['--agreement', opts.agreement], ['--licensee', opts.licensee]] as const) {
    if (value !== undefined && !LICENSE_FIELD.test(value)) {
      throw new SdlcError(
        'invalid_option',
        { key: 'error.x_must_be_one_line_of_at_most_120_characters_wit', params: { flag: flag } }
      );
    }
  }
  if (type === 'commercial') {
    if (!opts.agreement) {
      throw new SdlcError(
      'agreement_required',
      { key: 'error.a_commercial_license_is_recorded_with_the_id_of_' },
      { key: 'fix.sdlc_license_set_commercial_agreement_id_license' }
    );
    }
    ctx.config.license = { type, agreement: opts.agreement, ...(opts.licensee ? { licensee: opts.licensee } : {}) };
  } else {
    if (opts.agreement || opts.licensee) {
      throw new SdlcError('invalid_option', { key: 'error.agreement_and_licensee_only_apply_to_a_commercia' });
    }
    ctx.config.license = { type };
  }
  saveConfig(ctx.paths.sdlcConfig, ctx.config);
  const stamp = harnessStamp(ctx.config);
  const files = refreshGeneratedFiles(ctx.root, ctx.config);
  const by = formatIdentity(gitIdentity(ctx.root));
  appendLog(ctx.root, ctx.config, { event: 'license.set', ...(by ? { by } : {}), detail: stamp.license }, stamp);
  const assessment = assessLicense(
    ctx.config.license,
    detectProjectLicense(ctx.root),
    opts.json ? 'en' : currentLocale(),
  );
  if (opts.json) {
    printJson({ harness: stamp, license: effectiveLicense(ctx.config), assessment, files: { updated: files.updated, kept: files.kept } });
    return;
  }
  line(`${c.green('✓')} ${stampTextLocalized(stamp)}`);
  line(t('license.recorded', { log: LOG_PATH, count: files.updated.length }));
  for (const kept of files.kept) warn(t('license.keptEdited', { path: kept }));
  if (assessment.status !== 'ok') warn(`${assessment.message}. ${assessment.fix ?? ''}`.trim());
}
