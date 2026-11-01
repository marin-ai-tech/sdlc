import { createRequire } from 'node:module';
import { shellWords, type ShellCommand, type ShellWord, type ShellContext } from './shell-words.js';
import { programLocation } from './shell-program.js';
import { nodeLaunch, nodeInlineOption, type NodeLaunch } from './node-inline.js';
import { nodeCallContext } from './node-call-context.js';

export interface ShellCli {
  command: ShellCommand;
  args: string[];
  help: boolean;
  execution?: boolean;
  uncertain?: boolean;
}

// src/core and dist/core both resolve the installed harness manifest two levels above this module.
const manifest = createRequire(import.meta.url)('../../package.json') as { bin: Record<string, string> };
const CLI_NAMES = new Set(Object.keys(manifest.bin).map((name) => name.toLowerCase()));
const CLI_SUFFIX = /\.(?:js|cmd|ps1|exe)$/i;
const GLOBAL_VALUE = new Set(['--locale', '--project', '--cwd']);
const READ_ONLY = /^(?:status|next|trace|audit|help|instructions|validate)$/i;
export const MAX_SHELL_BODY_DEPTH = 3;

function basename(value: string): string {
  return value.replace(/\\/g, '/').split('/').pop() ?? '';
}

function registered(value: string): boolean {
  return CLI_NAMES.has(basename(value).replace(CLI_SUFFIX, '').toLowerCase());
}

export function programAt(words: string[]): number {
  return programLocation(words).at;
}

/** Recognize launchers, never an arbitrary occurrence in another program's data arguments. */
function cliAt(words: string[]): number {
  let i = programAt(words);
  if (/^node(?:\.exe)?$/i.test(basename(words[i] ?? ''))) {
    const launch = nodeLaunch(words.slice(i + 1));
    i = launch.scriptAt === undefined ? -1 : i + 1 + launch.scriptAt;
  } else if (/^(?:npx|npm|yarn|pnpm)(?:\.exe|\.cmd)?$/i.test(basename(words[i] ?? ''))) {
    i += 1;
    while ((words[i] ?? '').startsWith('-') || /^(?:exec|run|dlx)$/.test(words[i] ?? '')) i += 1;
  }
  return registered(words[i] ?? '') ? i : -1;
}

function argumentsOf(words: string[], at: number): string[] {
  const args = words.slice(at + 1);
  let start = 0;
  while ((args[start] ?? '').startsWith('-')) {
    const option = args[start];
    start += GLOBAL_VALUE.has(option) ? 2 : 1;
  }
  return args.slice(start);
}

export interface ShellBody {
  input: string;
  context: ShellContext;
  execution: boolean;
}

interface CliScan {
  calls: ShellCli[];
  problem?: string;
}

function uncertainOperation(tokens: ShellWord[], at: number, context: ShellContext): boolean {
  if (tokens.slice(0, at).some((word) => word.expansion === 'fields' || word.pattern === 'glob')) return true;
  let index = at + 1;
  for (; (tokens[index]?.value ?? '').startsWith('-');) {
    const count = GLOBAL_VALUE.has(tokens[index].value) ? 2 : 1;
    if (tokens.slice(index, index + count).some((word) => word.expansion === 'fields'
      || word.pattern === 'glob' || !context.dialect && word.dynamic)) return true;
    index += count;
  }
  if (READ_ONLY.test(tokens[index]?.value ?? '')) return false;
  const help = tokens.findIndex((word, position) => position > at && /^(?:--help|-h)$/i.test(word.value));
  return tokens.slice(index, help < 0 ? tokens.length : help).some((word) => word.pattern === 'glob');
}

function invocation(command: ShellCommand, context: ShellContext): ShellCli | undefined {
  const tokens = command.words.filter((word) => !word.operator);
  const words = tokens.map((word) => word.value);
  const at = cliAt(words);
  if (at < 0) return undefined;
  const execution = tokens.some((word) => word.expansion === 'command');
  const uncertain = uncertainOperation(tokens, at, context);
  return { command, args: argumentsOf(words, at),
    help: words.slice(at + 1).some((word) => /^(?:--help|-h)$/i.test(word)),
    ...(execution ? { execution: true } : {}), ...(uncertain ? { uncertain: true } : {}) };
}

function bodyInput(command: ShellCommand, tokens: ShellWord[], posix: boolean): string {
  const first = tokens[0];
  if (posix || tokens.length === 1) return first.value;
  const prefix = registered(first.value)
    ? command.raw.slice(first.start - command.start, first.end - command.start) : first.value;
  return prefix + command.raw.slice(first.end - command.start);
}

