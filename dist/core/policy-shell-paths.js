import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin, toPosix } from './fs-utils.js';
export function relToRoot(root, cwd, file) {
    const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
    if (isWithin(root, abs))
        return toPosix(path.relative(root, abs));
    if (process.platform !== 'win32')
        return undefined;
    try {
        const physicalRoot = fs.realpathSync.native(root);
        const physicalTarget = physicalPath(abs);
        if (physicalTarget && isWithin(physicalRoot, physicalTarget)) {
            return toPosix(path.relative(physicalRoot, physicalTarget));
        }
    }
    catch {
        return undefined;
    }
    return undefined;
}
/** Resolve existing ancestors so an absent target can still be checked against its physical project root. */
function physicalPath(target) {
    let current = path.resolve(target);
    const missing = [];
    for (;;) {
        try {
            return path.join(fs.realpathSync.native(current), ...missing);
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                return undefined;
            const parent = path.dirname(current);
            if (parent === current)
                return undefined;
            missing.unshift(path.basename(current));
            current = parent;
        }
    }
}
/** An outside-looking Windows path needs physical proof before it can be treated as outside the project. */
export function uncertainWindowsPath(root, cwd, file) {
    if (process.platform !== 'win32')
        return false;
    const absoluteFile = path.isAbsolute(file) ? file : path.resolve(cwd, file);
    if (isWithin(root, absoluteFile))
        return false;
    try {
        fs.realpathSync.native(root);
        return physicalPath(absoluteFile) === undefined;
    }
    catch {
        return true;
    }
}
