import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isDirectory, isFile } from './fs-utils.js';
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
/**
 * Finds the nearest ancestor of `start` that holds an `openspec/` planning
 * directory, the same "nearest root" rule OpenSpec applies.
 */
export function findProjectRoot(start = process.cwd()) {
    let current = path.resolve(start);
    for (;;) {
        const candidate = path.join(current, 'openspec');
        if (isDirectory(candidate) && (isDirectory(path.join(candidate, 'changes')) ||
            isDirectory(path.join(candidate, 'specs')) || isFile(path.join(candidate, 'config.yaml')))) {
            return current;
        }
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
