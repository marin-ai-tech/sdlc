import * as fs from 'node:fs';
import * as path from 'node:path';
import { patchFiles } from './policy-patch-files.js';

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
const NODE_WRITER = /\b(?:writeFileSync|appendFileSync|createWriteStream|writeFile)\s*\(\s*(['"`])([^'"`]+)\1/g;
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

export function nodeTargets(args: string[]): string[] {
  const code = inlineCode(args, ['-e', '--eval']);
  if (code === undefined) return [];
  return [...code.matchAll(NODE_WRITER)].map((match) => match[2]);
}

export function pythonTargets(args: string[]): string[] {
  const code = inlineCode(args, ['-c']);
  if (code === undefined) return [];
  const out: string[] = [];
  for (const match of code.matchAll(PY_OPEN)) {
    const mode = PY_MODE.exec(match[3]);
    const text = mode === null ? '' : mode[2] ?? mode[4] ?? '';
    if (/[wax+]/.test(text)) out.push(match[2]);
  }
  return out;
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
