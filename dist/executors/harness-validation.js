import { recordObject } from '../core/record-values.js';
function completeChecks(value, config) {
    if (!Array.isArray(value) || value.length !== config.commands.length || value.length === 0)
        return false;
    return config.commands.every((expected, index) => {
        const check = recordObject(value[index]);
        if (!check || check.name !== expected.name || check.command !== expected.run
            || check.required !== expected.required)
            return false;
        if (check.timed_out !== undefined && typeof check.timed_out !== 'boolean')
            return false;
        if (check.exit_code !== null && !Number.isInteger(check.exit_code))
            return false;
        return !expected.required || (check.exit_code === 0 && check.timed_out !== true);
    });
}
/** Parse worker evidence before offering a candidate; missing, partial or stale evidence cannot pass. */
export function candidatePassed(value, commit, verification, fingerprint) {
    const evidence = recordObject(value);
    const run = recordObject(evidence?.run);
    if (!run || run.status !== 'passed' || run.commit !== commit || run.dirty !== false)
        return false;
    if (typeof run.fingerprint !== 'string' || !/^git-tree:[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(run.fingerprint)
        || evidence?.fingerprint !== run.fingerprint || run.fingerprint !== fingerprint)
        return false;
    return completeChecks(run.checks, verification);
}
