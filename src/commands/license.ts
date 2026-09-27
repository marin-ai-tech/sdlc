import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { LICENSE_FIELD, LICENSE_TYPES, saveConfig, type LicenseType } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { isFile } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { effectiveLicense, harnessStamp, LICENSE_TERMS, REQUIRED_NOTICE, stampText } from '../core/license.js';
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
 * `sdlc license` shows the scdl version, the license the project uses scdl
 * under, and whether that fits the project; `sdlc license set` records a
 * change of license (a human decision) and refreshes the generated files'
 * notices so logs, artifacts and agent files all name the license in force.
 */
export async function licenseCommand(action: string | undefined, type: string | undefined, opts: LicenseOptions): Promise<void> {
  try {
    if (action === undefined || action === 'show') return showLicense(opts);
    if (action === 'set') return setLicense(type, opts);
    throw new SdlcError('invalid_action', `Unknown action '${action}'.`, 'Use `sdlc license` or `sdlc license set community|commercial`.');
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
  const assessment = assessLicense(ctx.config.license, detected);
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
  line(c.bold(stampText(ctx.stamp)));
  line(`  declared in openspec/sdlc.yaml (license.type); change it with \`sdlc license set\``);
  line(`  project license: ${detected ? `${detected.id} (${detected.source})${detected.osi ? ', OSI-approved' : ''}` : 'none declared'}`);
  line(`  ${assessment.status === 'ok' ? c.green('✓') : c.yellow('!')} ${assessment.message}`);
  if (assessment.fix && assessment.status !== 'ok') line(`    ${c.dim(assessment.fix)}`);
  line(`  terms: ${LICENSE_TERMS}`);
  line(`  ${REQUIRED_NOTICE}`);
  line(`  license files: ${files.license}, ${files.commercial}`);
}

function setLicense(typeArg: string | undefined, opts: LicenseOptions): void {
  const ctx = loadProject();
  if (!isFile(ctx.paths.sdlcConfig)) {
    throw new SdlcError('not_initialized', 'This OpenSpec project has no openspec/sdlc.yaml.', 'Run `sdlc init` first.');
  }
  assertHuman(ctx.config, 'license set');
  if (!typeArg || !(LICENSE_TYPES as readonly string[]).includes(typeArg)) {
    throw new SdlcError('invalid_license', `License type must be ${LICENSE_TYPES.join(' or ')}.`,
      'sdlc license set community   |   sdlc license set commercial --agreement <id> --licensee "<company>"');
  }
  const type = typeArg as LicenseType;
  for (const [flag, value] of [['--agreement', opts.agreement], ['--licensee', opts.licensee]] as const) {
    if (value !== undefined && !LICENSE_FIELD.test(value)) {
      throw new SdlcError('invalid_option', `${flag} must be one line of at most 120 characters without | < >.`);
    }
  }
  if (type === 'commercial') {
    if (!opts.agreement) {
      throw new SdlcError('agreement_required', 'A commercial license is recorded with the id of its agreement.',
        'sdlc license set commercial --agreement <id> --licensee "<company>"');
    }
    ctx.config.license = { type, agreement: opts.agreement, ...(opts.licensee ? { licensee: opts.licensee } : {}) };
  } else {
    if (opts.agreement || opts.licensee) {
      throw new SdlcError('invalid_option', '--agreement and --licensee only apply to a commercial license.');
    }
    ctx.config.license = { type };
  }
  saveConfig(ctx.paths.sdlcConfig, ctx.config);
  const stamp = harnessStamp(ctx.config);
  const files = refreshGeneratedFiles(ctx.root, ctx.config);
  const by = formatIdentity(gitIdentity(ctx.root));
  appendLog(ctx.root, ctx.config, { event: 'license.set', ...(by ? { by } : {}), detail: stamp.license }, stamp);
  const assessment = assessLicense(ctx.config.license, detectProjectLicense(ctx.root));
  if (opts.json) {
    printJson({ harness: stamp, license: effectiveLicense(ctx.config), assessment, files: { updated: files.updated, kept: files.kept } });
    return;
  }
  line(`${c.green('✓')} ${stampText(stamp)}`);
  line(`  recorded in openspec/sdlc.yaml and ${LOG_PATH}; ${files.updated.length} generated file(s) updated`);
  for (const kept of files.kept) warn(`kept ${kept} (edited locally; its notice still names the previous license - \`sdlc update --force\` restores it)`);
  if (assessment.status !== 'ok') warn(`${assessment.message}. ${assessment.fix ?? ''}`.trim());
}
