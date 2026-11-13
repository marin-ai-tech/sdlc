import { programAt } from './shell-cli.js';
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
function copyOption(value) {
    if (value.startsWith('--'))
        return { recursive: /^--(?:recursive|archive)$/.test(value) };
    const cluster = value.slice(1);
    const takesValue = cluster.search(/[St]/);
    const flags = takesValue < 0 ? cluster : cluster.slice(0, takesValue);
    return { recursive: /[rRa]/.test(flags),
        uncertain: takesValue >= 0 && cluster[takesValue] === 'S',
        target: takesValue >= 0 && cluster[takesValue] === 't' ? cluster.slice(takesValue + 1) : undefined };
}
function posixOperands(args) {
    const positional = [];
    let destination;
    let options = true;
    let recursive = false;
    let uncertain = false;
    for (let i = 0; i < args.length; i += 1) {
        const value = args[i].value;
        if (options && value === '--')
            options = false;
        else if (options && value === '--target-directory')
            destination = args[++i]?.value;
        else if (options && value.startsWith('--target-directory='))
            destination = value.slice(19);
        else if (options && value.startsWith('-')) {
            const option = copyOption(value);
            recursive ||= option.recursive;
            uncertain ||= option.uncertain ?? false;
            if (option.target !== undefined)
                destination = option.target || args[++i]?.value;
        }
        else
            positional.push(args[i]);
    }
    const sources = destination === undefined ? positional.slice(0, -1) : positional;
    return { sources: sources.map((word) => word.value), uncertain: uncertain || sources.some((word) => word.pattern),
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
