import * as path from 'node:path';
import { absolute, isDirCommand, moveTo, relToRoot, simpleCommands, type DirState } from './policy-shell.js';
import { patchFiles } from './policy-patch-files.js';
import { scanShell } from './policy-shell-scanner.js';
import { type ToolContext } from './policy-shell-tools.js';
import { writerTargets, writerProgramLocation, value, positionals } from './shell-writers.js';
import { shellWords, type ShellContext } from './shell-words.js';
import { POSIX_SHELL_NAME } from './shell-program.js';
import { NULL_SINKS, harmlessRedirect } from './shell-redirects.js';

/** Files a shell command writes, root-relative. Quoted text and here-document bodies are data. */
const START_NAMES = ['FilePath', 'ArgumentList', 'WorkingDirectory', 'Verb', 'WindowStyle', 'Wait', 'NoNewWindow'];
const EXPRESSION = /^(?:iex|Invoke-Expression)$/i;
const START_PROCESS = /^(?:Start-Process|saps)$/i;
const MAX_DEPTH = 3;

interface Word {
  value: string;
  operator?: boolean;
  start: number;
  end: number;
}

function heredocMarker(line: string): string | undefined {
  let marker: string | undefined;
  scanShell(line, (char, i, quoted) => {
    if (quoted || char !== '<' || line[i + 1] !== '<' || marker !== undefined) {
      return;
    }
    marker = /^<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1/.exec(line.slice(i))?.[2];
  });
  return marker;
}

/** Remove sh here-document bodies, retaining an apply_patch body as patch input. */
function heredocs(command: string): { text: string; patches: string[] } {
  const kept: string[] = [];
  const patches: string[] = [];
  let end: string | undefined;
  let patch = false;
  for (const line of command.split(/\r?\n/)) {
    if (end !== undefined) {
      if (line.trim() === end) {
        end = undefined;
        patch = false;
      } else if (patch) {
        patches.push(line);
      }
      continue;
    }
    kept.push(line);
    end = heredocMarker(line);
    patch = end !== undefined && /(?:^|[;&|\s])apply_patch\s+<</.test(line);
  }
  return { text: kept.join('\n'), patches: patchFiles(patches.join('\n')) };
}

export function withoutHeredocs(command: string): string {
  return heredocs(command).text;
}

function words(segment: string, context: ShellContext): Word[] {
  const windows = /^\s*(?:\[|[A-Za-z]+-[A-Za-z]+|(?:cmd|robocopy|xcopy)\b)/i.test(segment);
  return shellWords(segment, context.dialect === 'cmd' || windows, context)
    .commands.flatMap((command) => command.words);
}

function redirects(tokens: Word[], segment: string): { targets: string[]; args: string[]; inputs: string[] } {
  const targets: string[] = [];
  const args: string[] = [];
  const inputs: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.value === '>' && token.operator) {
      const separator = tokens[i + 1]?.value === '&' ? 1 : 0;
      const next = tokens[i + 1 + separator]?.value;
      if (next !== undefined && !harmlessRedirect(next)) {
        targets.push(next.startsWith('&') ? next.slice(1) : next);
      }
      i += 1 + separator;
      continue;
    }
    if (token.operator) {
      inputs.push(...inputOf(token, tokens[i + 1]));
      if (token.value === '<' && tokens[i + 1] && !tokens[i + 1].operator) i += 1;
      continue;
    }
    if (/^(?:\d+|\*)$/.test(token.value) && tokens[i + 1]?.value === '>') continue;
    args.push(token.value);
  }
  return { targets, args, inputs };
}

function inputOf(token: Word, next: Word | undefined): string[] {
  if (token.value !== '<' || next === undefined || next.operator) return [];
  return [next.value];
}