export function shellBody(command: ShellCommand, context: ShellContext = {}): ShellBody | undefined {
  const tokens = command.words.filter((word) => !word.operator);
  const words = tokens.map((word) => word.value);
  const at = programAt(words);
  const program = basename(words[at] ?? '');
  const cmd = /^cmd(?:\.exe)?$/i.test(program);
  const ps = /^(?:pwsh|powershell)(?:\.exe)?$/i.test(program);
  if (!cmd && !ps && !/^(?:bash|sh|zsh)$/i.test(program)) return undefined;
  const option = words.findIndex((word, index) => index > at && (cmd ? /^\/[ck]$/i.test(word)
    : ps ? /^-(?:c|co|com|comm|comma|comman|command)$/i.test(word) : word === '-c'));
  const body = tokens.slice(option + 1);
  if (option < 0 || !body.length) return undefined;
  const input = bodyInput(command, body, !cmd && !ps);
  const code = cmd || ps ? body : body.slice(0, 1);
  const outerPatterns = context.dialect !== 'powershell' && context.dialect !== 'cmd';
  const execution = tokens.some((word) => word.expansion === 'command')
    || tokens.slice(0, at).some((word) => word.expansion === 'fields' || outerPatterns && word.pattern === 'glob')
    || tokens.slice(at + 1, option).some((word) => word.dynamic || outerPatterns && word.pattern === 'glob')
    || code.some((word) => word.expansion !== undefined || outerPatterns && word.pattern)
    || cmd && /%[^%\r\n]+%/.test(input);
  const mode = words.slice(at + 1, option).filter((word) => /^\/v:(?:on|off)$/i.test(word)).at(-1);
  return { input, execution, context: { dialect: cmd ? 'cmd' : ps ? 'powershell' : 'posix',
    delayed: cmd && mode?.toLowerCase() === '/v:on' } };
}

function nodeWordProblem(words: ShellWord[], launch: NodeLaunch): string | undefined {
  if (launch.codeAt === undefined && !launch.query && !words.some(word => nodeInlineOption(word.value))) return undefined;
  const region = words.slice(0, (launch.optionsEnd ?? words.length - 1) + 1);
  return region.some(word => word.dynamic || word.pattern === 'glob')
    ? 'Cannot statically resolve executable Node word expansion.' : undefined;
}

function unresolvedInterpreterPrefix(tokens: ShellWord[], at: number): boolean {
  const head = tokens[at];
  if (!head?.dynamic && head?.pattern !== 'glob') return false;
  if (!tokens.slice(at + 1).some(word => nodeInlineOption(word.value))) return false;
  const binding = /^\$(?:[\w:]+|\{[\w:]+\})(?:\.[\w$]+|\[[^\]]*\])*[+\-*/%]?=/;
  const assignment = at === 0 && head.value.startsWith('$')
    && (tokens[1]?.value === '=' || binding.test(head.value));
  return !assignment || tokens.slice(1).some(word => /^node(?:\.exe)?$/i.test(basename(word.value)));
}

function scanCli(input: string, depth: number, context: ShellContext = {}): CliScan {
  const parsed = shellWords(input, context.dialect === 'cmd' ? true : undefined, context);
  const result: CliScan = { calls: [], problem: parsed.problem };
  for (const command of parsed.commands) {
    const tokens = command.words.filter(word => !word.operator);
    const words = tokens.map(word => word.value);
    const program = programLocation(words);
    result.problem ??= program.problem;
    if (unresolvedInterpreterPrefix(tokens, program.at)) {
      result.problem ??= 'Cannot statically resolve the executable command word.';
    }
    if (/^node(?:\.exe)?$/i.test(basename(words[program.at] ?? ''))) {
      const launch = nodeLaunch(words.slice(program.at + 1));
      result.problem ??= launch.problem;
      result.problem ??= nodeWordProblem(tokens.slice(program.at + 1), launch);
      if (launch.code !== undefined) result.problem ??= nodeCallContext(launch.code).problem;
    }
    if (command.words.some((word) => word.expansion === 'command')) {
      result.problem ??= 'Cannot statically resolve executable shell substitution.';
    }
    const call = invocation(command, context);
    if (call) result.calls.push(call);
    const body = shellBody(command, context);
    if (!body) continue;
    if (depth >= MAX_SHELL_BODY_DEPTH) {
      result.problem ??= 'Shell command nesting exceeds the static parsing limit.';
      continue;
    }
    if (body.execution) result.problem ??= 'Cannot statically resolve executable shell interpolation.';
    const nested = scanCli(body.input, depth + 1, body.context);
    result.calls.push(...nested.calls);
    result.problem ??= nested.problem;
  }
  return result;
}

/** Static CLI invocations, including bounded explicit known-shell bodies. */
export function shellCliInvocations(input: string, depth = 0): ShellCli[] {
  return scanCli(input, depth).calls;
}

export function namedCliCommand(input: string, names: readonly string[]): ShellCli | undefined {
  return shellCliInvocations(input).find((call) => !call.help && names.some((name) => {
    const expected = name.split(' ');
    const actual = positionalArguments(call.args);
    return expected.every((word, index) => actual[index]?.toLowerCase() === word.toLowerCase());
  }));
}

function positionalArguments(args: string[]): string[] {
  const actual: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (GLOBAL_VALUE.has(args[i])) i += 1;
    else if (!args[i].startsWith('-')) actual.push(args[i]);
  }
  return actual;
}

/** Dynamic CLI writes cannot establish which authority/change they target. Harmless shell data stays data. */
export function shellCliProblem(input: string): string | undefined {
  const scan = scanCli(input, 0);
  if (scan.problem) return scan.problem;
  const unresolved = scan.calls.some((call) => call.execution || call.uncertain || !call.help
    && !READ_ONLY.test(call.args[0] ?? '')
    && call.command.words.some((word) => word.dynamic));
  return unresolved ? 'Cannot statically resolve the SDLC operation and its target.' : undefined;
}
