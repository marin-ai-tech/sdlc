import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import { isWithin, toPosix } from './fs-utils.js';

/**
 * Which state files a tool call writes, beyond the path text `policy.ts` matches (rule `state-integrity`):
 * - a bare file name after `cd`/`pushd` (and PowerShell `Set-Location`/`Push-Location`) into a directory;
 * - a glob that can match a state file (`openspec/backlog.m?`, `openspec/backl*`, `openspec/roles.y[a]ml`);
 * - a link: the real path of the target, or of its parent directory for a new file, is a state file;
 * - a folder that holds state files (openspec/, openspec/changes, a change folder, openspec/.sdlc) as the target of
 *   a command that deletes, restores, moves or copies (not a redirection, which cannot replace a folder);
 * - `git -C <dir>`: the paths after it are read from that directory.
 *
 * Heuristics on the command text: a computed directory (`cd "$DIR"`, `cd ~`) is not followed, so bare names after
 * it are not resolved; a glob is read with bash rules (`*` does not match a leading dot); a `.sdlc.yaml` reached
 * through a glob is found in the glob's own directory under openspec/ and in the change directories on disk.
 */

/** Harness records only the CLI writes: per-change `.sdlc.yaml`, the project log, roles and the backlog. */
// Case-insensitive: Windows and macOS file systems ignore case, so `OPENSPEC/Backlog.md` is the same file.
export const STATE_FILE_WRITE = /\.sdlc\.yaml|\.sdlc\/log\.jsonl|openspec\/(?:roles\.yaml|backlog\.md)/i;
export const STATE_FILE = new RegExp(
  '(^|/)\\.sdlc\\.yaml$|^openspec/\\.sdlc/log\\.jsonl$|^openspec/(?:roles\\.yaml|backlog\\.md)$',
  'i'
);
/** The backlog's order and removal are a person's decision; agents change the file through `sdlc backlog`. */
export const BACKLOG_FILE = 'openspec/backlog.md';

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
const FOLDER_OPS = anyOf(FILE_OPS);
/** Folders that hold state files: openspec/, the change folders (active and archived) and openspec/.sdlc. */
const STATE_FOLDER = /^openspec(?:\/changes(?:\/archive)?(?:\/[^/]+)?|\/\.sdlc)?$/i;

