import * as fs from 'node:fs';
import * as path from 'node:path';
import picomatch from 'picomatch';
import { isWithin, toPosix, listFilesRecursive } from './fs-utils.js';
import { INBOX_DIR } from '../mcp/inbox.js';
import { decodedShellWords, shellWords, type ShellCommand, type ShellContext } from './shell-words.js';
import { shellBody, MAX_SHELL_BODY_DEPTH } from './shell-cli.js';
import { shellWriteDestinationPaths } from './policy-shell-writes.js';
import { nodeTargets, pythonTargets, perlTargets } from './policy-shell-tools.js';
import { STATE_FILES, WRITER_COORDINATION_DIRS, writerCoordinationFiles } from './state-files.js';
import { copyOperands } from './copy-operands.js';
import { harmlessRedirectPath, withoutHarmlessRedirects } from './shell-redirects.js';
import { writerTargets, writerProgramLocation, writerArguments, WRITE_OPS, FOLDER_OPS } from './shell-writers.js';
export { WRITE_OPS } from './shell-writers.js';
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
 * The same machinery serves the guard's own configuration (B41, `policy-guard.ts`) through `shellWrites`.
 */
/**
 * Harness records only the CLI writes: per-change `.sdlc.yaml`, the project log, roles, the backlog, the inbox
 * of MCP results kept for the agent (`openspec/.sdlc/inbox/<id>.json`), the record of the accepted roles of the
 * agent team (`openspec/.sdlc/team.json`, B72), the executor registry (`openspec/executors.yaml`, B116) and the
 * task board with its lock (`openspec/.sdlc/board.json` / `board.lock`, B118a).
 */
// Case-insensitive: Windows and macOS file systems ignore case, so `OPENSPEC/Backlog.md` is the same file.
export const STATE_FILE_WRITE =
  new RegExp(
    '\\.sdlc\\.yaml|\\.sdlc\\/(?:hook-)?log\\.jsonl|\\.sdlc\\/log\\.lock|\\.sdlc\\/team\\.json|' +
    '\\.sdlc\\/board\\.(?:json|lock)|\\.sdlc\\/(?:inbox|plugins)(?:\\/|\\b)|' +
    'openspec\\/(?:roles\\.yaml|executors\\.yaml|backlog\\.md)', 'i',
  );
export const STATE_FILE = new RegExp(
  '(^|/)\\.sdlc\\.yaml$|^openspec/\\.sdlc/(?:hook-)?log\\.jsonl$|' +
    '^openspec/\\.sdlc/(?:log\\.lock|team\\.json|board\\.json|board\\.lock)$' +
    '|^openspec/\\.sdlc/(?:log|board)\\.lock\\.writers(?:/.*)?$' +
    '|^openspec/\\.sdlc/plugins(?:/.*)?$|^openspec/\\.sdlc/inbox/[^/]+$' +
    '|^openspec/(?:roles\\.yaml|executors\\.yaml|backlog\\.md)$',
  'i'
);
/** The backlog's order and removal are a person's decision; agents change the file through `sdlc backlog`. */
export const BACKLOG_FILE = 'openspec/backlog.md';

/** Folders that hold state files: openspec/, the change folders (active and archived), openspec/.sdlc, the inbox. */
const STATE_FOLDER = /^openspec(?:\/changes(?:\/archive)?(?:\/[^/]+)?|\/\.sdlc(?:\/inbox|\/plugins(?:\/.*)?)?)?$/i;

/** A root-relative path equal to or inside a protected state folder, including a trailing separator. */
export function insideStateFolder(relative: string): boolean {
  const parts = relative.replace(/\/+$/, '').split('/');
  for (let end = 1; end <= parts.length; end += 1) {
    if (STATE_FOLDER.test(parts.slice(0, end).join('/'))) return true;
  }
  return false;
}

