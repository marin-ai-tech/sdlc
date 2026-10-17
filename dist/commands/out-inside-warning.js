import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { warn } from '../cli/output.js';
import { isWithin, toPosix } from '../core/fs-utils.js';
import { isGitRepo } from '../core/git.js';
import { t } from '../core/i18n.js';
import { FINGERPRINT_EXCLUDES } from '../core/lifecycle.js';
/**
 * B90: `sdlc report --out`, `sdlc dashboard --out` and `sdlc audit --export <dir>` may write inside the project.
 * A path there, outside the fingerprint excludes (openspec/) and not ignored by git, is part of the worktree
 * fingerprint `sdlc verify` binds its evidence to: writing it makes the verification of every active change stale.
 * The commands still write it; they only warn and suggest .gitignore. Outside a git repository there is no
 * fingerprint, so there is no warning.
 */
/** The real path of `target` (links and short names resolved), or its resolved path when it cannot be read. */
function realPath(target) {
    try {
        return fs.realpathSync.native(target);
    }
    catch {
        return path.resolve(target);
    }
}
/** True when `target` lies under one of the folders the worktree fingerprint leaves out. */
function underFingerprintExclude(root, target) {
    return FINGERPRINT_EXCLUDES.some((exclude) => isWithin(path.join(root, exclude), target));
}
/** True when git does not ignore `rel` inside `root`: `git check-ignore -q` exits 1 (0 is ignored, 128 an error). */
function notIgnoredByGit(root, rel) {
    const result = spawnSync('git', ['check-ignore', '-q', '--', rel], { cwd: root, encoding: 'utf-8' });
    return result.status === 1;
}
/** The project-relative posix path of a written file, or of a written folder with a trailing slash. */
function shownPath(rel, isFolder) {
    const posix = toPosix(rel);
    return isFolder ? `${posix}/` : posix;
}
/** The warnings for output written at `target` (a file, or a folder): one, or none. */
export function staleOutputWarnings(root, target, options = {}) {
    const realRoot = realPath(root);
    const realTarget = realPath(target);
    if (!isWithin(realRoot, realTarget))
        return [];
    if (underFingerprintExclude(realRoot, realTarget))
        return [];
    if (!isGitRepo(realRoot))
        return [];
    const rel = path.relative(realRoot, realTarget);
    if (!notIgnoredByGit(realRoot, rel))
        return [];
    const params = { path: shownPath(rel, options.folder === true) };
    return [t('warn.outputMakesVerificationStale', params, options.locale)];
}
/** Prints the warnings for output written at `target` (see `staleOutputWarnings`). */
export function warnStaleOutput(root, target, options = {}) {
    for (const warning of staleOutputWarnings(root, target, options))
        warn(warning);
}