/** The state files at fixed places; a `.sdlc.yaml` may sit in any change directory. */
const FIXED_STATE_FILES = ['openspec/backlog.md', 'openspec/roles.yaml', 'openspec/.sdlc/log.jsonl', '.sdlc.yaml'];
const GLOB_CHARS = /[*?[{]/;
const DIR_COMMAND = /^(?:cd|chdir|pushd|Set-Location|sl|Push-Location)$/i;
const POP_COMMAND = /^(?:popd|Pop-Location)$/i;
/** Words that cannot be resolved from the text: variables, command substitution, the home directory. */
const UNRESOLVED = /[$`~%]/;

export function relToRoot(root: string, cwd: string, file: string): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (!isWithin(root, abs)) return undefined;
  return toPosix(path.relative(root, abs));
}

function stateRel(root: string, abs: string | undefined): string | undefined {
  if (abs === undefined) return undefined;
  const rel = relToRoot(root, root, abs);
  return rel !== undefined && STATE_FILE.test(rel) ? rel : undefined;
}

function realOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/** The real path of a file, or of its parent directory plus the name when the file does not exist yet. */
function realTarget(abs: string): string | undefined {
  try {
    return fs.realpathSync(abs);
  } catch {
    try {
      return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
    } catch {
      return undefined;
    }
  }
}

/** Edit targets that resolve, through links, to a state file; root-relative. */
export function linkedStateFiles(files: string[], root: string, cwd: string): string[] {
  const realRoot = realOrSelf(root);
  const hits: string[] = [];
  for (const file of files) {
    const real = realTarget(path.resolve(cwd, file));
    const rel = stateRel(realRoot, real);
    if (rel !== undefined) hits.push(rel);
  }
  return hits;
}

interface DirState {
  dir: string | undefined;
  stack: Array<string | undefined>;
}

/** Splits a command into simple commands at `;`, `&&`, `||`, `|`, `&` and newlines (`2>&1` is not a split). */
export function simpleCommands(command: string): string[] {
  const unduped = command.replace(/\d*>&(?:\d+|-)/g, ' ').replace(/&>/g, '>');
  return unduped.split(/&&|\|\||[;&|\r\n]/);
}

/**
 * The words of a simple command without quotes, redirections, grouping and `name=` prefixes (`dd of=`); .NET call
 * arguments (`[IO.Directory]::Delete('dir', $true)`) are words of their own.
 */
function words(segment: string): string[] {
  return segment
    .split(/[\s(),]+|[<>]+/)
    .map((word) => word.replace(/['"]/g, ''))
    .map((word) => word.replace(/^\(+|\)+$/g, ''))
    .map((word) => word.replace(/^-{0,2}[A-Za-z_][\w-]*=/, ''))
    .filter((word) => word !== '');
}

/** A word as an absolute path from the current directory, or undefined when it cannot be told. */
function absolute(dir: string | undefined, word: string | undefined): string | undefined {
  if (word === undefined || word.startsWith('-') || UNRESOLVED.test(word)) return undefined;
  if (path.isAbsolute(word)) return path.resolve(word);
  return dir === undefined ? undefined : path.resolve(dir, word);
}

function moveTo(state: DirState, verb: string, args: string[]): void {
  if (POP_COMMAND.test(verb)) {
    state.dir = state.stack.pop();
    return;
  }
  if (/^push/i.test(verb)) state.stack.push(state.dir);
  state.dir = absolute(state.dir, args.find((arg) => !arg.startsWith('-')));
}

/** Directories that may hold a change's `.sdlc.yaml`: the change directories on disk, active and archived. */
function changeDirs(root: string): string[] {
  const dirs: string[] = [];
  for (const parent of ['openspec/changes', 'openspec/changes/archive']) {
    try {
      const entries = fs.readdirSync(path.join(root, parent), { withFileTypes: true });
      dirs.push(...entries.filter((entry) => entry.isDirectory()).map((entry) => `${parent}/${entry.name}`));
    } catch {
      // No such directory: nothing to add.
    }
  }
  return dirs;
}

/** The literal directory a glob starts from (`openspec/changes/x` for `openspec/changes/x/.sdlc.y*`). */
function literalDir(glob: string): string {
  const parts = glob.split('/');
  const first = parts.findIndex((part) => GLOB_CHARS.test(part));
  return parts.slice(0, Math.min(first, parts.length - 1)).join('/');
}

function stateCandidates(root: string, glob: string, folders: boolean): string[] {
  const dirs = new Set(changeDirs(root));
  const literal = literalDir(glob);
  if (literal === 'openspec' || literal.startsWith('openspec/')) dirs.add(literal);
  const files = [...FIXED_STATE_FILES, ...[...dirs].map((dir) => `${dir}/.sdlc.yaml`)];
  if (!folders) return files;
  return [...files, 'openspec', 'openspec/changes', 'openspec/.sdlc', ...dirs];
}

/** The state file (or, for a folder write, state folder) a glob word can match, read with bash rules. */
function globHit(root: string, dir: string | undefined, word: string, folders: boolean): string | undefined {
  const abs = absolute(dir, word);
  const rel = abs === undefined ? undefined : relToRoot(root, root, abs);
  if (rel === undefined) return undefined;
  try {
    const matches = picomatch(rel, { nocase: true });
    return stateCandidates(root, rel, folders).find((candidate) => matches(candidate));
  } catch {
    return undefined;
  }
}

/** A folder that holds state files, root-relative, or undefined. */
function stateFolder(root: string, abs: string | undefined): string | undefined {
  if (abs === undefined) return undefined;
  const rel = relToRoot(root, root, abs);
  return rel !== undefined && STATE_FOLDER.test(rel) ? rel : undefined;
}

function wordHit(root: string, dir: string | undefined, word: string, folders: boolean): string | undefined {
  if (GLOB_CHARS.test(word)) return globHit(root, dir, word, folders);
  const abs = absolute(dir, word);
  if (abs === undefined) return undefined;
  const file = stateRel(root, abs) ?? stateRel(realOrSelf(root), realTarget(abs));
  if (file !== undefined || !folders) return file;
  return stateFolder(root, abs) ?? stateFolder(realOrSelf(root), realTarget(abs));
}

/** A simple command that writes, with the directory its relative paths start from. */
interface WriteSegment {
  text: string;
  dir: string | undefined;
  words: string[];
}

/** `git -C <dir> …`: the paths after it are relative to that directory; the option itself names no target. */
function gitDir(dir: string | undefined, list: string[]): { dir: string | undefined; words: string[] } {
  if (!/^git$/i.test(list[0] ?? '')) return { dir, words: list };
  const rest: string[] = [];
  let at = dir;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === '-C' && i + 1 < list.length) {
      at = absolute(at, list[i + 1]);
      i += 1;
      continue;
    }
    rest.push(list[i]);
  }
  return { dir: at, words: rest };
}

/** The simple commands of a shell command that write, following `cd`/`pushd`/`popd` and `git -C`. */
function writeSegments(command: string, cwd: string): WriteSegment[] {
  const state: DirState = { dir: path.resolve(cwd), stack: [] };
  const out: WriteSegment[] = [];
  for (const segment of simpleCommands(command)) {
    const list = words(segment);
    if (list.length === 0) continue;
    if (DIR_COMMAND.test(list[0]) || POP_COMMAND.test(list[0])) {
      moveTo(state, list[0], list.slice(1));
      continue;
    }
    if (!WRITE_OPS.test(segment)) continue;
    out.push({ text: segment, ...gitDir(state.dir, list) });
  }
  return out;
}

/**
 * State files a shell command writes by a bare name after `cd`, by a glob or through a link, and state folders
 * (openspec/, a change folder, openspec/.sdlc) it deletes, restores, moves or copies into; root-relative.
 */
export function shellStateWrites(command: string, root: string, cwd: string): string[] {
  const hits: string[] = [];
  for (const segment of writeSegments(command, cwd)) {
    const folders = FOLDER_OPS.test(segment.text);
    for (const word of segment.words) {
      const hit = wordHit(root, segment.dir, word, folders);
      if (hit !== undefined) hits.push(hit);
    }
  }
  return hits;
}

const REDIRECT_TARGET = /\d*>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>()]+))/g;

/** The words a write segment writes to: redirection targets, and every argument of a writing command. */
function segmentTargets(segment: WriteSegment): string[] {
  const targets = [...segment.text.matchAll(REDIRECT_TARGET)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (FOLDER_OPS.test(segment.text)) targets.push(...segment.words.slice(1));
  return targets;
}

/** Project files and folders (root-relative, posix) a shell command may write; used by the takeover rule. */
export function shellWriteTargets(command: string, root: string, cwd: string): string[] {
  const rels = new Set<string>();
  for (const segment of writeSegments(command, cwd)) {
    for (const word of segmentTargets(segment)) {
      const abs = absolute(segment.dir, word);
      const rel = abs === undefined ? undefined : relToRoot(root, root, abs);
      if (rel !== undefined && rel !== '') rels.add(rel);
    }
  }
  return [...rels];
}
