import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { git, headCommit, isGitRepo } from './git.js';
import { SdlcError } from './errors.js';
import { hasProvenance, stripProvenance } from './license.js';

/**
 * Checkpoints: approving a gate stores a snapshot commit of the working tree at
 * `refs/sdlc/<change>/<gate>`. The snapshot is built in a throwaway index, like the verify
 * fingerprint, so branches, HEAD and the real index are never touched. `sdlc rework --reset`
 * restores chosen files from it. The snapshot is taken without line-ending conversion, so a
 * restored file has the bytes it had on disk when the gate was approved.
 */

const RAW = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
const LITERAL = '--literal-pathspecs';
const MAX_BUFFER = 64 * 1024 * 1024;

const IDENTITY = {
  GIT_AUTHOR_NAME: 'sdlc',
  GIT_AUTHOR_EMAIL: 'sdlc@localhost',
  GIT_COMMITTER_NAME: 'sdlc',
  GIT_COMMITTER_EMAIL: 'sdlc@localhost',
};

interface Repo {
  top: string;
  /** The project root inside the repository, `""` or `sub/dir/`. */
  prefix: string;
}

/** Files to restore from a checkpoint: repository-relative paths, and which of them the checkpoint holds. */
export interface CheckpointScope extends Repo {
  ref: string;
  paths: string[];
  saved: Set<string>;
  /** Paths of the scope tracked in HEAD: only these may be removed (git has a copy of them). */
  tracked: Set<string>;
}

export function checkpointRef(change: string, gate: string): string {
  return `refs/sdlc/${change}/${gate}`;
}

function repoOf(root: string): Repo | undefined {
  if (!isGitRepo(root)) return undefined;
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  return top.ok && prefix.ok ? { top: top.stdout, prefix: prefix.stdout } : undefined;
}

function nulList(output: string): string[] {
  return output.split('\0').filter(Boolean);
}

