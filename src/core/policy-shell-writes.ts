import * as path from 'node:path';
import { absolute, isDirCommand, moveTo, relToRoot, simpleCommands, type DirState } from './policy-shell.js';
import { patchFiles } from './policy-patch-files.js';
import { scanShell } from './policy-shell-scanner.js';
import { isWebRequest, toolTargets, type ToolContext } from './policy-shell-tools.js';
import { decodedShellWords } from './shell-words.js';
import { programLocation } from './shell-program.js';

/** Files a shell command writes, root-relative. Quoted text and here-document bodies are data. */
const NULL_SINKS = /^(?:\/dev\/null|\$null|nul)$/i;
const CONTENT = /^(?:Set-Content|Add-Content|Clear-Content|Out-File|New-Item|sc|ac|clc|ni)$/i;
const COPY = /^(?:Copy-Item|Move-Item|cpi|mi|copy|move)$/i;
const RENAME = /^(?:Rename-Item|ren|rni)$/i;
const FILE_METHOD = new RegExp(
  '^\\[(?:System\\.)?IO\\.File\\]::(?:WriteAll(?:Text|Lines|Bytes)|AppendAll(?:Text|Lines)|Create|Delete)$',
  'i',
);
const SWITCHES = ['Force', 'NoNewline', 'Append', 'NoClobber', 'Recurse', 'PassThru', 'WhatIf', 'Confirm', 'Container'];
const VALUE_OPTIONS = ['ItemType', 'Encoding', 'Stream', 'Width'];
const WEB_NAMES = ['Uri', 'OutFile', 'Method', 'Headers', 'Body', 'ContentType', 'UseBasicParsing', 'Credential'];
const START_NAMES = ['FilePath', 'ArgumentList', 'WorkingDirectory', 'Verb', 'WindowStyle', 'Wait', 'NoNewWindow'];
const EXPRESSION = /^(?:iex|Invoke-Expression)$/i;
const START_PROCESS = /^(?:Start-Process|saps)$/i;
const MAX_DEPTH = 3;

interface Word {
  value: string;
  operator?: boolean;
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

function words(segment: string): Word[] {
  const windows = /^\s*(?:\[|[A-Za-z]+-[A-Za-z]+|(?:cmd|robocopy|xcopy)\b)/i.test(segment);
  return decodedShellWords(segment, windows);
}

function redirects(tokens: Word[]): { targets: string[]; args: string[]; inputs: string[] } {
  const targets: string[] = [];
  const args: string[] = [];
  const inputs: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.value === '>' && token.operator) {
      const next = tokens[i + 1]?.value;
      if (next !== undefined && !/^&(?:\d+|-)$/.test(next)) {
        targets.push(next);
      }
      i += 1;
      continue;
    }
    if (token.operator) {
      inputs.push(...inputOf(token, tokens[i + 1]));
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

function parameter(word: string, names: string[]): string | undefined {
  const name = word.split(':', 1)[0];
  if (!name.startsWith('-')) return undefined;
  const exact = names.find((candidate) => candidate.toLowerCase() === name.slice(1).toLowerCase());
  if (exact !== undefined) return exact;
  const matches = names.filter((candidate) => candidate.toLowerCase().startsWith(name.slice(1).toLowerCase()));
  const values = matches.filter((candidate) => !SWITCHES.includes(candidate));
  if (values.length === 1) return values[0];
  return matches.length === 1 ? matches[0] : undefined;
}

function value(args: string[], name: string, names: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (parameter(args[i], names) !== name) continue;
    const inline = args[i].split(/:(.*)/s)[1];
    return inline || args[i + 1];
  }
  return undefined;
}

function positionals(args: string[], names: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i];
    if (!word.startsWith('-')) {
      out.push(word);
      continue;
    }
    const name = parameter(word, names);
    if (name !== undefined && !SWITCHES.includes(name) && !word.includes(':')) i += 1;
  }
  return out;
}

function contentTargets(args: string[], verb: string): string[] {
  const names = ['Path', 'LiteralPath', 'FilePath', 'PSPath', 'Value', 'Name', ...VALUE_OPTIONS, ...SWITCHES];
  const named = value(args, /Out-File/i.test(verb) ? 'FilePath' : 'Path', names)
    ?? value(args, 'LiteralPath', names) ?? value(args, 'FilePath', names)
    ?? positionals(args, names)[0];
  const name = value(args, 'Name', names);
  if (named === undefined) return name === undefined ? [] : [name];
  return [name === undefined ? named : `${named}/${name}`];
}

