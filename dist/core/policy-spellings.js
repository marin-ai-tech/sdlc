import { t } from './i18n.js';
import { stateCopyDecision } from './state-copy.js';
/**
 * The spellings of a command the path checks read: as written and, when it has a `\`, with `\` read as a separator
 * (`/./` and `//` collapsed). Windows shells, PowerShell on Linux too, write `cd .\openspec`; POSIX decoding reads
 * `.openspec`. Checking both only adds denials (0.29.0 checked the second alone).
 */
export function pathSpellings(command) {
    if (!command.includes('\\'))
        return [command];
    const normalized = command.replace(/\\/g, '/').replace(/\/(?:\.\/)+/g, '/').replace(/\/{2,}/g, '/');
    return normalized === command ? [command] : [command, normalized];
}
/**
 * A copy of a state file found only in the `\`-as-separator spelling. Only a found state file counts there: that
 * spelling breaks POSIX escapes (`source\[1\]`, quotes inside `sh -c`), so its "cannot be inspected" is not evidence.
 */
function copiedStateInSpelling(command, root, cwd) {
    const spelled = pathSpellings(command)[1];
    if (spelled === undefined)
        return undefined;
    const decision = stateCopyDecision(spelled, root, cwd);
    return decision?.reason === t('hook.stateIntegrityBash') ? decision : undefined;
}
/** The state-copy decision for the command as written, else a found state copy in its `\`-separator spelling. */
export function copyDecision(command, root, cwd) {
    return stateCopyDecision(command, root, cwd) ?? copiedStateInSpelling(command, root, cwd);
}
/** The first decision a check returns over the spellings, in order. */
export function firstDecision(spellings, check) {
    for (const spelled of spellings) {
        const decision = check(spelled);
        if (decision)
            return decision;
    }
    return undefined;
}