/** The state files at fixed places; a `.sdlc.yaml` may sit in any change directory. */
const FIXED_STATE_FILES = [...STATE_FILES, '.sdlc.yaml'];
const GLOB_CHARS = /[*?[{]/;
const DIR_COMMAND = /^(?:cd|chdir|pushd|Set-Location|sl|Push-Location)$/i;
const POP_COMMAND = /^(?:popd|Pop-Location)$/i;
/** Words that cannot be resolved from the text: variables, command substitution, the home directory. */
const UNRESOLVED = /[$`~%]/;

export function relToRoot(root: string, cwd: string, file: string): string | undefined {
  const abs = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (isWithin(root, abs)) return toPosix(path.relative(root, abs));
  if (process.platform !== 'win32') return undefined;
  try {
    const physicalRoot = fs.realpathSync.native(root);
    const physicalTarget = physicalPath(abs);
    if (physicalTarget && isWithin(physicalRoot, physicalTarget)) {
      return toPosix(path.relative(physicalRoot, physicalTarget));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/** Resolve existing ancestors so an absent target can still be checked against its physical project root. */
function physicalPath(target: string): string | undefined {
  let current = path.resolve(target);
  const missing: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...missing);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
}

/** An outside-looking Windows path needs physical proof before it can be treated as outside the project. */
export function uncertainWindowsPath(root: string, cwd: string, file: string): boolean {
  if (process.platform !== 'win32') return false;
  const absoluteFile = path.isAbsolute(file) ? file : path.resolve(cwd, file);
  if (isWithin(root, absoluteFile)) return false;
  try {
    fs.realpathSync.native(root);
    return physicalPath(absoluteFile) === undefined;
  } catch {
    return true;
  }
}

/** The root-relative path of `abs` when it matches `pattern`, or undefined. */
function relMatching(root: string, abs: string | undefined, pattern: RegExp): string | undefined {
  if (abs === undefined) return undefined;
  const rel = relToRoot(root, root, abs);
  return rel !== undefined && pattern.test(rel) ? rel : undefined;
}

function realOrSelf(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * The real path of a file; for a file that does not exist yet, the real path of its parent directory plus the name;
 * for a dangling link, the same for the path it points to (a write through it creates that file).
 */
export function realTarget(abs: string): string | undefined {
  try {
    return fs.realpathSync(abs);
  } catch {
    return realParent(linkTarget(abs) ?? abs);
  }
}

function realParent(abs: string): string | undefined {
  try {
    return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
  } catch {
    return undefined;
  }
}

/** Where a symbolic link points, absolute; undefined for anything that is not a link. */
function linkTarget(abs: string): string | undefined {
  try {
    return path.resolve(path.dirname(abs), fs.readlinkSync(abs));
  } catch {
    return undefined;
  }
}

/** Edit targets that resolve, through links, to a file matching `pattern`; root-relative. */
export function linkedFiles(files: string[], root: string, cwd: string, pattern: RegExp): string[] {
  const realRoot = realOrSelf(root);
  const hits: string[] = [];
  for (const file of files) {
    const real = realTarget(path.resolve(cwd, file));
    const rel = relMatching(realRoot, real, pattern);
    if (rel !== undefined) hits.push(rel);
  }
  return hits;
}

/** Edit targets that resolve, through links, to a state file; root-relative. */
export function linkedStateFiles(files: string[], root: string, cwd: string): string[] {
  return linkedFiles(files, root, cwd, STATE_FILE);
}

/**
 * What a shell rule protects: the files and the folders that hold them (root-relative patterns), and the paths a
 * glob word is matched against (`folders`: the command can replace a whole folder).
 */
export interface ProtectedSet {
  file: RegExp;
  folder: RegExp;
  candidates(root: string, glob: string, folders: boolean): string[];
}

export interface DirState {
  dir: string | undefined;
  stack: Array<string | undefined>;
}

/** Splits at shell operators outside quotes and PowerShell here-strings. */
export function simpleCommands(command: string, context: ShellContext = {}): string[] {
  return shellWords(command, context.dialect === 'cmd' ? true : undefined, context)
    .commands.map((part) => part.raw);
}

/**
 * The words of a simple command without quotes, redirections, grouping and `name=` prefixes (`dd of=`); .NET call
 * arguments (`[IO.Directory]::Delete('dir', $true)`) are words of their own.
 */
function words(segment: string): string[] {
  const native = decodedShellWords(segment, true).filter((word) => !word.operator);
  return decodedShellWords(segment).filter((word) => !word.operator)
    .flatMap((word, index) => native[index]?.value !== word.value ? [word, native[index]] : [word])
    .filter((word) => word !== undefined)
    .map((word) => word.value.replace(/^-{0,2}[A-Za-z_][\w-]*=/, ''));
}

/** A word as an absolute path from the current directory, or undefined when it cannot be told. */
export function absolute(dir: string | undefined, word: string | undefined): string | undefined {
  if (word === undefined || word.startsWith('-')) return undefined;
  if (path.isAbsolute(word) && process.platform === 'win32') {
    return /[$`%]/.test(word) ? undefined : path.resolve(word);
  }
  if (UNRESOLVED.test(word)) return undefined;
  if (path.isAbsolute(word)) return path.resolve(word);
  return dir === undefined ? undefined : path.resolve(dir, word);
}

