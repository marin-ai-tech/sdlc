import { shellBody, MAX_SHELL_BODY_DEPTH } from './shell-cli.js';
import { shellWords, MAX_INPUT } from './shell-words.js';
import { withoutHeredocs } from './policy-shell-writes.js';
const ASSIGNMENT = /^([A-Za-z_][A-Za-z_0-9]*)(\+?=)(.*)$/s;
const POSIX_DECLARATION = /^(?:export|declare|typeset|local|readonly)$/;
const OPEN = /^(?:if|case|while|until|for)$/;
const CLOSE = /^(?:fi|esac|done)$/;
const COMMAND_POSITION = /^(?:then|do|else|elif|!|\{)$/;
const DIRECTORY = /^(?:cd|chdir|pushd|popd|Set-Location|sl|Push-Location|Pop-Location)$/i;
const MAX_RENDER_WORK = 512;
const MAX_RENDER_CHARACTERS = 32768;
const valueKeys = new WeakMap();
function expired(limit) {
    if (limit.timedOut)
        return true;
    if (limit.deadline === undefined || !limit.hasSite)
        return false;
    limit.timedOut = Date.now() >= limit.deadline;
    return limit.timedOut;
}
const ENV_USE = /\$env:([A-Za-z_][A-Za-z_0-9]*)/iy;
const SIMPLE_USE = /\$([A-Za-z_][A-Za-z_0-9]*)/y;
const BRACED_USE = /\$\{([A-Za-z_][A-Za-z_0-9]*)(?:(?::-|:=|-|=)([^{}]*))?\}/y;
const PERCENT_USE = /%([A-Za-z_][A-Za-z_0-9]*)%/y;
const BANG_USE = /!([A-Za-z_][A-Za-z_0-9]*)!/y;
function matchAt(pattern, input, at) {
    pattern.lastIndex = at;
    return pattern.exec(input);
}
function braceEnd(input, at, limit) {
    let depth = 1;
    let quote = '';
    for (let i = at + 2; i < input.length; i += 1) {
        if (limit && expired(limit))
            break;
        const char = input[i];
        if (char === '\\') {
            i += 1;
            continue;
        }
        if (char === "'" && quote !== '"' || char === '"' && quote !== "'") {
            quote = quote === char ? '' : quote || char;
            continue;
        }
        if (quote)
            continue;
        if (input.slice(i, i + 2) === '${') {
            depth += 1;
            i += 1;
        }
        else if (char === '}' && --depth === 0)
            return i + 1;
    }
    return input.length;
}
function useAt(input, at, quoted, limit) {
    const env = matchAt(ENV_USE, input, at);
    if (env)
        return { start: at, end: at + env[0].length, name: env[1], quoted };
    const simple = matchAt(SIMPLE_USE, input, at);
    if (simple)
        return { start: at, end: at + simple[0].length, name: simple[1], quoted };
    const braced = matchAt(BRACED_USE, input, at);
    if (braced && at + braced[0].length === braceEnd(input, at, limit)) {
        return { start: at, end: at + braced[0].length, name: braced[1],
            ...(braced[2] === undefined ? {} : { fallback: braced[2] }), quoted };
    }
    const percent = matchAt(PERCENT_USE, input, at);
    if (percent)
        return { start: at, end: at + percent[0].length, name: percent[1], quoted };
    const bang = matchAt(BANG_USE, input, at);
    if (bang)
        return { start: at, end: at + bang[0].length, name: bang[1], quoted };
    return undefined;
}
function uses(input, offset = 0, limit) {
    const found = [];
    let quote = '';
    for (let i = 0; i < input.length; i += 1) {
        if (limit && expired(limit))
            break;
        const char = input[i];
        if (char === '\\' || char === '`') {
            i += 1;
            continue;
        }
        if (char === "'" && quote !== '"' || char === '"' && quote !== "'") {
            quote = quote === char ? '' : quote || char;
            continue;
        }
        if (quote === "'" || !/[$% !]/.test(char) || char === ' ')
            continue;
        const use = useAt(input, i, quote === '"', limit);
        if (!use)
            continue;
        found.push({ ...use, start: use.start + offset, end: use.end + offset });
        i = use.end - 1;
    }
    return found;
}
function lookup(values, name) {
    const exact = values.get(name);
    if (exact)
        return exact;
    for (const [key, known] of values) {
        if (known.insensitive && key.toLowerCase() === name.toLowerCase())
            return known;
    }
    return undefined;
}
function options(values, use, limit) {
    const known = lookup(values, use.name);
    if (known)
        return known.values;
    if (use.fallback === undefined)
        return [];
    const fallback = limit.fallbackValues.get(use.fallback) ?? [use.fallback];
    limit.fallbackValues.set(use.fallback, fallback);
    return fallback;
}
function expandValue(value, values, limit) {
    const parts = uses(value, 0, limit);
    let result = [value];
    for (const part of parts.reverse()) {
        if (expired(limit))
            break;
        const choices = options(values, part, limit);
        if (!choices.length)
            continue;
        result = result.flatMap((text) => choices.flatMap((choice) => {
            if (expired(limit))
                return [];
            if (text.length - (part.end - part.start) + choice.length > MAX_INPUT) {
                limit.exceeded = true;
                return [];
            }
            return [text.slice(0, part.start) + choice + text.slice(part.end)];
        }));
        if (result.length > 16)
            return result.slice(0, 17);
    }
    return result;
}
function assign(values, name, word, append, unsure, powershell, limit) {
    const old = lookup(values, name);
    const suffixes = expandValue(word, values, limit);
    if (expired(limit))
        return;
    const next = append && old ? old.values.flatMap((prefix) => suffixes.flatMap((suffix) => {
        if (expired(limit))
            return [];
        if (prefix.length + suffix.length > MAX_INPUT) {
            limit.exceeded = true;
            return [];
        }
        return [prefix + suffix];
    })) : suffixes;
    const combined = unsure && old ? [...old.values, ...next] : next;
    if (new Set(combined).size > 16)
        limit.exceeded = true;
    values.set(name, {
        values: [...new Set(combined)].slice(0, 17),
        insensitive: powershell || old?.insensitive === true,
    });
}
function specialAssignments(words, values, unsure, limit, cmd) {
    const first = words[0] ?? '';
    const loop = words.findIndex((word, index) => word === 'for' && words[index + 2] === 'in'
        && (index === 0 || /^(?:then|do|else|elif|!)$/.test(words[index - 1])));
    if (loop >= 0) {
        for (const word of words.slice(loop + 3)) {
            if (limit.exceeded || expired(limit))
                break;
            if (/^(?:do|then)$/.test(word))
                break;
            assign(values, words[loop + 1], word, false, true, false, limit);
        }
    }
    if (/^set$/i.test(first) && words[1]) {
        const set = ASSIGNMENT.exec(words[1]);
        if (set)
            assign(values, set[1], set[3], false, !cmd || unsure, false, limit);
    }
    if (/^Set-Variable$/i.test(first) && words[2]) {
        assign(values, words[1], words[2], false, unsure, true, limit);
    }
}
function assignmentWords(command, values, unsure, limit, cmd) {
    const words = command.words.filter((word) => !word.operator).map((word) => word.value);
    const first = words[0] ?? '';
    const declaration = POSIX_DECLARATION.test(first);
    const prefix = !declaration && words.length > 1 && ASSIGNMENT.test(first);
    const conditional = unsure || prefix || first === 'local';
    specialAssignments(words, values, conditional, limit, cmd);
    for (let i = 0; i < words.length; i += 1) {
        if (limit.exceeded || expired(limit))
            break;
        const word = words[i];
        const ps = /^\$(?:env:)?([A-Za-z_][A-Za-z_0-9]*)=(.*)$/is.exec(word);
        const spaced = /^\$(?:env:)?([A-Za-z_][A-Za-z_0-9]*)$/i.exec(word);
        if (ps && i === words.length - 1)
            assign(values, ps[1], ps[2], false, conditional, true, limit);
        else if (spaced && words[i + 1] === '=' && words[i + 2] && i + 3 === words.length) {
            assign(values, spaced[1], words[i + 2], false, conditional, true, limit);
            i += 2;
        }
        else if (first !== 'set' && first !== 'Set-Variable') {
            const match = ASSIGNMENT.exec(word);
            if (match && (i === 0 || declaration || /^\w+=/.test(first)
                || i === 1 && /^(?:if|while|until)$/.test(first)
                || /^(?:then|do|else)$/.test(words[i - 1] ?? ''))) {
                assign(values, match[1], match[3], match[2] === '+=', conditional, false, limit);
            }
        }
    }
}
function wordUses(source, command, values, powershell, limit) {
    const sites = [];
    for (const word of command.words) {
        if (expired(limit))
            break;
        if (word.operator)
            continue;
        const raw = source.slice(word.start, word.end);
        for (const use of uses(raw, word.start, limit)) {
            if (expired(limit))
                break;
            const choices = options(values, use, limit);
            if (choices.length) {
                limit.hasSite = true;
                sites.push({ ...use, values: choices, powershell });
            }
        }
    }
    return sites;
}
function safeValue(value, quoted, powershell) {
    if (quoted)
        return powershell ? value.replace(/[`"$]/g, '`$&') : value.replace(/[\\"$`]/g, '\\$&');
    if (powershell)
        return `'${value.replace(/'/g, "''")}'`;
    const fields = value.split(/\s+/).filter(Boolean);
    return fields.length ? fields.map((field) => `'${field.replace(/'/g, `'"'"'`)}'`).join(' ') : "''";
}
function siteKey(site) {
    const name = site.powershell ? site.name.toLowerCase() : site.name;
    if (!valueKeys.has(site.values))
        valueKeys.set(site.values, JSON.stringify(site.values));
    return `${name}:${valueKeys.get(site.values)}`;
}
function renderChoices(sites, limit) {
    const groups = new Map();
    for (const site of sites) {
        if (expired(limit))
            return [];
        groups.set(site.values, site.values);
    }
    if ([...groups.values()].reduce((product, values) => product * values.length, 1) > 16) {
        groups.clear();
        for (const site of sites) {
            if (expired(limit))
                return [];
            groups.set(siteKey(site), site.values);
        }
    }
    let choices = [new Map()];
    for (const [key, values] of groups) {
        if (expired(limit))
            return [];
        if (choices.length * values.length > 16) {
            limit.exceeded = true;
            return [];
        }
        choices = choices.flatMap((choice) => values.map((value) => {
            if (expired(limit))
                return new Map();
            return new Map([...choice, [key, value]]);
        }));
    }
    return choices;
}
function renderOne(source, sites, choice, limit) {
    const pieces = [];
    let previous = 0;
    let length = 0;
    for (const site of sites) {
        if (expired(limit))
            return undefined;
        const value = choice.get(site.values) ?? choice.get(siteKey(site));
        const safe = safeValue(value, site.quoted, site.powershell);
        const piece = source.slice(previous, site.start);
        length += piece.length + safe.length;
        if (length > MAX_INPUT || length + limit.characters > MAX_RENDER_CHARACTERS) {
            limit.exceeded = true;
            return undefined;
        }
        pieces.push(piece, safe);
        previous = site.end;
    }
    length += source.length - previous;
    if (length > MAX_INPUT || length + limit.characters > MAX_RENDER_CHARACTERS) {
        limit.exceeded = true;
        return undefined;
    }
    pieces.push(source.slice(previous));
    const spelling = pieces.join('');
    return spelling === source ? undefined : spelling;
}
function wordCount(commands) {
    return commands.reduce((total, command) => total + command.words.length, 0);
}
function countBodies(commands, depth, context, limit) {
    if (depth >= MAX_SHELL_BODY_DEPTH || limit.exceeded || expired(limit))
        return;
    for (const command of commands) {
        if (expired(limit))
            return;
        const body = shellBody(command, context);
        if (!body)
            continue;
        const parsed = shellWords(body.input, body.context.dialect === 'cmd' ? true : undefined, body.context);
        limit.words += wordCount(parsed.commands);
        if (parsed.problem || limit.words > MAX_RENDER_WORK) {
            limit.exceeded = true;
            return;
        }
        countBodies(parsed.commands, depth + 1, body.context, limit);
        if (limit.exceeded)
            return;
    }
}
function countSpelling(spelling, depth, context, limit) {
    limit.characters += spelling.length;
    if (limit.characters > MAX_RENDER_CHARACTERS) {
        limit.exceeded = true;
        return;
    }
    const parsed = shellWords(spelling);
    limit.words += wordCount(parsed.commands);
    if (parsed.problem || limit.words > MAX_RENDER_WORK) {
        limit.exceeded = true;
        return;
    }
    countBodies(parsed.commands, 0, context, limit);
}
function render(source, sites, words, limit, depth, context) {
    const spellings = [];
    const choices = renderChoices(sites, limit);
    if ((choices.length + 1) * words > MAX_RENDER_WORK)
        limit.exceeded = true;
    if (limit.exceeded || limit.timedOut)
        return { spellings, exceeded: limit.exceeded, timedOut: limit.timedOut };
    for (const choice of choices) {
        if (expired(limit))
            break;
        const spelling = renderOne(source, sites, choice, limit);
        if (limit.exceeded)
            break;
        if (spelling === undefined)
            continue;
        countSpelling(spelling, depth, context, limit);
        if (limit.exceeded)
            break;
        spellings.push(spelling);
    }
    return { spellings: [...new Set(spellings)], exceeded: limit.exceeded, timedOut: limit.timedOut };
}
function commandScope(command, scope, limit) {
    const words = command.words.filter((word) => !word.operator).map((word) => word.value);
    let next = CLOSE.test(words[0] ?? '') ? Math.max(0, scope - 1) : scope;
    for (let i = 0; i < words.length; i += 1) {
        if (expired(limit))
            break;
        if (OPEN.test(words[i]) && (i === 0 || COMMAND_POSITION.test(words[i - 1])))
            next += 1;
    }
    return next;
}
function commandUncertainty(source, parsed, index, state, limit) {
    const item = parsed[index];
    state.scope = commandScope(item, state.scope, limit);
    let parentheses = 0;
    let braces = 0;
    const gap = source.slice(state.previous, item.start);
    for (const char of gap) {
        if (expired(limit))
            break;
        if (char === '(')
            parentheses += 1;
        if (char === ')')
            parentheses -= 1;
        if (char === '{')
            braces += 1;
        if (char === '}')
            braces -= 1;
    }
    state.parentheses = Math.max(0, state.parentheses + parentheses);
    state.braces = Math.max(0, state.braces + braces);
    state.previous = item.end;
    const following = source.slice(item.end, parsed[index + 1]?.start ?? source.length);
    return state.scope > 0 || state.parentheses > 0 || state.braces > 0
        || /&&|\|\||(?<!\|)\|(?!\|)/.test(gap)
        || /(?<!\|)\|(?!\|)|(?<!&)&(?!&)/.test(following);
}
function localSpellings(source, parsed, values, limit, context, depth) {
    const state = { scope: 0, parentheses: 0, braces: 0, previous: 0 };
    const sites = [];
    for (const [index, item] of parsed.entries()) {
        if (expired(limit))
            break;
        const unsure = commandUncertainty(source, parsed, index, state, limit);
        const cmd = context.dialect === 'cmd';
        assignmentWords(item, values, unsure, limit, cmd);
        if (limit.exceeded || limit.timedOut)
            break;
        const powershell = context.dialect === 'powershell' || [...values.values()].some((known) => known.insensitive)
            || item.words.some((word) => /^\$(?:env:)?\w+=|^Set-Variable$/i.test(word.value));
        sites.push(...wordUses(source, item, values, powershell, limit));
    }
    if (expired(limit) || limit.exceeded || !sites.length) {
        return { spellings: [], exceeded: limit.exceeded, timedOut: limit.timedOut };
    }
    return render(source, sites, wordCount(parsed), limit, depth, context);
}
function nestedSpellings(parsed, depth, context, result, limit) {
    if (depth >= MAX_SHELL_BODY_DEPTH)
        return;
    let directory = '';
    for (const item of parsed) {
        if (expired(limit))
            return;
        const head = item.words[0]?.value ?? '';
        if (DIRECTORY.test(head))
            directory += `${item.raw}; `;
        const body = shellBody(item, context);
        if (!body || body.execution)
            continue;
        const nested = literalValueSpellingsWithin(body.input, depth + 1, body.context, limit);
        if (nested.exceeded) {
            result.exceeded = true;
            return;
        }
        if ((result.spellings.length + nested.spellings.length + 1) * wordCount(parsed) > MAX_RENDER_WORK) {
            result.exceeded = true;
            return;
        }
        for (const spelling of nested.spellings) {
            if (expired(limit))
                return;
            if (directory.length + spelling.length > MAX_INPUT) {
                result.exceeded = true;
                return;
            }
            const combined = directory + spelling;
            if (directory)
                countSpelling(combined, depth + 1, body.context, limit);
            if (limit.exceeded) {
                result.exceeded = true;
                return;
            }
            result.spellings.push(combined);
        }
        if (result.exceeded)
            return;
    }
}
function literalValueSpellingsWithin(command, depth, context, limit) {
    if (!/[$%!]/.test(command))
        return { spellings: [], exceeded: false, timedOut: false };
    if (expired(limit))
        return { spellings: [], exceeded: false, timedOut: true };
    const source = withoutHeredocs(command);
    const parsed = shellWords(source, context.dialect === 'cmd' ? true : undefined, context);
    const result = localSpellings(source, parsed.commands, new Map(), limit, context, depth);
    if (!result.exceeded && !result.timedOut)
        nestedSpellings(parsed.commands, depth, context, result, limit);
    result.timedOut = limit.timedOut;
    return result;
}
/** Additional conservative command spellings from literal assignments in this shell call. */
export function literalValueSpellings(command, depth = 0, context = {}, deadline) {
    return literalValueSpellingsWithin(command, depth, context, {
        exceeded: false, timedOut: false, words: 0, characters: 0, deadline, hasSite: false,
        fallbackValues: new Map(),
    });
}
