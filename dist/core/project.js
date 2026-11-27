import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isDirectory, isFile } from './fs-utils.js';
import { governingRoot } from './skill-root.js';
export function projectPaths(root) {
    const openspecDir = path.join(root, 'openspec');
    return {
        root,
        openspecDir,
        changesDir: path.join(openspecDir, 'changes'),
        archiveDir: path.join(openspecDir, 'changes', 'archive'),
        specsDir: path.join(openspecDir, 'specs'),
        schemasDir: path.join(openspecDir, 'schemas'),
        openspecConfig: path.join(openspecDir, 'config.yaml'),
        sdlcConfig: path.join(openspecDir, 'sdlc.yaml'),
    };
}
/** True when `dir` holds an `openspec/` planning directory (changes, specs or OpenSpec's config.yaml). */
function holdsPlanning(dir) {
    const candidate = path.join(dir, 'openspec');
    return isDirectory(candidate) && (isDirectory(path.join(candidate, 'changes')) ||
        isDirectory(path.join(candidate, 'specs')) || isFile(path.join(candidate, 'config.yaml')));
}
/**
 * Finds the nearest ancestor of `start` that holds an `openspec/` planning
 * directory, the same "nearest root" rule OpenSpec applies. A planning
 * directory inside an installed skill folder of an enclosing project does not
 * move the root (B249).
 */
export function findProjectRoot(start = process.cwd()) {
    let current = path.resolve(start);
    for (;;) {
        if (holdsPlanning(current))
            return governingRoot(current, holdsPlanning);
        const parent = path.dirname(current);
        if (parent === current)
            return undefined;
        current = parent;
    }
}
export function requireProjectRoot(start = process.cwd()) {
    const root = findProjectRoot(start);
    if (!root) {
        throw new SdlcError('no_project_root', { key: 'error.no_openspec_directory_found_in_x_or_any_parent', params: { p1: path.resolve(start) } }, { key: 'fix.run_sdlc_init_in_the_project_root_first' });
    }
    return root;
}
