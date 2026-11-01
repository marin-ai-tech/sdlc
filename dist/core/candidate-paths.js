import * as path from 'node:path';
import { isWithin, toPosix } from './fs-utils.js';
import { git } from './git.js';
import { SdlcError } from './errors.js';
/** Preserve Git-top spelling in evidence; translate only the policy's comparison coordinates. */
export function candidatePathMapper(root) {
    const top = git(root, ['rev-parse', '--show-toplevel']);
    if (!top.ok || !top.stdout)
        throw new SdlcError('diff_unavailable', 'Cannot locate the Git top level.');
    return (file) => {
        const absolute = path.resolve(top.stdout, file);
        return isWithin(root, absolute) ? toPosix(path.relative(root, absolute)) : undefined;
    };
}
