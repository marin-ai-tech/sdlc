import { programAt } from './shell-cli.js';
import { gnuCopyArgs } from './gnu-copy-args.js';
function argumentWords(command) {
    const words = [];
    let redirect = false;
    for (const word of command.words) {
        if (word.operator) {
            redirect = true;
        }
        else if (redirect) {
            redirect = false;
        }
        else {
            words.push(word);
        }
    }
    return words;
}
/** Native argv retains commas that the shared PowerShell list view separates outside quotes. */
function nativeWords(command, words) {
    const result = [];
    let end = command.start;
    for (const word of words) {
        const gap = command.raw.slice(end - command.start, word.start - command.start);
        let joined = false;
        if (gap.includes(',') && /^[,\s]*$/.test(gap)) {
            joined = result.length > 0;
            for (let index = 0; index < gap.length; index += 1) {
                if (/\s/.test(gap[index]))
                    joined = false;
                else if (joined)
                    result.at(-1).value += ',';
                else {
                    result.push({ value: ',', start: end + index, end: end + index + 1 });
                    joined = true;
                }
            }
        }
        if (joined) {
            result.at(-1).value += word.value;
            result.at(-1).end = word.end;
            if (word.pattern && result.at(-1).pattern !== 'glob')
                result.at(-1).pattern = word.pattern;
        }
        else
            result.push({ ...word });
        end = word.end;
    }
    return result;
}
function optionValues(command, args, at, inline) {
    let next = inline === undefined ? at + 1 : at;
    const first = inline ?? args[next]?.value;
    const values = first === undefined ? [] : [first];
    while (args[next + 1] && /^\s*,\s*$/.test(command.raw.slice(args[next].end - command.start, args[next + 1].start - command.start)))
        values.push(args[++next].value);
    return { values, next };
}
function powershellOperands(command, args, context) {
    const positional = [];
    let sources;
    let destinations;
    let literal = false;
    for (let i = 0; i < args.length; i += 1) {
        const option = /^-(Path|LiteralPath|Destination)(?::(.*))?$/i.exec(args[i].value);
        if (option) {
            const result = optionValues(command, args, i, option[2]);
            i = result.next;
            if (/destination/i.test(option[1]))
                destinations = result.values;
            else {
                sources = result.values;
                literal = /^literalpath$/i.test(option[1]);
            }
        }
        else if (!args[i].value.startsWith('-')) {
            positional.push(args[i].value);
        }
    }
    sources ??= destinations ? positional : positional.slice(0, -1);
    return { sources,
        destinations: destinations ?? positional.slice(-1),
        uncertain: sources.some((source) => source.startsWith('~') || !literal && /[*?[]/.test(source))
            || context.dialect === 'posix' && args.some((word) => word.pattern),
        recursive: args.some((arg) => /^-r(?:e(?:c(?:u(?:r(?:s(?:e)?)?)?)?)?)?$/i.test(arg.value)) };
}
/** cp's operands as GNU getopt reads them (B323): glued values, long prefixes and options after the operands. */
function posixOperands(args) {
    const parsed = gnuCopyArgs('cp', args.map((word) => word.value));
    const positional = parsed.operands.map((index) => args[index]);
    const destination = parsed.target;
    const sources = destination === undefined ? positional.slice(0, -1) : positional;
    const recursive = parsed.options.some((option) => /^(?:[rRa]|recursive|archive)$/.test(option));
    return { sources: sources.map((word) => word.value),
        uncertain: parsed.uncertain || sources.some((word) => word.pattern),
        destinations: destination === undefined ? positional.slice(-1).map((word) => word.value) : [destination],
        recursive };
}
function programWords(words) {
    const at = programAt(words.map((word) => word.value));
    return at < 0 ? [] : words.slice(at);
}
function basename(value) {
    return value.replace(/\\/g, '/').split('/').pop().toLowerCase();
}
/** Recognized copy operations expose their read sources separately from their write destinations. */
export function copyOperands(command, context = {}) {
    const original = argumentWords(command);
    let words = programWords(original);
    const direct = programAt(original.map(word => word.value)) === 0;
    const alias = direct && context.dialect === 'powershell' && /^(?:cp|copy)$/.test(basename(words[0]?.value ?? ''));
    if (alias || /^(?:copy-item|cpi)$/.test(basename(words[0]?.value ?? ''))) {
        return { program: words[0].value, ...powershellOperands(command, words.slice(1), context) };
    }
    words = programWords(nativeWords(command, original));
    const program = basename(words[0]?.value ?? '').replace(/\.exe$/i, '');
    const args = words.slice(1);
    if (program === 'cp') {
        const result = posixOperands(args);
        const end = args.findIndex((word) => word.value === '--');
        const options = end < 0 ? args : args.slice(0, end);
        const ambiguous = !context.dialect && !/\.exe$/i.test(words[0].value)
            && options.some((word) => /^-(?:Path|LiteralPath|Destination)(?::|$)/i.test(word.value));
        return { program, ...result, uncertain: result.uncertain || ambiguous || words.some((word) => word.pattern) };
    }
    if (/^(?:robocopy|xcopy)$/.test(program)) {
        const positional = args.filter((arg) => !/^\/[A-Za-z]+$/.test(arg.value)).map((word) => word.value);
        return { program, sources: positional.slice(0, 1), destinations: positional.slice(1, 2), recursive: true };
    }
    return undefined;
}
