import * as fs from 'node:fs';
import * as path from 'node:path';
import { shellWords } from './shell-words.js';
import { copyOperands } from './copy-operands.js';
import { shellBody, MAX_SHELL_BODY_DEPTH } from './shell-cli.js';
import { isDirCommand, moveTo, relToRoot, STATE_FILE } from './policy-shell.js';
import { programLocation } from './shell-program.js';
const NONE = { kind: 'none' };
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
export function stateCopyInspection(command, root, cwd) {
    return inspectCommands(command, root, { remaining: 4096 }, { dir: cwd, stack: [], context: {}, depth: 0, uncertain: false });
}
function inspectCommands(input, root, budget, state) {
    const parsed = shellWords(input, state.context.dialect === 'cmd' ? true : undefined, state.context);
    let unknown = NONE;
    for (const part of parsed.commands) {
        const [verb, ...args] = part.words.map((word) => word.value);
        if (isDirCommand(verb ?? '')) {
            moveTo(state, verb, args);
            if (state.dir !== undefined && !directoryExists(state.dir))
                state.dir = undefined;
            if (state.dir === undefined)
                state.directory = args[0];
            continue;
        }
        const copy = copyOperands(part, state.context);
        const execution = programLocation(part.words.filter(word => !word.operator).map(word => word.value), state.dir);
        const scoped = { ...state, dir: execution.dir, uncertain: state.uncertain || Boolean(execution.problem) };
        const result = copy ? inspectSources(part, copy, root, scoped, budget, input) : NONE;
        if (result.kind === 'found')
            return result;
        unknown = mergeUnknown(unknown, result);
        const body = shellBody(part, state.context);
        if (body && state.depth < MAX_SHELL_BODY_DEPTH) {
            const nested = inspectCommands(body.input, root, budget, { dir: scoped.dir, stack: [],
                context: body.context, depth: state.depth + 1, uncertain: scoped.uncertain || body.execution });
            if (nested.kind === 'found')
                return nested;
            unknown = mergeUnknown(unknown, nested);
        }
    }
    return unknown;
}
function directoryExists(dir) {
    try {
        return fs.statSync(dir).isDirectory();
    }
    catch {
        return false;
    }
}
function mergeUnknown(current, next) {
    if (next.kind !== 'unknown')
        return current;
    if (current.kind !== 'unknown')
        return next;
    return { ...current, prefixes: [...current.prefixes, ...next.prefixes] };
}
function inspectSources(command, copy, root, state, budget, input) {
    const unresolved = unresolvedOperands(command, copy);
    const first = unresolved[0];
    const named = dynamicOperand(input.slice(command.start));
    const uncertainCopy = (part, role) => unknownCopy(named?.part ?? first?.part ?? part, named?.role ?? first?.role ?? role, unresolved.length ? unresolved.map((operand) => operand.part) : [part]);
    const uncertain = state.dir === undefined || state.uncertain || copy.uncertain
        || command.words.some((word) => word.dynamic || state.context.dialect === 'posix' && word.pattern);
    if (state.dir === undefined)
        return unknownCopy(state.directory ?? command.raw, 'directory');
    if (!copy.recursive)
        return uncertain
            ? uncertainCopy(command.raw, 'source') : NONE;
    if (!copy.sources.length)
        return uncertainCopy(command.raw, 'source');
    let unknown = NONE;
    for (const source of copy.sources) {
        const word = command.words.find((candidate) => candidate.value === source && !candidate.operator);
        if (word?.dynamic || word?.pattern && state.context.dialect === 'posix')
            continue;
        const file = path.resolve(state.dir, source);
        const result = inspectCopy(root, file, budget, source);
        if (result.kind === 'found')
            return result;
        unknown = mergeUnknown(unknown, result);
    }
    return uncertain ? mergeUnknown(uncertainCopy(copy.sources[0], 'source'), unknown) : unknown;
}
/** For the reason only: the first operand with a variable or wildcard as written, and which side of the copy it is. */
function dynamicOperand(text) {
    const end = text.search(/\s*(?:&&|\|\||[;|\n]|\s\d*>)/);
    const operands = (end < 0 ? text : text.slice(0, end)).trim().split(/\s+/);
    const index = operands.findIndex((part, at) => at > 0 && /[$%~*?[{`]/.test(part));
    if (index < 0)
        return undefined;
    const target = /^(?:-t|--target-directory)$/.test(operands[index - 1]) || index === operands.length - 1;
    return { part: operands[index], role: target ? 'destination' : 'source' };
}
function unresolvedOperands(command, copy) {
    const operands = [];
    for (const role of ['destination', 'source']) {
        const values = role === 'destination' ? copy.destinations : copy.sources;
        for (const value of values) {
            const word = command.words.find((candidate) => !candidate.operator && (candidate.value === value
                || candidate.value.endsWith(`=${value}`) || candidate.value.endsWith(`:${value}`)
                || candidate.value === `-t${value}`));
            if (!word?.dynamic && !word?.pattern)
                continue;
            const raw = command.raw.slice(word.start - command.start, word.end - command.start);
            const part = raw.replace(/^(?:--target-directory=|-t|-(?:Path|LiteralPath|Destination):)/i, '');
            operands.push({ part, role });
        }
    }
    return operands;
}
function inspectCopy(root, file, budget, part) {
    try {
        fs.lstatSync(file);
    }
    catch (error) {
        if (error.code === 'ENOENT' && !/[*?[{]/.test(file))
            return NONE;
        return unknownCopy(part, 'source');
    }
    try {
        if (!containsState(root, file, budget))
            return NONE;
    }
    catch {
        return unknownCopy(part, 'source');
    }
    return { kind: 'found' };
}
function unknownCopy(part, role, parts = [part]) {
    const prefixes = parts.map((value) => value.replace(/^['"]/, '').split(/[$%~*?[{`]/, 1)[0]).filter(Boolean);
    return { kind: 'unknown', part, role, prefixes };
}
