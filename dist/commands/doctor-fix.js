import { loadConfig } from '../core/config.js';
import { doctorChecks } from '../core/doctor.js';
import { isFile } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { projectPaths } from '../core/project.js';
import { installGitHook } from '../integrations/git-hook.js';
import { applyUpdate, configuredTools, ensureReviewPolicy } from './setup.js';
function findCheck(checks, name) {
    return checks.find((check) => check.check === name);
}
/** A check whose own hint is `sdlc update`: missing generated files, an outdated stamp, a missing or older hook. */
function wantsUpdate(check, loc) {
    if (check === undefined || check.status === 'ok')
        return false;
    return check.fix === t('doctor.fix.update', undefined, loc);
}
/** The review policy check warns only when the file is missing. */
function wantsReviewPolicy(check) {
    return check !== undefined && check.status !== 'ok';
}
/** sdlc.yaml when it is there and readable: without it there is nothing sdlc can repair on its own. */
function readConfig(root) {
    const file = projectPaths(root).sdlcConfig;
    if (!isFile(file))
        return undefined;
    try {
        return loadConfig(file);
    }
    catch {
        return undefined;
    }
}
/** Applies the safe fixes the checks call for; returns the names of the checks it acted on. */
function applySafeFixes(root, config, before, loc) {
    const acted = [];
    const tools = configuredTools(config);
    const generated = wantsUpdate(findCheck(before, 'generated files'), loc);
    if (generated) {
        applyUpdate(root, config, tools);
        acted.push('generated files');
    }
    if (wantsUpdate(findCheck(before, 'git hook'), loc)) {
        // The update path above installs the hook too; on its own, only the hook is written.
        if (!generated)
            installGitHook(root, { tools });
        acted.push('git hook');
    }
    if (wantsReviewPolicy(findCheck(before, 'review policy'))) {
        ensureReviewPolicy(root, config);
        acted.push('review policy');
    }
    return acted;
}
/** A check counts as repaired when it is ok now or no longer asks for the fix that was applied. */
function repaired(name, before, after) {
    const was = findCheck(before, name);
    const now = findCheck(after, name);
    if (now === undefined || now.status === 'ok')
        return true;
    return was !== undefined && (now.status !== was.status || now.fix !== was.fix);
}
function manualFixes(checks) {
    const open = checks.filter((check) => check.status !== 'ok');
    return open.map((check) => ({ name: check.check, ...(check.fix ? { fix: check.fix } : {}) }));
}
/** Runs the checks, applies the safe fixes, runs the checks again. */
export function doctorFix(root, loc) {
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