function copyTargets(args: string[], rename: boolean): string[] {
  const names = ['Path', 'LiteralPath', 'Destination', 'NewName', ...SWITCHES];
  const positional = positionals(args, names);
  const source = value(args, 'Path', names) ?? value(args, 'LiteralPath', names) ?? positional[0];
  const destination = value(args, rename ? 'NewName' : 'Destination', names) ?? positional[1];
  if (!rename) return destination === undefined ? [] : [destination];
  if (source === undefined) return [];
  const old = source.replace(/\\/g, '/');
  return destination === undefined ? [old] : [old, path.posix.join(path.posix.dirname(old), destination)];
}

function shellCopyTargets(args: string[]): string[] {
  const inline = args.find((arg) => arg.startsWith('--target-directory='));
  if (inline !== undefined) return [inline.slice('--target-directory='.length)];
  const at = args.findIndex((arg) => arg === '-t' || arg === '--target-directory');
  if (at >= 0) return args[at + 1] === undefined ? [] : [args[at + 1]];
  const operands = args.filter((arg) => !arg.startsWith('-'));
  return operands.length < 2 ? [] : [operands[operands.length - 1]];
}

function inPlaceTargets(args: string[]): string[] {
  const inplace = args.some((arg) =>
    /^--in-place(?:=.*)?$/.test(arg) || /^-[A-Za-z]*i(?:[A-Za-z]*|\..*|'.*')$/.test(arg));
  if (!inplace) return [];
  const scriptIndex = args.findIndex((arg) => arg === '-e' || arg === '--expression');
  const ignored = new Set<number>();
  if (scriptIndex >= 0) ignored.add(scriptIndex + 1);
  let scriptSeen = scriptIndex >= 0;
  return args.filter((arg, i) => {
    if (arg.startsWith('-') || ignored.has(i)) return false;
    if (!scriptSeen) {
      scriptSeen = true;
      return false;
    }
    return true;
  });
}

function commandTargets(verb: string, args: string[]): string[] {
  if (CONTENT.test(verb)) return contentTargets(args, verb);
  if (COPY.test(verb)) return copyTargets(args, false);
  if (RENAME.test(verb)) return copyTargets(args, true);
  if (/^(?:cp|mv|install)$/.test(verb)) return shellCopyTargets(args);
  if (/^(?:tee|Tee-Object)$/i.test(verb)) {
    const names = ['FilePath', 'LiteralPath', 'Path', 'Variable', ...SWITCHES];
    const named = value(args, 'FilePath', names) ?? value(args, 'LiteralPath', names);
    return named === undefined ? positionals(args, names) : [named];
  }
  if (FILE_METHOD.test(verb)) return args.slice(0, 1);
  if (/^(?:touch|truncate)$/i.test(verb)) {
    const operands = positionals(args, ['Size', 'Reference', ...SWITCHES]);
    if (verb.toLowerCase() !== 'truncate') return operands;
    const size = args.findIndex((arg) => arg === '-s' || arg === '--size');
    return args.filter((arg, i) => !arg.startsWith('-') && i !== size + 1);
  }
  if (/^dd$/i.test(verb)) return args.filter((arg) => arg.startsWith('of=')).map((arg) => arg.slice(3));
  if (/^(?:sed|perl)$/i.test(verb)) return [...inPlaceTargets(args), ...scriptWriteTargets(verb, args)];
  if (/^(?:awk|gawk)$/i.test(verb)) return scriptWriteTargets(verb, args);
  if (isWebRequest(verb)) return webTargets(args);
  return [];
}