function snapshotTree(top: string): string | undefined {
  const name = `sdlc-checkpoint-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const index = path.join(os.tmpdir(), name);
  const env = { ...process.env, GIT_INDEX_FILE: index };
  const run = (args: string[]) => spawnSync('git', [...RAW, ...args],
    { cwd: top, env, encoding: 'utf-8', maxBuffer: MAX_BUFFER });
  try {
    if (run(['add', '-A', '--', '.']).status !== 0) return undefined;
    const tree = run(['write-tree']);
    return tree.status === 0 ? tree.stdout.trim() : undefined;
  } finally {
    fs.rmSync(index, { force: true });
  }
}

function commitSnapshot(top: string, tree: string, message: string): string | undefined {
  const head = headCommit(top);
  const args = ['commit-tree', '--no-gpg-sign', tree, ...(head ? ['-p', head] : []), '-m', message];
  const env = { ...process.env, ...IDENTITY };
  const commit = spawnSync('git', args, { cwd: top, env, encoding: 'utf-8' });
  return commit.status === 0 ? commit.stdout.trim() : undefined;
}

/** Records the gate's checkpoint. Without a git repository, or when git fails, nothing is recorded or thrown. */
export function recordCheckpoint(root: string, change: string, gate: string): boolean {
  try {
    const repo = repoOf(root);
    const tree = repo ? snapshotTree(repo.top) : undefined;
    const commit = repo && tree ? commitSnapshot(repo.top, tree, `sdlc checkpoint: ${change} ${gate}`) : undefined;
    if (!repo || !commit) return false;
    return git(repo.top, ['update-ref', checkpointRef(change, gate), commit]).ok;
  } catch {
    return false;
  }
}

/**
 * The files a reset would restore: the given project-relative files, plus every file of `dir` in the
 * checkpoint or on disk now, except `keep`. Undefined when there is no checkpoint at `ref`.
 */
export function checkpointScope(
  root: string, ref: string, files: string[], dir: string, keep: string[],
): CheckpointScope | undefined {
  const repo = repoOf(root);
  if (!repo || !git(repo.top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return undefined;
  const inRepo = (rel: string) => `${repo.prefix}${rel}`;
  const folder = inRepo(dir);
  const listed = files.map(inRepo);
  const saved = new Set(nulList(git(repo.top, [LITERAL, 'ls-tree', '-r', '-z', '--name-only', ref, '--',
    ...listed, folder]).stdout));
  const current = nulList(git(repo.top, [LITERAL, 'ls-files', '-z', '-co', '--exclude-standard', '--', folder]).stdout);
  const kept = new Set(keep.map(inRepo));
  const paths = [...new Set([...listed, ...saved, ...current])].filter((p) => !kept.has(p)).sort();
  return { ...repo, ref, paths, saved, tracked: headTracked(repo.top, paths) };
}

/** The paths tracked in HEAD; none without a first commit. */
function headTracked(top: string, paths: string[]): Set<string> {
  if (paths.length === 0 || !headCommit(top)) return new Set();
  const listed = git(top, [LITERAL, 'ls-tree', '-r', '-z', '--name-only', 'HEAD', '--', ...paths]);
  return new Set(nulList(listed.stdout));
}

function projectPath(scope: CheckpointScope, rel: string): string {
  return rel.slice(scope.prefix.length);
}

/** True when a file differs from HEAD only by the provenance line the CLI itself stamps on approval. */
function onlyStamped(scope: CheckpointScope, rel: string): boolean {
  const file = path.join(scope.top, rel);
  const head = spawnSync('git', [...RAW, 'cat-file', '--filters', `HEAD:${rel}`],
    { cwd: scope.top, encoding: 'utf-8', maxBuffer: MAX_BUFFER });
  if (head.status !== 0 || !fs.existsSync(file)) return false;
  const current = fs.readFileSync(file, 'utf-8');
  return hasProvenance(current) && unstamped(current) === unstamped(head.stdout);
}

/** Text as it was before a stamp: no provenance line and no trailing blank lines (the stamp adds and trims them). */
function unstamped(text: string): string {
  return stripProvenance(text).replace(/\s+$/u, '');
}

/**
 * Files of the scope with uncommitted edits compared with HEAD (staged, unstaged or untracked). The provenance
 * line an approval appends to an artifact is the CLI's own write, not an edit, so it alone does not count.
 */
export function dirtyFiles(scope: CheckpointScope): string[] {
  if (scope.paths.length === 0) return [];
  const exists = (rel: string) => fs.existsSync(path.join(scope.top, rel));
  const changed = headCommit(scope.top)
    ? nulList(git(scope.top, [LITERAL, 'diff', '--name-only', '-z', 'HEAD', '--', ...scope.paths]).stdout)
      .filter((rel) => !onlyStamped(scope, rel))
    : scope.paths.filter(exists);
  const untracked = nulList(git(scope.top, [LITERAL, 'ls-files', '-z', '--others', '--exclude-standard', '--',
    ...scope.paths]).stdout);
  return [...new Set([...changed, ...untracked])].sort().map((rel) => projectPath(scope, rel));
}

function savedContent(scope: CheckpointScope, rel: string): Buffer | undefined {
  const blob = spawnSync('git', [...RAW, 'cat-file', '--filters', `${scope.ref}:${rel}`],
    { cwd: scope.top, maxBuffer: MAX_BUFFER });
  return blob.status === 0 ? blob.stdout : undefined;
}

function restoreOne(scope: CheckpointScope, rel: string): boolean {
  const file = path.join(scope.top, rel);
  const current = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  if (!scope.saved.has(rel)) {
    // A file git never had (ignored or untracked) cannot be recovered once deleted, so it stays.
    if (current === undefined || !scope.tracked.has(rel)) return false;
    fs.rmSync(file, { force: true });
    return true;
  }
  const content = savedContent(scope, rel);
  if (!content || (current && current.equals(content))) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

/** True when the path or one of its parent folders inside the repository is a symbolic link or a junction. */
function throughLink(scope: CheckpointScope, rel: string): boolean {
  const parts = rel.split('/');
  for (let depth = 1; depth <= parts.length; depth += 1) {
    const at = path.join(scope.top, ...parts.slice(0, depth));
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(at);
    } catch {
      return false;
    }
    if (stat.isSymbolicLink()) return true;
  }
  return false;
}

/**
 * Refuses (`unsafe_path`) a scope with a path that goes through a link: the write would land outside the project
 * (an agent can commit a link where a planned file was). Callers run it before recording anything.
 */
export function assertNoLinks(scope: CheckpointScope): void {
  const linked = scope.paths.filter((rel) => throughLink(scope, rel)).map((rel) => projectPath(scope, rel));
  if (linked.length > 0) {
    const params = { files: linked.join(', ') };
    throw new SdlcError('unsafe_path', { key: 'error.rework_reset_through_link', params });
  }
}

/**
 * Puts every file of the scope back as the checkpoint has it; returns the project-relative files that changed.
 * A path that goes through a link is refused before anything is written. A file absent from the checkpoint is
 * removed only when HEAD tracks it.
 */
export function restoreFromCheckpoint(scope: CheckpointScope): string[] {
  assertNoLinks(scope);
  return scope.paths.filter((rel) => restoreOne(scope, rel)).map((rel) => projectPath(scope, rel));
}
