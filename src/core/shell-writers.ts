import * as path from 'node:path';
import { gitGlobal, toolTargets, type ToolContext } from './policy-shell-tools.js';
import { shellWords, type ShellCommand, type ShellWord } from './shell-words.js';
import { programLocation } from './shell-program.js';
import { shellBody, MAX_SHELL_BODY_DEPTH } from './shell-cli.js';
import type { ShellContext } from './shell-words.js';

/** Redirections write the file they name; they cannot replace a folder. */
const REDIRECT_OPS = [/>>?/, /\btee\b/];
/** Commands that write, move, delete or link the paths among their arguments (files or whole folders). */
const FILE_OPS = [
  /\bmv\b/, /\bcp\b/, /\brm\b/, /\btruncate\b/, /\bpython[0-9.]*\b/, /\bnode\b\s+-e/, /\bdd\b/,
  // `-i` anywhere among the options (`sed -E -i`), or in a cluster (`perl -pi`).
  /\bsed\b[^;&|\n]*\s(?:-[A-Za-z]*i|--in-place)/, /\bperl\b[^;&|\n]*\s-[A-Za-z]*i/, /\bfind\b[^;&|\n]*\s-delete\b/,
  // cmd.exe and .NET spellings.
  /\b(?:del|erase|copy|move|ren|rmdir|rd)\b/,
  /\[(?:System\.)?IO\.File\]::(?:Write|Append|Delete|Copy|Move|Replace)/, /\[(?:System\.)?IO\.Directory\]::Delete/,
  // A link is a write by proxy: the next write to the link lands in the state file.
  /\bln\b/, /\b(?:link|mklink)\b/, /\bfsutil\s+hardlink\s+create\b/,
  // git can put an older copy back, also with options before the subcommand (`git -C <dir> checkout`).
  /\bgit(?:\s+-[Cc]\s*\S+|\s+--[\w-]+(?:=\S+)?)*\s+(?:checkout|restore|apply|mv|rm)\b/,
  // PowerShell writes through cmdlets rather than redirection.
  /\b(?:Set|Add|Clear)-Content\b/, /\bOut-File\b/, /\b(?:Copy|Move|Remove|Rename|New)-Item\b/,
];

function anyOf(patterns: RegExp[]): RegExp {
  return new RegExp(patterns.map((pattern) => pattern.source).join('|'), 'i');
}

export const WRITE_OPS = anyOf([...REDIRECT_OPS, ...FILE_OPS]);
/** Write ops that can replace, delete or fill a whole folder. */
export const FOLDER_OPS = anyOf(FILE_OPS);

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

export function value(args: string[], name: string, names: string[]): string | undefined {
  for (let i = 0; i < args.length; i += 1) {
    if (parameter(args[i], names) !== name) continue;
    const inline = args[i].split(/:(.*)/s)[1];
    return inline || args[i + 1];
  }
  return undefined;
}