/** sed's w command and awk output redirections write even when the program is otherwise a reader. */
function scriptWriteTargets(verb: string, args: string[]): string[] {
  const expression = args.filter((arg) => !arg.startsWith('-')).join('\n');
  const pattern = /^sed$/i.test(verb) ? /(?:^|[;\n])\s*(?:\d+(?:,\d+)?)?w\s+([^;\n]+)/g
    : />{1,2}\s*(['"])([^'"]+)\1/g;
  return [...expression.matchAll(pattern)].map((match) => (match[2] ?? match[1]).trim());
}

/** `Invoke-WebRequest`/`iwr` `-OutFile <file>` (a unique prefix like `-OutF` counts). */
function webTargets(args: string[]): string[] {
  const file = value(args, 'OutFile', WEB_NAMES);
  return file === undefined ? [] : [file];
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

function commandWords(segment: string): Parsed {
  const parsed = redirects(words(afterCondition(segment)));
  const list = parsed.args;
  const candidates = list.filter((word) => !/^(?:&|\.|\{|\})$/.test(word));
  const [verb, ...args] = candidates;
  return { targets: parsed.targets, verb, args, inputs: parsed.inputs };
}

function nestedCommand(verb: string, args: string[]): string | undefined {
  const unix = /^(?:bash|sh|zsh)$/i.test(verb);
  const cmd = /^cmd(?:\.exe)?$/i.test(verb);
  const ps = /^(?:powershell|pwsh)(?:\.exe)?$/i.test(verb);
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
  return option < 0 ? undefined : args[option + 1];
}

/** `iex <string>` / `Invoke-Expression -Command <string>`: the string is a command again. */
function expressionCommand(args: string[]): string | undefined {
  const names = ['Command'];
  return value(args, 'Command', names) ?? positionals(args, names)[0];
}

/** `Start-Process <shell> -ArgumentList <string>`: the shell's command line, parsed again. */
function startProcessCommand(args: string[]): string | undefined {
  const file = value(args, 'FilePath', START_NAMES) ?? positionals(args, START_NAMES)[0];
  const list = value(args, 'ArgumentList', START_NAMES) ?? positionals(args, START_NAMES)[1];
  if (file === undefined || list === undefined) return undefined;
  if (!/^(?:powershell|pwsh|cmd|bash|sh)(?:\.exe)?$/i.test(file)) return undefined;
  const inner = words(list).map((word) => word.value);
  const option = inner.findIndex((arg) => /^(?:-c|-command|\/c|\/k)$/i.test(arg) || /^-co/i.test(arg));
  return option < 0 ? undefined : inner.slice(option + 1).join(' ');
}

/** A command carried in a string argument: nested shells, `iex`, `Start-Process`. */
function innerCommand(verb: string, args: string[]): string | undefined {
  if (EXPRESSION.test(verb)) return expressionCommand(args);
  if (START_PROCESS.test(verb)) return startProcessCommand(args);
  return nestedCommand(verb, args);
}

function segmentTargets(parsed: Parsed, verb: string, dir: string | undefined): string[] {
  const ctx: ToolContext = { dir, inputs: parsed.inputs };
  return [...commandTargets(verb, parsed.args), ...toolTargets(verb, parsed.args, ctx)];
}

/** Absolute destinations before project containment, shared by protected-state and ordinary write views. */
export function shellWriteDestinationPaths(command: string, cwd: string, depth = 0): string[] {
  const source = heredocs(command);
  const destinations = new Set<string>();
  const state: DirState = { dir: path.resolve(cwd), stack: [] };
  const add = (word: string, dir = state.dir) => {
    if (NULL_SINKS.test(word)) return;
    const abs = absolute(dir, word.replace(/\\/g, '/'));
    if (abs !== undefined && abs !== '') destinations.add(abs);
  };
  for (const segment of simpleCommands(source.text)) {
    const parsed = commandWords(segment);
    if (parsed.verb !== undefined && isDirCommand(parsed.verb)) {
      moveTo(state, parsed.verb, parsed.args);
      continue;
    }
    parsed.targets.forEach(word => add(word));
    if (parsed.verb !== undefined) {
      const list = [parsed.verb, ...parsed.args];
      const execution = programLocation(list, state.dir);
      if (execution.at < 0) continue;
      const verb = list[execution.at];
      const args = parsed.args.slice(execution.at);
      segmentTargets({ ...parsed, args }, verb, execution.dir).forEach(word => add(word, execution.dir));
      const nested = innerCommand(verb, args);
      if (nested !== undefined && depth < MAX_DEPTH && execution.dir !== undefined) {
        const inner = /^cmd(?:\.exe)?$/i.test(verb) ? nested.replace(/\\/g, '/') : nested;
        shellWriteDestinationPaths(inner, execution.dir, depth + 1).forEach((file) => destinations.add(file));
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