function afterCondition(segment: string): string {
  const match = /^\s*(?:if|elseif|foreach|while)\s*\(/i.exec(segment);
  if (match === null) {
    return segment.replace(/^\s*(?:try|catch|else|finally)\b/i, '');
  }
  let depth = 1;
  let end = match[0].length;
  scanShell(segment.slice(end), (char, i, quoted) => {
    if (quoted || depth === 0) {
      return;
    }
    if (char === '(') {
      depth += 1;
    }
    if (char === ')') {
      depth -= 1;
    }
    if (depth === 0) {
      end += i + 1;
    }
  });
  return depth === 0 ? segment.slice(end) : '';
}

interface Parsed {
  targets: string[];
  verb?: string;
  args: string[];
  inputs: string[];
}

function commandWords(segment: string, context: ShellContext): Parsed {
  const source = afterCondition(segment);
  const parsed = redirects(words(source, context), source);
  const list = parsed.args;
  const first = list.findIndex((word) => !/^(?:&|\.|\{|\})$/.test(word));
  const candidates = list.slice(first < 0 ? list.length : first);
  const [verb, ...args] = candidates;
  return { targets: parsed.targets, verb, args, inputs: parsed.inputs };
}

function nestedCommand(verb: string, args: string[]): string | undefined {
  const name = path.posix.basename(verb.replace(/\\/g, '/'));
  const unix = POSIX_SHELL_NAME.test(name);
  const cmd = /^cmd(?:\.exe)?$/i.test(name);
  const ps = /^(?:powershell|pwsh)(?:\.exe)?$/i.test(name);
  if (!unix && !cmd && !ps) {
    return undefined;
  }
  const option = args.findIndex((arg) => {
    if (unix) {
      return arg === '-c';
    }
    if (cmd) {
      return /^\/[ck]$/i.test(arg);
    }
    return /^-(?:c|co|com|comm|comma|comman|command)$/i.test(arg);
  });
  return option < 0 ? undefined : cmd || ps ? args.slice(option + 1).join(' ') : args[option + 1];
}

/** `iex <string>` / `Invoke-Expression -Command <string>`: the string is a command again. */
function expressionCommand(args: string[]): string | undefined {
  const names = ['Command'];
  return value(args, 'Command', names) ?? positionals(args, names).join(' ');
}

/** `Start-Process <shell> -ArgumentList <string>`: the shell's command line, parsed again. */
function startProcessCommand(args: string[]): string | undefined {
  const file = value(args, 'FilePath', START_NAMES) ?? positionals(args, START_NAMES)[0];
  const list = value(args, 'ArgumentList', START_NAMES) ?? positionals(args, START_NAMES)[1];
  if (file === undefined || list === undefined) return undefined;
  const name = path.posix.basename(file.replace(/\\/g, '/'));
  const shell = POSIX_SHELL_NAME.test(name) || /^(?:powershell|pwsh|cmd)(?:\.exe)?$/i.test(name);
  if (!shell) return undefined;
  const inner = words(list, {}).map((word) => word.value);
  const option = inner.findIndex((arg) => /^(?:-c|-command|\/c|\/k)$/i.test(arg) || /^-co/i.test(arg));
  return option < 0 ? undefined : inner.slice(option + 1).join(' ');
}

/** A command carried in a string argument: nested shells, `iex`, `Start-Process`. */
function innerCommand(verb: string, args: string[]): string | undefined {
  if (/^eval$/i.test(verb)) return (args[0] === '--' ? args.slice(1) : args).join(' ');
  if (EXPRESSION.test(verb)) return expressionCommand(args);
  if (START_PROCESS.test(verb)) return startProcessCommand(args);
  return nestedCommand(verb, args);
}

function segmentTargets(parsed: Parsed, verb: string, dir: string | undefined, segment: string): string[] {
  const ctx: ToolContext = { dir, inputs: parsed.inputs };
  const targets = writerTargets(verb, parsed.args, ctx).targets;
  if (!/^(?:Remove-Item|ri)$/i.test(verb)) return targets;
  // Parentheses are discarded by the shell lexer; their first word is an expression, not a file name.
  const words = shellWords(segment, true).commands.flatMap(part => part.words).filter(word => !word.operator);
  return targets.filter(target => {
    const word = words.find((candidate, index) => index > 0 && candidate.value === target);
    return word === undefined || !segment.slice(0, word.start).trimEnd().endsWith('(');
  });
}

/** Absolute destinations before project containment, shared by protected-state and ordinary write views. */
export function shellWriteDestinationPaths(command: string, cwd: string, depth = 0,
  context: ShellContext = {}): string[] {
  const source = heredocs(command);
  const destinations = new Set<string>();
  const state: DirState = { dir: path.resolve(cwd), stack: [] };
  const add = (word: string, dir = state.dir) => {
    if (NULL_SINKS.test(word)) return;
    const abs = absolute(dir, word.replace(/\\/g, '/'));
    if (abs !== undefined && abs !== '') destinations.add(abs);
  };
  for (const segment of simpleCommands(source.text, context)) {
    const parsed = commandWords(segment, context);
    if (parsed.verb !== undefined && isDirCommand(parsed.verb)) {
      moveTo(state, parsed.verb, parsed.args);
      continue;
    }
    parsed.targets.forEach(word => add(word));
    if (parsed.verb !== undefined) {
      const list = [parsed.verb, ...parsed.args];
      const execution = writerProgramLocation(list, state.dir);
      if (execution.at < 0) continue;
      const verb = list[execution.at];
      if (verb === undefined) continue;
      const args = parsed.args.slice(execution.at);
      segmentTargets({ ...parsed, args }, verb, execution.dir, segment).forEach(word => add(word, execution.dir));
      const nested = innerCommand(verb, args);
      if (nested !== undefined && depth < MAX_DEPTH && execution.dir !== undefined) {
        const name = path.posix.basename(verb.replace(/\\/g, '/'));
        const inner = /^cmd(?:\.exe)?$/i.test(name) ? nested.replace(/\\/g, '/') : nested;
        const dialect = /^cmd(?:\.exe)?$/i.test(name) ? 'cmd'
          : /^(?:pwsh|powershell)(?:\.exe)?$/i.test(name) ? 'powershell' : 'posix';
        shellWriteDestinationPaths(inner, execution.dir, depth + 1, { dialect })
          .forEach((file) => destinations.add(file));
      }
    }
  }
  source.patches.forEach(word => add(word));
  return [...destinations];
}

/** Project files (root-relative, posix) a shell command writes. */
export function shellWriteDestinations(command: string, root: string, cwd: string, depth = 0): string[] {
  return shellWriteDestinationPaths(command, cwd, depth)
    .map(file => relToRoot(root, root, file)).filter((file): file is string => file !== undefined && file !== '');
}
