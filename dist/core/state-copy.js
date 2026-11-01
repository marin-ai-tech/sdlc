import * as fs from 'node:fs';
import * as path from 'node:path';
import { shellWords } from './shell-words.js';
import { copyOperands } from './copy-operands.js';
import { shellBody, MAX_SHELL_BODY_DEPTH } from './shell-cli.js';
import { isDirCommand, moveTo, relToRoot, STATE_FILE } from './policy-shell.js';
import { t } from './i18n.js';
import { programLocation } from './shell-program.js';
function containsState(root, source, budget) {
    const pending = [{ file: source, depth: 0 }];
    const seen = new Set();
    while (pending.length) {
        const current = pending.pop();
        if (--budget.remaining < 0 || current.depth > 16)
            throw new Error('Copy source exceeds static inspection limits.');
        const real = fs.realpathSync(current.file);
        if (seen.has(real))
            continue;
        seen.add(real);
        if (path.basename(real).toLowerCase() === '.sdlc.yaml' || STATE_FILE.test(relToRoot(root, root, real) ?? '')) {
            return true;
        }
        if (!fs.statSync(real).isDirectory())
            continue;
        for (const entry of fs.readdirSync(real))
            pending.push({ file: path.join(real, entry), depth: current.depth + 1 });
    }
    return false;
}
/** Copies inspect source content as well as destination spelling; unsupported programs remain outside this guard. */
export function stateCopyDecision(command, root, cwd) {
    return inspectCommands(command, root, { remaining: 4096 }, { dir: cwd, stack: [], context: {}, depth: 0, uncertain: false });
}
function inspectCommands(input, root, budget, state) {
    const parsed = shellWords(input, state.context.dialect === 'cmd' ? true : undefined, state.context);
    for (const part of parsed.commands) {
        const [verb, ...args] = part.words.map((word) => word.value);
        if (isDirCommand(verb ?? '')) {
            moveTo(state, verb, args);
            if (state.dir !== undefined && !directoryExists(state.dir))
                state.dir = undefined;
            continue;
        }
        const copy = copyOperands(part, state.context);
        const execution = programLocation(part.words.filter(word => !word.operator).map(word => word.value), state.dir);
        const scoped = { ...state, dir: execution.dir, uncertain: state.uncertain || Boolean(execution.problem) };
        const denial = copy ? inspectSources(part, copy, root, scoped, budget) : undefined;
        if (denial)
            return denial;
        const body = shellBody(part, state.context);
        if (body && state.depth < MAX_SHELL_BODY_DEPTH) {
            const nested = inspectCommands(body.input, root, budget, { dir: scoped.dir, stack: [],
                context: body.context, depth: state.depth + 1, uncertain: scoped.uncertain || body.execution });
            if (nested)
                return nested;
        }
    }
    return undefined;
}
function directoryExists(dir) {
    try {
        return fs.statSync(dir).isDirectory();
    }
    catch {
        return false;
    }
}
function inspectSources(command, copy, root, state, budget) {
    if (state.dir === undefined || state.uncertain || copy.uncertain
        || command.words.some((word) => word.dynamic || state.context.dialect === 'posix' && word.pattern)) {
        return unknownCopy();
    }
    if (!copy.recursive)
        return undefined;
    if (!copy.sources.length)
        return unknownCopy();
    for (const source of copy.sources) {
        const file = path.resolve(state.dir, source);
        const denial = inspectCopy(root, file, budget);
        if (denial)
            return denial;
    }
    return undefined;
}
function inspectCopy(root, file, budget) {
    if (file === undefined)
        return unknownCopy();
    try {
        fs.lstatSync(file);
    }
    catch (error) {
        if (error.code === 'ENOENT' && !/[*?[{]/.test(file))
            return undefined;
        return unknownCopy();
    }
    try {
        if (!containsState(root, file, budget))
            return undefined;
    }
    catch {
        return unknownCopy();
    }
    return { decision: 'deny', rule: 'state-integrity', reason: t('hook.stateIntegrityBash') };
}
function unknownCopy() {
    return { decision: 'deny', rule: 'state-integrity', reason: 'Copy source cannot be inspected within static limits.' };
}
