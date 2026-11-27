import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin } from './fs-utils.js';
import { copyDecision } from './policy-spellings.js';
import { exactPaths, exactValues } from './shell-exact-values.js';
/**
 * The copy check of the command as written, with exact values followed (B318). A copy refused because a variable
 * part could not be read is judged again on the spelling with each exact value written out, so every path check
 * meets the copy as if the person had typed the path. The refusal stands when there is no exact value, or when a
 * path through one leads outside the project but resolves into it through a link or a junction.
 */
function nearestReal(target) {
    let probe = target;
    while (!fs.existsSync(probe)) {
        const parent = path.dirname(probe);
        if (parent === probe)
            return undefined;
        probe = parent;
    }
    try {
        return fs.realpathSync.native(probe);
    }
    catch {
        return undefined;
    }
}
/** True when `target` is outside `root` as written but its nearest existing part is inside it physically. */
function leadsBackInside(root, cwd, target) {
    const written = path.resolve(cwd, target);
    if (isWithin(root, written))
        return false;
    const real = nearestReal(written);
    const realRoot = nearestReal(root);
    return real === undefined || realRoot === undefined || isWithin(realRoot, real);
}
export function exactCopyDecision(command, root, cwd) {
    const direct = copyDecision(command, root, cwd);
    if (!direct)
        return undefined;
    const exact = exactValues(command);
    if (!exact)
        return direct;
    if (exactPaths(command, exact).some((target) => leadsBackInside(root, cwd, target)))
        return direct;
    return copyDecision(exact.spelling, root, cwd);
}
