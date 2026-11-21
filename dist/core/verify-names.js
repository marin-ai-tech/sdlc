import * as path from 'node:path';
function unquote(token) {
    return token.replace(/^["']|["']$/g, '');
}
function basename(token) {
    return path.posix.basename(token.replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
}
function toolName(token) {
    const unscoped = token.replace(/^@[^/]+\//, '');
    return unscoped.replace(/@[^@]+$/, '');
}
function firstNonFlag(args) {
    return args.find((arg) => !arg.startsWith('-'));
}
const OPTION_VALUES = new Set(['--prefix', '-C', '--workspace', '-w', '--filter']);
function packageArgs(args) {
    let index = 0;
    while (args[index]?.startsWith('-')) {
        const option = args[index];
        index += 1;
        if (OPTION_VALUES.has(option))
            index += 1;
    }
    return args.slice(index);
}
function commandTokens(tokens) {
    let index = 0;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? ''))
        index += 1;
    if (tokens[index] === 'env') {
        index += 1;
        while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? ''))
            index += 1;
    }
    return tokens.slice(index);
}
function commandName(program, args) {
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
        args = packageArgs(args);
    }
    const first = args[0];
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(program)) {
        if (['run', 'run-script'].includes(first) && args[1])
            return args[1];
        if (['test', 't'].includes(first))
            return 'test';
        if (['exec', 'x', 'dlx'].includes(first) && args[1])
            return toolName(args[1]);
        return first && !first.startsWith('-') ? first : program;
    }
    if (['npx', 'bunx', 'pnpx'].includes(program))
        return toolName(firstNonFlag(args) ?? program);
    if (['node', 'tsx', 'python', 'python3'].includes(program)) {
        if (first === '-m' && args[1])
            return args[1];
        return first && !first.startsWith('-') ? basename(first) : program;
    }
    if (['make', 'just'].includes(program))
        return firstNonFlag(args) ?? program;
    return program;
}
/** Name a command by its script, tool, file, target, or program. */
export function derivedCheckName(run, index) {
    const tokens = commandTokens((run.match(/(?:"[^"]*"|'[^']*'|\S)+/g) ?? []).map(unquote));
    const program = basename(tokens.shift() ?? '').toLowerCase();
    const raw = commandName(program, tokens);
    const cleaned = raw.toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-|-$/g, '');
    return cleaned || `check-${index + 1}`;
}
/** Reserve every explicit name before allocating derived names in file order. */
export function nameChecks(commands, mcpNames) {
    const explicit = commands.flatMap((command) => command.name === undefined ? [] : [command.name]);
    const used = new Set([...mcpNames, ...explicit]);
    return commands.map((command, index) => {
        if (command.name !== undefined)
            return { ...command, name: command.name };
        const base = derivedCheckName(command.run, index);
        let name = base;
        let suffix = 2;
        while (used.has(name)) {
            name = `${base}-${suffix}`;
            suffix += 1;
        }
        used.add(name);
        return { ...command, name };
    });
}
/** Equal final names can only come from explicit checks, including pack checks. */
export function duplicateCheckNames(verify) {
    const keys = new Map();
    verify.commands.forEach(({ name }, index) => {
        const command = verify.commands[index];
        const agent = command.env?.SDLC_AGENT;
        const location = agent?.startsWith('pack-') ? `pack ${agent.slice(5)}` : `verify.commands[${index}]`;
        keys.set(name, [...(keys.get(name) ?? []), location]);
    });
    (verify.mcp ?? []).forEach(({ name }, index) => {
        keys.set(name, [...(keys.get(name) ?? []), `verify.mcp[${index}]`]);
    });
    return [...keys].filter(([, locations]) => locations.length > 1)
        .map(([name, locations]) => ({ name, keys: locations }));
}
