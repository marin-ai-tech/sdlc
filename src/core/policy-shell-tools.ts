import * as fs from 'node:fs';
import * as path from 'node:path';
import { patchFiles } from './policy-patch-files.js';
import { readOnlyFileOpening } from './node-read-options.js';
import { nodeInlineCode } from './node-inline.js';
import { nodeCallContext, type NodeCallContext } from './node-call-context.js';
import { nodeLiteralValue } from './node-literal.js';

/**
 * More shell writers for the plan gate (B84, 0.14.2): git, patch, downloads and one-line interpreters.
 * Each helper returns the words it writes, relative to the command's directory (the caller resolves them).
 */
export interface ToolContext {
  /** The command's directory, undefined when it cannot be known. */
  dir: string | undefined;
  /** Files read through `<`. */
  inputs: string[];
}

const GIT_VALUE_OPTIONS = /^(?:-C|-c|--git-dir|--work-tree|--namespace|--exec-path|--config-env)$/;
const PATCH_INFO = /^--(?:check|stat|numstat|summary)$/;
const PY_PAIR = /\b(copy|copy2|copyfile|rename|replace)\s*\(\s*(['"])([^'"]+)\2\s*,\s*(['"])([^'"]+)\4/g;
const NODE_CALL = /\b([A-Za-z_$][\w$]*)\s*\(\s*(['"`])([^'"`]+)\2/g;
const NODE_LITERAL = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;
const NODE_DATA_WRITER = /^(?:writeFileSync|appendFileSync|writeFile|appendFile)$/;
const NODE_READ = /^(?:require|copyFile(?:Sync)?|readlink(?:Sync)?|readdir(?:Sync)?|stat(?:Sync)?|lstat(?:Sync)?|realpath(?:Sync)?|existsSync|access(?:Sync)?|log|info|warn|error|debug|stringify|parse|write)$/;
const PY_OPEN = /\bopen\s*\(\s*(['"])([^'"]+)\1([^)]*)\)/g;
const PY_MODE = /^\s*,\s*(?:mode\s*=\s*)?(['"])([^'"]*)\1|,\s*mode\s*=\s*(['"])([^'"]*)\3/;
const WEB_REQUEST = /^(?:Invoke-WebRequest|iwr|Invoke-RestMethod|irm)$/i;

/** The value after an option, `--name=value` or the next word. */
function optionValue(args: string[], i: number, long: string): string | undefined {
  const arg = args[i];
  if (arg.startsWith(`${long}=`)) return arg.slice(long.length + 1);
  return args[i + 1];
}

/** git's global options before the subcommand: the `-C` directory and the subcommand's index. */
function gitGlobal(args: string[]): { dir: string; at: number } {
  let dir = '';
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (args[i] === '-C' && args[i + 1] !== undefined) dir = path.posix.join(dir, args[i + 1].replace(/\\/g, '/'));
    i += GIT_VALUE_OPTIONS.test(args[i]) ? 2 : 1;
  }
  return { dir, at: i };
}

function afterDashes(args: string[]): string[] {
  const at = args.indexOf('--');
  return at < 0 ? [] : args.slice(at + 1);
}

function restoreTargets(args: string[]): string[] {
  const staged = args.some((arg) => arg === '--staged' || arg === '-S');
  const worktree = args.some((arg) => arg === '--worktree' || arg === '-W');
  if (staged && !worktree) return [];
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--source' || arg === '-s') {
      i += 1;
    } else if (!arg.startsWith('-')) {
      out.push(arg);
    }
  }
  return out;
}

/** Strip `extra` leading components of each name (-pN beyond the `b/` patchFiles already drops). */
function stripped(files: string[], strip: number): string[] {
  const extra = Math.max(0, strip - 1);
  return files.map((file) => file.replace(/^a\//, '').split('/').slice(extra).join('/')).filter((file) => file !== '');
}

function patchStrip(args: string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    const inline = /^(?:-p|--strip=)(\d+)$/.exec(args[i]);
    if (inline) return Number(inline[1]);
    if ((args[i] === '-p' || args[i] === '--strip') && args[i + 1] !== undefined) return Number(args[i + 1]);
  }
  return 1;
}

/** The files a patch file on disk names; an unreadable file names none. */
function filesOfPatch(dir: string | undefined, file: string, strip: number): string[] {
  if (dir === undefined) return [];
  try {
    return stripped(patchFiles(fs.readFileSync(path.resolve(dir, file), 'utf8')), strip);
  } catch {
    return [];
  }
}

function gitApplyTargets(args: string[], dir: string | undefined): string[] {
  if (args.some((arg) => PATCH_INFO.test(arg))) return [];
  const files = args.filter((arg) => !arg.startsWith('-'));
  return files.flatMap((file) => filesOfPatch(dir, file, patchStrip(args)));
}

function gitSubcommand(sub: string, args: string[], dir: string | undefined): string[] {
  if (sub === 'checkout') return afterDashes(args);
  if (sub === 'restore') return restoreTargets(args);
  if (sub === 'mv') return args.filter((arg) => !arg.startsWith('-'));
  if (sub === 'apply') return gitApplyTargets(args, dir);
  return [];
}

/** `git [-C dir] checkout -- p`, `restore`, `mv`, `apply`. */
export function gitTargets(args: string[], ctx: ToolContext): string[] {
  const global = gitGlobal(args);
  const sub = args[global.at];
  if (sub === undefined) return [];
  const dir = ctx.dir === undefined ? undefined : path.resolve(ctx.dir, global.dir);
  const rest = args.slice(global.at + 1);
  return gitSubcommand(sub, rest, dir).map((file) => (global.dir ? path.posix.join(global.dir, file) : file));
}

/** `patch [-pN] (< file | -i file)`. */
export function patchTargets(args: string[], ctx: ToolContext): string[] {
  if (args.includes('--dry-run')) return [];
  const at = args.findIndex((arg) => arg === '-i' || arg === '--input');
  const file = at >= 0 ? args[at + 1] : ctx.inputs[0];
  return file === undefined ? [] : filesOfPatch(ctx.dir, file, patchStrip(args));
}

/** `curl -o|--output <file>` (also a combined `-sSLo file`). */
export function curlTargets(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output' || arg.startsWith('--output=')) {
      out.push(optionValue(args, i, '--output') ?? '');
    } else if (/^-[A-Za-z]*o$/.test(arg)) {
      out.push(args[i + 1] ?? '');
    } else if (/^-o.+/.test(arg)) {
      out.push(arg.slice(2));
    }
  }
  return out.filter((file) => file !== '' && file !== '-');
}

/** `wget -O <file>` / `--output-document`. */
export function wgetTargets(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output-document' || arg.startsWith('--output-document=')) {
      out.push(optionValue(args, i, '--output-document') ?? '');
    } else if (arg === '-O') {
      out.push(args[i + 1] ?? '');
    } else if (/^-O.+/.test(arg)) {
      out.push(arg.slice(2));
    }
  }
  return out.filter((file) => file !== '' && file !== '-');
}

/** The code after `-e`/`--eval` (node) or `-c` (python). */
function inlineCode(args: string[], options: string[]): string | undefined {
  const at = args.findIndex((arg) => options.includes(arg));
  return at < 0 ? undefined : args[at + 1];
}

export function nodeTargets(args: string[], conservative = false): string[] {
  const code = nodeInlineCode(args);
  if (code === undefined) return [];
  const context = nodeCallContext(code);
  const targets = [...context.targets];
  if (conservative || context.opaque) targets.push(...potentialInlineLiterals(code, 'node', context, !conservative));
  return [...new Set(targets)];
}

/** Exclude only supported literal read/data positions; an unclassified literal is not proof of no effect. */
function potentialInlineLiterals(
  code: string, dialect: 'node' | 'python' | 'perl', nodeContext?: NodeCallContext, projectWriterData = false,
): string[] {
  const safe = new Set<number>();
  const context = dialect === 'node' ? nodeContext ?? nodeCallContext(code) : undefined;
  if (dialect === 'perl') perlReadLiterals(code, safe);
  for (const call of code.matchAll(NODE_CALL)) {
    const parsed = context?.callsByIndex.get(call.index!);
    // Nominal data roles preserve file-list compatibility; conservative guards require actual provenance.
    const nominalData = projectWriterData && parsed !== undefined && NODE_DATA_WRITER.test(call[1]);
    if (context && (context.opaque || !parsed?.understood) && !nominalData) continue;
    const after = call.index! + call[0].length;
    const readOpen = dialect !== 'perl' && /^open(?:Sync)?$/.test(call[1])
      && /^\s*(?:\)|,\s*(?:mode\s*=\s*)?(['"])r[sbt]?\1(?=\s*[,)]))/.test(code.slice(after));
    const pythonRead = dialect === 'python' && (/^(?:print|copy|copy2|copyfile)$/.test(call[1])
      || call[1] === 'Path' && /^\s*\)\s*\.(?:read_text|read_bytes|exists|is_file|is_dir)\s*\(/.test(code.slice(after)));
    const readFile = dialect === 'node' && /^readFile(?:Sync)?$/.test(call[1])
      && readOnlyFileOpening(code.slice(after), context?.mutations.intrinsicUndefined ?? false,
        context !== undefined && !context.mutations.propertyWrites);
    const reader = NODE_READ.test(call[1]) || readFile || readOpen || pythonRead
      || dialect === 'perl' && /^(?:print|printf|say)$/.test(call[1]);
    if (reader) safe.add(after - call[3].length - 2);
    if (readFile) readOptionDataPositions(code, after, safe);
    if (!reader && !NODE_DATA_WRITER.test(call[1])) continue;
    literalDataPositions(code, after, safe);
  }
  if (context) return context.mutations.literals.filter(literal => !safe.has(literal.index))
    .map(literal => nodeLiteralValue(literal.value) ?? literal.value).filter(literal => literal !== '');
  return [...code.matchAll(NODE_LITERAL)].filter(literal => !safe.has(literal.index!))
    .map(literal => literal[1] ?? literal[2] ?? literal[3])
    .map(literal => dialect === 'perl' ? literal.replace(/^[+>]+\s*/, '') : literal).filter(literal => literal !== '');
}

function readOptionDataPositions(code: string, after: number, safe: Set<number>): void {
  const options = /^\s*,\s*\{[^{}]*\}/.exec(code.slice(after))?.[0];
  if (!options) return;
  for (const literal of options.matchAll(NODE_LITERAL)) safe.add(after + literal.index!);
}

function literalDataPositions(code: string, after: number, safe: Set<number>): void {
  for (;;) {
    const data = /^\s*,\s*(['"`])([^'"`]+)\1/.exec(code.slice(after));
    if (!data) return;
    after += data[0].length;
    safe.add(after - data[2].length - 2);
  }
}

function perlReadLiterals(code: string, safe: Set<number>): void {
  for (const output of code.matchAll(/\b(?:print|printf|say)\s+(['"])([^'"]+)\1/g)) {
    const after = output.index! + output[0].length;
    safe.add(after - output[2].length - 2);
    literalDataPositions(code, after, safe);
  }
  const open = /\bopen\s*\(?\s*(?:my\s+)?\$?[A-Za-z_]\w*\s*,\s*(['"])<\1\s*,\s*(['"])([^'"]+)\2/g;
  for (const read of code.matchAll(open)) safe.add(read.index! + read[0].length - read[3].length - 2);
}

export function perlTargets(args: string[]): string[] {
  const code = inlineCode(args, ['-e', '-E']);
  return code === undefined ? [] : potentialInlineLiterals(code, 'perl');
}

export function pythonTargets(args: string[], conservative = false): string[] {
  const code = inlineCode(args, ['-c']);
  if (code === undefined) return [];
  const out: string[] = [];
  for (const match of code.matchAll(PY_OPEN)) {
    const mode = PY_MODE.exec(match[3]);
    const text = mode === null ? '' : mode[2] ?? mode[4] ?? '';
    if (/[wax+]/.test(text)) out.push(match[2]);
  }
  for (const pair of code.matchAll(PY_PAIR)) {
    out.push(pair[5]);
    if (/^(?:rename|replace)$/.test(pair[1])) out.push(pair[3]);
  }
  if (conservative) out.push(...potentialInlineLiterals(code, 'python'));
  return [...new Set(out)];
}

/** The writers of this module, by verb. */
export function toolTargets(verb: string, args: string[], ctx: ToolContext): string[] {
  if (/^git(?:\.exe)?$/i.test(verb)) return gitTargets(args, ctx);
  if (/^patch$/i.test(verb)) return patchTargets(args, ctx);
  if (/^curl(?:\.exe)?$/i.test(verb)) return curlTargets(args);
  if (/^wget(?:\.exe)?$/i.test(verb)) return wgetTargets(args);
  if (/^node(?:\.exe)?$/i.test(verb)) return nodeTargets(args);
  if (/^(?:python3?|py)(?:\.exe)?$/i.test(verb)) return pythonTargets(args);
  return [];
}

export function isWebRequest(verb: string): boolean {
  return WEB_REQUEST.test(verb);
}