export function moveTo(state: DirState, verb: string, args: string[]): void {
  if (POP_COMMAND.test(verb)) {
    state.dir = state.stack.pop();
    return;
  }
  if (/^push/i.test(verb)) state.stack.push(state.dir);
  state.dir = absolute(state.dir, args.find((arg) => !arg.startsWith('-')));
}

export function isDirCommand(verb: string): boolean {
  return DIR_COMMAND.test(verb) || POP_COMMAND.test(verb);
}

/** The inbox files on disk, root-relative. */
export function inboxFiles(root: string): string[] {
  try {
    return fs.readdirSync(path.join(root, INBOX_DIR)).map((name) => `${INBOX_DIR}/${name}`);
  } catch {
    return [];
  }
}

/** Directories that may hold a change's `.sdlc.yaml`: the change directories on disk, active and archived. */
export function changeDirs(root: string): string[] {
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
  const pluginFiles = listFilesRecursive(path.join(root, 'openspec/.sdlc/plugins'))
    .map((name) => `openspec/.sdlc/plugins/${name}`);
  const files = [...FIXED_STATE_FILES, ...[...dirs].map((dir) => `${dir}/.sdlc.yaml`), ...inboxFiles(root),
    ...pluginFiles, ...WRITER_COORDINATION_DIRS, ...writerCoordinationFiles(root)];
  if (!folders) return files;
  return [...files, 'openspec', 'openspec/changes', 'openspec/.sdlc', INBOX_DIR, ...dirs];
}

/** The state files and the folders that hold them. */
const STATE_SET: ProtectedSet = { file: STATE_FILE, folder: STATE_FOLDER, candidates: stateCandidates };

/** The protected file (or, for a folder write, folder) a glob word can match, read with bash rules. */
function globHit(root: string, dir: string | undefined, word: string, folders: boolean, set: ProtectedSet) {
  const abs = absolute(dir, word);
  const rel = abs === undefined ? undefined : relToRoot(root, root, abs);
  if (rel === undefined) return undefined;
  try {
    const matches = picomatch(rel, { nocase: true });
    return set.candidates(root, rel, folders).find((candidate) => matches(candidate));
  } catch {
    return undefined;
  }
}

/** The protected file (or folder) a word names, by its path or through a link; root-relative. */
function wordHit(root: string, dir: string | undefined, word: string, folders: boolean, set: ProtectedSet) {
  if (GLOB_CHARS.test(word)) return globHit(root, dir, word, folders, set);
  const abs = absolute(dir, word);
  if (abs === undefined) return undefined;
  const realRoot = realOrSelf(root);
  const file = relMatching(root, abs, set.file) ?? relMatching(realRoot, realTarget(abs), set.file);
  if (file !== undefined || !folders) return file;
  return relMatching(root, abs, set.folder) ?? relMatching(realRoot, realTarget(abs), set.folder);
}

