/**
 * Exact shell values (B318). A variable's value is exact when one plain assignment of a literal stands at the top
 * level of the command, before every use, runs unconditionally, is never changed, and holds no substitution or
 * default expansion. Only then may a copy through the variable be judged as the copy with the value written out.
 *
 * The reading is deliberately narrow: anything it does not understand makes the whole command inexact, and the
 * caller keeps the refusal it had before. Top-level segments are separated only by `;` or a newline; any pipe, `&`,
 * subshell, group, function, compound keyword, here-document, command substitution, backslash, prefix assignment,
 * command that changes or declares variables, command that makes a link, or use outside double quotes gives no exact
 * values.
 */
const NAME = /^[A-Za-z_][A-Za-z_0-9]*$/;
const ASSIGNMENT = /^([A-Za-z_][A-Za-z_0-9]*)=(.*)$/s;
const BARE_VALUE = /^[A-Za-z0-9_./:@%+,=-]+$/;
const QUOTED_VALUE = /^"([^"$`\\]*)"$|^'([^'$`\\"]*)'$/;
const COMPOUND = /^(?:if|then|else|elif|fi|case|esac|for|select|while|until|do|done|function|time|coproc|!|\[\[|\]\])$/;
const VARIABLE_COMMANDS = /^(?:unset|export|declare|typeset|local|readonly|read|getopts|mapfile|readarray|printf|eval|source|\.|set|shift|let|alias|trap|exec|env|command|builtin)$/;
const LINK_COMMANDS = /^(?:ln|link|mklink|junction|New-Item)$/i;
/** A change of directory would move what a relative value names; such a command has no exact values. */
const DIRECTORY_COMMANDS = /^(?:cd|chdir|pushd|popd)$/;
const COPY_LINK_FLAG = /^(?:-[A-Za-z]*[sl][A-Za-z]*|--link|--symbolic-link)$/;
const MAX_NAMES = 16;
const MAX_LENGTH = 65536;
const MAX_VALUE = 4096;
/** The path each use of an exact value names: the value and the rest of its word (`"$BASE/a/b"` -> `<value>/a/b`). */
export function exactPaths(command, exact) {
    const found = scan(command);
    if (!found)
        return [];
    return found.uses.filter((use) => Object.hasOwn(exact.values, use.name)).map((use) => {
        const rest = /^[^\s"';]*/.exec(command.slice(use.end))?.[0] ?? '';
        return exact.values[use.name] + rest;
    });
}
/** `$NAME` or `${NAME}` at `at`; `null` for a `$` form that is not plain (`${X:-y}`, `$(`, `$1`, `$?`, ...). */
function useAt(text, at) {
    const rest = text.slice(at + 1);
    const braced = /^\{([A-Za-z_][A-Za-z_0-9]*)\}/.exec(rest);
    if (braced)
        return { end: at + 1 + braced[0].length, name: braced[1] };
    const simple = /^[A-Za-z_][A-Za-z_0-9]*/.exec(rest);
    if (simple)
        return { end: at + 1 + simple[0].length, name: simple[0] };
    return /^[\s"]|^$/.test(rest) ? undefined : null;
}
/** Splits the command into top-level segments and finds the variable uses; undefined for anything not understood. */
function scan(text) {
    const segments = [];
    const uses = [];
    let quote = '';
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (quote === "'") {
            if (char === "'")
                quote = '';
            continue;
        }
        if (char === '`' || char === '\\')
            return undefined;
        if (char === '"') {
            quote = quote ? '' : '"';
            continue;
        }
        if (char === '$') {
            const use = useAt(text, i);
            if (use === null)
                return undefined;
            if (use) {
                uses.push({ start: i, end: use.end, name: use.name, quoted: quote === '"', segment: segments.length });
                i = use.end - 1;
            }
            continue;
        }
        if (quote)
            continue;
        if (char === "'")
            quote = "'";
        else if (/[|&(){}]/.test(char) || text.startsWith('<<', i))
            return undefined;
        else if (char === ';' || char === '\n') {
            segments.push({ start, end: i });
            start = i + 1;
        }
    }
    if (quote)
        return undefined;
    segments.push({ start, end: text.length });
    return { segments, uses };
}
/** The words of a segment, split on blanks outside quotes; enough to see its first word and its flags. */
function words(text) {
    return text.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}
/** The literal of an assignment's value, or undefined when it is not one plain literal. */
function literal(value) {
    if (value.length === 0 || value.length > MAX_VALUE)
        return undefined;
    if (BARE_VALUE.test(value))
        return value;
    const quoted = QUOTED_VALUE.exec(value);
    const inner = quoted ? quoted[1] ?? quoted[2] : undefined;
    return inner && !inner.includes('\n') ? inner : undefined;
}
/** A segment that is no assignment: refused when it could change a variable, make a link, or is a compound form. */
function plainCommand(segmentWords) {
    const first = segmentWords[0] ?? '';
    if (/^[A-Za-z_][A-Za-z_0-9]*\+?=/.test(first))
        return false;
    if (COMPOUND.test(first) || VARIABLE_COMMANDS.test(first) || LINK_COMMANDS.test(first))
        return false;
    if (DIRECTORY_COMMANDS.test(first))
        return false;
    return !(first === 'cp' && segmentWords.some((word) => COPY_LINK_FLAG.test(word)));
}
/** The assignments of the command; undefined when a segment is not understood or a name is assigned twice. */
function assignments(text, found) {
    const values = new Map();
    for (const [index, segment] of found.segments.entries()) {
        const segmentWords = words(text.slice(segment.start, segment.end));
        if (segmentWords.length === 0)
            continue;
        const match = segmentWords.length === 1 ? ASSIGNMENT.exec(segmentWords[0]) : null;
        if (!match) {
            if (!plainCommand(segmentWords))
                return undefined;
            continue;
        }
        const value = literal(match[2]);
        if (value === undefined || values.has(match[1]) || !NAME.test(match[1]))
            return undefined;
        values.set(match[1], { value, segment: index });
    }
    return values.size > 0 && values.size <= MAX_NAMES ? values : undefined;
}
/** The exact values and the command with each use of one written out; undefined when there is none. */
export function exactValues(command) {
    if (command.length > MAX_LENGTH)
        return undefined;
    const found = scan(command);
    const assigned = found && assignments(command, found);
    if (!found || !assigned)
        return undefined;
    let spelling = '';
    let at = 0;
    for (const use of found.uses) {
        const known = assigned.get(use.name);
        if (!known)
            continue;
        if (use.segment <= known.segment)
            return undefined;
        // Bash splits an unquoted expansion on IFS and expands globs in it, which an assignment such as IFS=@ in the same
        // command can turn into extra arguments; only a use inside double quotes stays the one word written out here.
        if (!use.quoted)
            return undefined;
        spelling += command.slice(at, use.start) + known.value;
        at = use.end;
    }
    if (at === 0)
        return undefined;
    const values = Object.fromEntries([...assigned].map(([name, known]) => [name, known.value]));
    return { values, spelling: spelling + command.slice(at) };
}