export function positionals(args: string[], names: string[]): string[] {
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

function copyTargets(args: string[], rename: boolean, move = false): string[] {
  const names = ['Path', 'LiteralPath', 'Destination', 'NewName', ...SWITCHES];
  const positional = positionals(args, names);
  const source = value(args, 'Path', names) ?? value(args, 'LiteralPath', names) ?? positional[0];
  const destination = value(args, rename ? 'NewName' : 'Destination', names) ?? positional[1];
  if (!rename) return [...(move && source !== undefined ? [source] : []),
    ...(destination === undefined ? [] : [destination])];
  if (source === undefined) return [];
  const old = source.replace(/\\/g, '/');
  return destination === undefined ? [old] : [old, path.posix.join(path.posix.dirname(old), destination)];
}

function shellCopyTargets(args: string[], move = false): string[] {
  const inline = args.find((arg) => arg.startsWith('--target-directory='));
  if (inline !== undefined) return [inline.slice('--target-directory='.length),
    ...(move ? args.filter(arg => !arg.startsWith('-') && arg !== inline) : [])];
  const at = args.findIndex((arg) => arg === '-t' || arg === '--target-directory');
  if (at >= 0) return args[at + 1] === undefined ? [] : [args[at + 1],
    ...(move ? args.slice(at + 2).filter(arg => !arg.startsWith('-')) : [])];
  const operands = args.filter((arg) => !arg.startsWith('-'));
  return operands.length < 2 ? [] : move ? operands : [operands[operands.length - 1]];
}

/** Command openers and execution wrappers are not the writer's program. */
export function writerProgramLocation(words: string[], cwd?: string): ReturnType<typeof programLocation> {
  let at = 0;
  while (/^(?:if|while|until|then|do|else|elif|!|\{|builtin)$/i.test(words[at] ?? '')) at += 1;
  if (/^\$[A-Za-z_]\w*$/.test(words[at] ?? '') && words[at + 1] === '=') at += 2;
  while (/^(?:time|nohup|nice)$/i.test(words[at] ?? '')) {
    const wrapper = words[at++].toLowerCase();
    if (wrapper === 'time' && words[at] === '-p') at += 1;
    if (wrapper !== 'nice') continue;
    if (words[at] === '-n' || words[at] === '--adjustment') at += 2;
    else if (/^(?:-\d+|--adjustment=.+)$/.test(words[at] ?? '')) at += 1;
  }
  const location = programLocation(words.slice(at), cwd);
  return { ...location, at: location.at < 0 ? -1 : at + location.at };
}

/** Only command arguments reach a writer; redirect operands do not. */
export function writerArguments(command: ShellCommand): ShellWord[] {
  const args: ShellWord[] = [];
  for (let i = 0; i < command.words.length; i += 1) {
    const word = command.words[i];
    if (word.operator) {
      if (/[<>]/.test(word.value) && command.words[i + 1] && !command.words[i + 1].operator) i += 1;
      continue;
    }
    args.push(word);
  }
  return args;
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

export interface WriterTargets {
  targets: string[];
  folders?: boolean;
}

type Writer = (verb: string, args: string[], ctx: ToolContext) => WriterTargets;

function files(targets: string[], folders = false): WriterTargets {
  return { targets, folders };
}

function teeTargets(args: string[]): string[] {
  const names = ['FilePath', 'LiteralPath', 'Path', 'Variable', ...SWITCHES];
  const named = value(args, 'FilePath', names) ?? value(args, 'LiteralPath', names);
  return named === undefined ? positionals(args, names) : [named];
}

function touchTargets(verb: string, args: string[]): string[] {
  const operands = positionals(args, ['Size', 'Reference', ...SWITCHES]);
  if (verb.toLowerCase() !== 'truncate') return operands;
  const size = args.findIndex((arg) => arg === '-s' || arg === '--size');
  return args.filter((arg, i) => !arg.startsWith('-') && i !== size + 1);
}

const WRITERS: Array<[RegExp, Writer]> = [
  [CONTENT, (verb, args) => files(contentTargets(args, verb))],
  [COPY, (verb, args) => files(copyTargets(args, false, /^(?:Move-Item|mi|move)$/i.test(verb)), true)],
  [RENAME, (_verb, args) => files(copyTargets(args, true), true)],
  [/^(?:cp|mv|install|ln|link)$/i, (verb, args) => files(shellCopyTargets(args, /^mv$/i.test(verb)), true)],
  [/^(?:tee|Tee-Object)$/i, (_verb, args) => files(teeTargets(args))],
  [FILE_METHOD, (_verb, args) => files(args.slice(0, 1))],
  [/^(?:touch|truncate)$/i, (verb, args) => files(touchTargets(verb, args))],
  [/^dd$/i, (_verb, args) => files(args.filter(arg => arg.startsWith('of=')).map(arg => arg.slice(3)))],
  [/^(?:sed|perl)$/i, (verb, args) => files([...inPlaceTargets(args), ...scriptWriteTargets(verb, args)])],
  [/^(?:awk|gawk)$/i, (verb, args) => files(scriptWriteTargets(verb, args))],
  [/^(?:Invoke-WebRequest|iwr|Invoke-RestMethod|irm)$/i, (_verb, args) => files(webTargets(args))],
  [/^git(?:\.exe)?$/i, (verb, args, ctx) => files(toolTargets(verb, args, ctx), gitFolders(args))],
  [/^(?:patch|curl|wget|node|python3?|py)(?:\.exe)?$/i,
    (verb, args, ctx) => files(toolTargets(verb, args, ctx))],
  [/^(?:rm|rmdir|unlink|del|erase|rd)$/i, (_verb, args) => files(deleteTargets(args), true)],
  [/^(?:Remove-Item|ri|rm|rmdir|del|erase|rd)$/i,
    (verb, args) => files(psDeleteTargets(verb, args), true)],
  [/^sort$/i, (_verb, args) => files(outputOption(args, ['-o', '--output']))],
  [/^rsync$/i, (_verb, args) => files(rsyncTargets(args), true)],
  [/^tar$/i, (_verb, args) => tarTargets(args)],
  [/^(?:chmod|chown|chgrp)$/i, (_verb, args) => files(modeTargets(args))],
  [/^sponge$/i, (_verb, args) => files(args.filter(arg => !arg.startsWith('-')))],
  [/^yq$/i, (_verb, args) => files(yqTargets(args))],
  [/^(?:Export-Csv|Export-Clixml)$/i, (_verb, args) => files(psPath(args))],
  [/^(?:Set-Item|si)$/i, (_verb, args) => files(psPath(args))],
  [/^(?:Start-Process|saps)$/i, (_verb, args) => files(startRedirects(args))],
  [/^\[(?:System\.)?IO\.(?:StreamWriter|FileStream)\]::new$/i, (_verb, args) => files(args.slice(0, 1))],
  [/^New-Object$/i, (_verb, args) => files(newObjectTargets(args))],
  [/^\[(?:System\.)?IO\.FileInfo\]::new$/i, (_verb, args) => files(fileInfoTargets(args))],
];

function outputOption(args: string[], options: string[]): string[] {
  const targets: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    for (const option of options) {
      if (arg === option && args[i + 1]) targets.push(args[i + 1]);
      if (arg.startsWith(`${option}=`)) targets.push(arg.slice(option.length + 1));
      if (option === '-o' && arg.startsWith('-o') && arg.length > 2) targets.push(arg.slice(2));
      if (option === '-o' && /^-[A-Za-z]+o$/.test(arg) && args[i + 1]) targets.push(args[i + 1]);
    }
  }
  return targets.filter(target => target !== '-');
}

function deleteTargets(args: string[]): string[] {
  return args.filter(arg => !arg.startsWith('-') && !/^\/[sq]$/i.test(arg));
}

function psDeleteTargets(verb: string, args: string[]): string[] {
  if (!/^(?:Remove-Item|ri)$/i.test(verb)) return deleteTargets(args);
  return psPath(args);
}

function psPath(args: string[]): string[] {
  const names = ['Path', 'LiteralPath', 'InputObject', 'Value', ...SWITCHES];
  const named = value(args, 'Path', names) ?? value(args, 'LiteralPath', names);
  const target = named ?? positionals(args, names)[0];
  return target === undefined ? [] : [target];
}

function rsyncTargets(args: string[]): string[] {
  const operands = args.filter(arg => !arg.startsWith('-'));
  const last = operands.at(-1);
  if (last === undefined) return [];
  const remote = /^[^/\\]+:/.test(last) && !/^[A-Za-z]:[\\/]/.test(last);
  return remote ? [] : [last];
}

function tarTargets(args: string[]): WriterTargets {
  const oldStyle = /^[a-z]*[crutxf][a-z]*$/i.test(args[0] ?? '') ? args[0] : '';
  const flags = [...args.filter(arg => arg.startsWith('-')), ...(oldStyle ? [`-${oldStyle}`] : [])].join(' ');
  if (/(?:^|\s)-O(?:\s|$)/.test(flags)) return files([]);
  if (/(?:^|\s)(?:--list|-[a-z]*t)/i.test(flags)) return files([]);
  if (/(?:^|\s)(?:--extract|-[a-z]*x)/i.test(flags)) return files(outputOption(args, ['-C', '--directory']), true);
  if (!/(?:^|\s)(?:--create|--append|--update|-[a-z]*[cru])/i.test(flags)) return files([]);
  const bundled = args.findIndex(arg => /^-?[a-z]*f$/i.test(arg));
  const output = outputOption(args, ['-f', '--file']);
  if (bundled >= 0 && args[bundled + 1]) output.push(args[bundled + 1]);
  return files(output);
}

function modeTargets(args: string[]): string[] {
  if (args.includes('--help')) return [];
  const operands = args.filter(arg => !arg.startsWith('-'));
  return operands.slice(1);
}

function yqTargets(args: string[]): string[] {
  if (!args.some(arg => arg === '-i' || arg === '--inplace')) return [];
  return args.filter(arg => !arg.startsWith('-')).slice(1);
}

function startRedirects(args: string[]): string[] {
  const names = ['RedirectStandardOutput', 'RedirectStandardError'];
  return names.flatMap(name => value(args, name, names) ?? []);
}

function newObjectTargets(args: string[]): string[] {
  if (!/^(?:(?:System\.)?IO\.)?(?:StreamWriter|FileStream)$/i.test(args[0] ?? '')) return [];
  return args.slice(1, 2);
}

function fileInfoTargets(args: string[]): string[] {
  return args.some(arg => /^\.(?:Delete|MoveTo|CopyTo|Create)$/i.test(arg)) ? args.slice(0, 1) : [];
}

function gitFolders(args: string[]): boolean {
  const global = gitGlobal(args);
  return /^(?:checkout|restore|mv|rm|apply|format-patch)$/.test(args[global.at] ?? '');
}

export function writerTargets(verb: string, args: string[], ctx: ToolContext): WriterTargets {
  const name = path.posix.basename(verb.replace(/\\/g, '/'));
  const rule = WRITERS.find(([pattern]) => pattern.test(name));
  if (!rule) return files([]);
  const full = rule[1](name, args, ctx);
  const comment = args.findIndex((arg) => arg.startsWith('#'));
  if (comment < 0) return full;
  const prefix = rule[1](name, args.slice(0, comment), ctx);
  return files([...new Set([...prefix.targets, ...full.targets])], full.folders || prefix.folders);
}

/** Git operations whose worktree targets are implicit. This is only for the plan gate and locked tests. */
function gitMutatesTree(args: string[]): boolean {
  const global = gitGlobal(args);
  const sub = args[global.at];
  const rest = args.slice(global.at + 1);
  if (sub === 'stash') return !/^(?:list|show|drop|clear|create|store)$/.test(rest[0] ?? '');
  if (sub === 'reset') return rest.some(arg => /^(?:--hard|--merge|--keep)$/.test(arg));
  if (sub === 'clean') return !rest.some(arg => arg === '--dry-run' || /^-[A-Za-z]*n/.test(arg))
    && rest.some(arg => arg === '--force' || /^-[A-Za-z]*f/.test(arg));
  return false;
}

function gitTreeHere(words: string[], dir: string | undefined): boolean {
  const location = writerProgramLocation(words, dir);
  if (!/^git(?:\.exe)?$/i.test(words[location.at] ?? '')) return false;
  const args = words.slice(location.at + 1);
  return gitMutatesTree(args);
}

function treeInBody(command: string, root: string, cwd: string | undefined,
  depth: number, context: ShellContext): boolean {
  let dir = cwd;
  const stack: Array<string | undefined> = [];
  const parsed = shellWords(command, context.dialect === 'cmd' ? true : undefined, context);
  for (const part of parsed.commands) {
    const words = writerArguments(part).map(word => word.value);
    const head = words[0] ?? '';
    if (/^(?:popd|Pop-Location)$/i.test(head)) {
      dir = stack.pop();
      continue;
    }
    if (/^(?:cd|chdir|pushd|Set-Location|sl|Push-Location)$/i.test(head)) {
      if (/^push/i.test(head)) stack.push(dir);
      dir = dir === undefined || !words[1] || /[$`~%]/.test(words[1])
        ? undefined : path.resolve(dir, words[1]);
      continue;
    }
    if (gitTreeHere(words, dir)) return true;
    const body = shellBody(part, context);
    if (body && depth < MAX_SHELL_BODY_DEPTH) {
      const execution = writerProgramLocation(words, dir);
      if (treeInBody(body.input, root, execution.dir, depth + 1, body.context)) return true;
    }
  }
  return false;
}

export function wholeTreeGitWrite(command: string, root: string, cwd: string): boolean {
  return treeInBody(command, root, cwd, 0, {});
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