/** A simple command that writes, with the directory its relative paths start from. */
export interface WriteSegment {
  text: string;
  dir: string | undefined;
  words: string[];
  folders?: boolean;
  /** Explicit projected destinations do not depend on a second raw-text writer classification. */
  destinations?: string[];
  redirects?: string[];
  inlineTargets?: string[];
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
export function writeSegments(command: string, cwd: string): WriteSegment[] {
  return scopedWriteSegments(command, { dir: path.resolve(cwd), stack: [] }, 0, {});
}

/** A quoted `$null` is a real file name; it is judged like `nul`, because `absolute` rightly cannot resolve a `$`. */
function redirectTargets(command: ShellCommand): string[] {
  const words = command.words.filter((word, index) => word.value !== '&'
    || command.words[index - 1]?.value !== '>' || !command.words[index - 1]?.operator);
  return words.filter((_word, index) => words[index - 1]?.operator
    && words[index - 1].value === '>' && !harmlessRedirectPath(_word.value))
    .map((word) => (word.value.toLowerCase() === '$null' ? 'nul'
      : word.value.startsWith('&') ? word.value.slice(1) : word.value));
}

function scopedWriteSegments(input: string, state: DirState, depth: number, context: ShellContext): WriteSegment[] {
  const out: WriteSegment[] = [];
  const parsed = shellWords(input, context.dialect === 'cmd' ? true : undefined, context);
  for (const part of parsed.commands) {
    const redirects = redirectTargets(part);
    if (redirects.length) {
      const destinations = redirects.flatMap((file) => absolute(state.dir, file) ?? []);
      out.push({ text: part.raw, dir: state.dir, words: ['', ...redirects], folders: false,
        destinations, redirects });
    }
    const argv = writerArguments(part);
    const execution = writerProgramLocation(argv.map(word => word.value), state.dir);
    const body = shellBody(part, context);
    if (body) {
      if (depth < MAX_SHELL_BODY_DEPTH) out.push(...scopedWriteSegments(
        body.input, { dir: execution.dir, stack: [] }, depth + 1, body.context,
      ));
      continue;
    }
    const list = words(part.raw);
    if (list.length === 0) continue;
    if (DIR_COMMAND.test(list[0]) || POP_COMMAND.test(list[0])) {
      moveTo(state, list[0], list.slice(1));
      continue;
    }
    const write = projectedWrite(part, list, state.dir, context);
    if (write) out.push(write);
  }
  return out;
}

function projectedWrite(
  command: ShellCommand, list: string[], dir: string | undefined, context: ShellContext,
): WriteSegment | undefined {
  const copy = copyOperands(command, context);
  const programWords = writerArguments(command);
  const argv = programWords.map(word => word.value);
  const execution = writerProgramLocation(argv, dir);
  if (execution.at < 0) return undefined;
  if (copy?.recursive) {
    const destinations = copy.destinations.flatMap(file => absolute(execution.dir, file) ?? []);
    return { text: command.raw, dir, words: [copy.program, ...destinations], destinations, folders: true };
  }
  const at = execution.at;
  const name = path.posix.basename(argv[at]?.replace(/\\/g, '/') ?? '').replace(/\.exe$/i, '');
  const legacyWords = at > 0 && programWords[at]
    ? command.words.slice(command.words.indexOf(programWords[at]))
      .filter(word => !word.operator).map(word => word.value)
    : list;
  const legacy = WRITE_OPS.test(withoutHarmlessRedirects(command))
    ? gitDir(execution.dir, legacyWords) : undefined;
  const known = writerTargets(name, argv.slice(at + 1), { dir: execution.dir, inputs: [] });
  if (known.targets.length > 0 && !/^(?:node|python[\d.]*|py|perl)$/i.test(name)) {
    const destinations = known.targets.flatMap(file => absolute(execution.dir, file) ?? []);
    const legacyWords = legacy?.words.slice(1).map(word => legacy.dir === execution.dir
      ? word : absolute(legacy.dir, word) ?? word) ?? [];
    if (known.targets.length > 0) return { text: command.raw, dir: execution.dir,
      words: [name, ...destinations, ...legacyWords], destinations: destinations.length ? destinations : known.targets,
      folders: known.folders || legacy !== undefined && FOLDER_OPS.test(command.raw) };
  }
  if (/^(?:node|python[\d.]*|py|perl)$/i.test(name)) {
    const args = argv.slice(at + 1);
    const files = /^node/i.test(name) ? nodeTargets(args, true)
      : /^perl/i.test(name) ? [...perlTargets(args), ...shellWriteDestinationPaths(command.raw, dir ?? '')]
        : pythonTargets(args, true);
    const targets = files
      .map(file => absolute(execution.dir, file)).filter((file): file is string => file !== undefined);
    return targets.length ? { text: command.raw, dir, words: [argv[at], ...targets],
      destinations: targets, inlineTargets: files, folders: true } : undefined;
  }
  if (/^(?:grep|rg|sed|awk|gawk)$/i.test(name)) {
    const targets = shellWriteDestinationPaths(command.raw, dir ?? '');
    return targets.length ? { text: command.raw, dir, words: [list[0], ...targets] } : undefined;
  }
  return legacy === undefined ? undefined : { text: command.raw, ...legacy };
}

/**
 * State files a shell command writes by a bare name after `cd`, by a glob or through a link, and state folders
 * (openspec/, a change folder, openspec/.sdlc) it deletes, restores, moves or copies into; root-relative.
 */
export function shellStateWrites(command: string, root: string, cwd: string): string[] {
  return shellWrites(command, root, cwd, STATE_SET);
}

/** A possible inline target that reaches state only by glob expansion, with literal hits taking precedence. */
export function shellStateInlineGlobPart(command: string, root: string, cwd: string): string | undefined {
  let glob: string | undefined;
  for (const segment of writeSegments(command, cwd)) {
    if (!segment.inlineTargets && segment.words.some((word) =>
      wordHit(root, segment.dir, word, segment.folders ?? FOLDER_OPS.test(segment.text), STATE_SET))) {
      return undefined;
    }
    for (const target of segment.inlineTargets ?? []) {
      if (wordHit(root, segment.dir, target, true, STATE_SET) === undefined) continue;
      if (!GLOB_CHARS.test(target)) return undefined;
      glob ??= target;
    }
  }
  return glob;
}

/**
 * Files of a protected set a shell command writes by path, by a bare name after `cd`, by a glob or through a link,
 * and folders of the set it deletes, restores, moves or copies into; root-relative.
 */
export function shellWrites(command: string, root: string, cwd: string, set: ProtectedSet): string[] {
  const hits: string[] = [];
  for (const segment of writeSegments(command, cwd)) {
    const folders = segment.folders ?? FOLDER_OPS.test(segment.text);
    for (const word of segment.words) {
      const hit = wordHit(root, segment.dir, word, folders, set);
      if (hit !== undefined) hits.push(hit);
    }
  }
  return hits;
}

const REDIRECT_TARGET = /\d*>>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|<>()]+))/g;

/** The words a write segment writes to: redirection targets, and every argument of a writing command. */
function segmentTargets(segment: WriteSegment): string[] {
  if (segment.destinations) return segment.folders
    ? [...segment.destinations, ...segment.words.slice(1)] : segment.destinations;
  const targets = [...segment.text.matchAll(REDIRECT_TARGET)].map((m) => m[1] ?? m[2] ?? m[3]);
  if (segment.folders ?? FOLDER_OPS.test(segment.text)) targets.push(...segment.words.slice(1));
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
