import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin, toPosix } from './fs-utils.js';
import { git } from './git.js';
import { SdlcError } from './errors.js';
/** Preserve Git-top spelling in evidence; translate only the policy's comparison coordinates. */
export function candidatePathMapper(root) {
    const top = git(root, ['rev-parse', '--show-toplevel']);
    if (!top.ok || !top.stdout)
        throw new SdlcError('diff_unavailable', 'Cannot locate the Git top level.');
    const physicalRoot = fs.realpathSync.native(root);
    const physicalTop = fs.realpathSync.native(top.stdout);
    const projectWithinTop = path.relative(physicalTop, physicalRoot);
    if (projectWithinTop === '..' || projectWithinTop.startsWith(`..${path.sep}`) || path.isAbsolute(projectWithinTop)) {
        throw new SdlcError('diff_unavailable', 'Cannot establish the project within its Git tree.');
    }
    // A link can make Git select a different repository from the one that contains it.
    let component = path.resolve(root);
    while (path.dirname(component) !== component) {
        const parent = path.dirname(component);
        if (fs.lstatSync(component).isSymbolicLink()) {
            const originalTop = git(parent, ['rev-parse', '--show-toplevel']);
            if (!originalTop.ok || !originalTop.stdout
                || path.relative(fs.realpathSync.native(originalTop.stdout), physicalTop) !== '') {
                throw new SdlcError('diff_unavailable', 'Cannot establish the original Git boundary through a link.');
            }
        }
        component = parent;
    }
    return (file) => {
        const absolute = path.resolve(physicalTop, file);
        return isWithin(physicalRoot, absolute) ? toPosix(path.relative(physicalRoot, absolute)) : undefined;
    };
}
