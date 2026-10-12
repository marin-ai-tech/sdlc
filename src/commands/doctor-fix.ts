import { loadConfig, type SdlcConfig } from '../core/config.js';
import { doctorChecks, type DoctorCheck } from '../core/doctor.js';
import { isFile } from '../core/fs-utils.js';
import { t, type Locale } from '../core/i18n.js';
import { projectPaths } from '../core/project.js';
import { installGitHook } from '../integrations/git-hook.js';
import { applyUpdate, configuredTools, ensureReviewPolicy } from './setup.js';

/**
 * `sdlc doctor --fix` (B105): applies only the fixes that are safe because sdlc owns what they write, then runs the
 * checks again. Safe: what `sdlc update` restores without --force (missing generated files, an outdated harness
 * stamp; an edited generated file is kept), sdlc's own git hook when it is missing or older (a hook of the project's
 * own is never touched), and the starter REVIEW.md when there is none. Everything else is left to a person.
 */

/** A check still not ok after the fixes, with its hint. */
export interface ManualFix {
  name: string;
  fix?: string;
}

export interface DoctorFixResult {
  /** The checks after the fixes. */
  checks: DoctorCheck[];
  /** Names of the checks the fixes repaired. */
  fixed: string[];
  /** The checks left to a person. */
  manual: ManualFix[];
}

function findCheck(checks: DoctorCheck[], name: string): DoctorCheck | undefined {
  return checks.find((check) => check.check === name);
}

/** A check whose own hint is `sdlc update`: missing generated files, an outdated stamp, a missing or older hook. */
function wantsUpdate(check: DoctorCheck | undefined, loc: Locale): boolean {
  if (check === undefined || check.status === 'ok') return false;
  return check.fix === t('doctor.fix.update', undefined, loc);
}

/** The review policy check warns only when the file is missing. */
function wantsReviewPolicy(check: DoctorCheck | undefined): boolean {
  return check !== undefined && check.status !== 'ok';
}

/** sdlc.yaml when it is there and readable: without it there is nothing sdlc can repair on its own. */
function readConfig(root: string): SdlcConfig | undefined {
  const file = projectPaths(root).sdlcConfig;
  if (!isFile(file)) return undefined;
  try {
    return loadConfig(file);
  } catch {
    return undefined;
  }
}

/** Applies the safe fixes the checks call for; returns the names of the checks it acted on. */
function applySafeFixes(root: string, config: SdlcConfig, before: DoctorCheck[], loc: Locale): string[] {
  const acted: string[] = [];
  const tools = configuredTools(config);
  const generated = wantsUpdate(findCheck(before, 'generated files'), loc);
  if (generated) {
    applyUpdate(root, config, tools);
    acted.push('generated files');
  }
  if (wantsUpdate(findCheck(before, 'git hook'), loc)) {
    // The update path above installs the hook too; on its own, only the hook is written.
    if (!generated) installGitHook(root, { tools });
    acted.push('git hook');
  }
  if (wantsReviewPolicy(findCheck(before, 'review policy'))) {
    ensureReviewPolicy(root, config);
    acted.push('review policy');
  }
  return acted;
}

/** A check counts as repaired when it is ok now or no longer asks for the fix that was applied. */
function repaired(name: string, before: DoctorCheck[], after: DoctorCheck[]): boolean {
  const was = findCheck(before, name);
  const now = findCheck(after, name);
  if (now === undefined || now.status === 'ok') return true;
  return was !== undefined && (now.status !== was.status || now.fix !== was.fix);
}

function manualFixes(checks: DoctorCheck[]): ManualFix[] {
  const open = checks.filter((check) => check.status !== 'ok');
  return open.map((check) => ({ name: check.check, ...(check.fix ? { fix: check.fix } : {}) }));
}

/** Runs the checks, applies the safe fixes, runs the checks again. */
export function doctorFix(root: string | undefined, loc: Locale): DoctorFixResult {
  const before = doctorChecks({ root, locale: loc });
  const config = root === undefined ? undefined : readConfig(root);
  if (root === undefined || config === undefined) {
    return { checks: before, fixed: [], manual: manualFixes(before) };
  }
  const acted = applySafeFixes(root, config, before, loc);
  const after = doctorChecks({ root, locale: loc });
  const fixed = acted.filter((name) => repaired(name, before, after));
  return { checks: after, fixed, manual: manualFixes(after) };
}
