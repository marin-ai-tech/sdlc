import * as fs from 'node:fs';
import * as path from 'node:path';
import { isWithin, readText } from '../core/fs-utils.js';
import { git } from '../core/git.js';

/**
 * The `prepare-commit-msg` git hook (B24): a commit made in an agent session gets an `SDLC-Agent: <agent>` trailer,
 * a person's commit is never touched. It is a POSIX sh script that does not run sdlc, so it works whatever `cli` is
 * and cannot block a commit; git runs it with `--no-verify` too.
 *
 * It lives where git looks for hooks (`git rev-parse --git-path hooks/prepare-commit-msg`, so `core.hooksPath` is
 * respected), not in the project tree: it is not a tracked generated file and not in the manifest. A hook without the
 * marker line belongs to the project and is never overwritten; sdlc then keeps its script next to it
 * (`prepare-commit-msg.sdlc`) so the project's hook can chain it.
 */

export const HOOK_NAME = 'prepare-commit-msg';

/** The line that marks the hook as sdlc's. Never change it: older sdlc hooks are recognized by it. */
export const HOOK_MARKER = '# sdlc-managed-hook: prepare-commit-msg (SDLC-Agent trailer)';

/** sdlc's copy of the script next to a hook of the project's own. */
export const CHAIN_SUFFIX = '.sdlc';

/** The line a project's own hook adds to run sdlc's copy. */
export const CHAIN_LINE = `sh "$(dirname "$0")/${HOOK_NAME}${CHAIN_SUFFIX}" "$@"`;

/**
 * The script. The agent markers and their order mirror agentEnvironment() in src/core/agent-env.ts; change both
 * together (test/git-hook-sync.test.ts compares them).
 */
const SCRIPT_LINES = [
  '#!/bin/sh',
  HOOK_MARKER,
  '# Written by `sdlc init` and `sdlc update`, removed by `sdlc uninstall`.',
  '# It never runs sdlc and never fails a commit: a commit made outside an agent session is left unchanged.',
  'agent=""',
  'if [ -n "${SDLC_AGENT:-}" ]; then',
  '  agent="$SDLC_AGENT"',
  'elif [ "${CLAUDECODE:-}" = "1" ]; then',
  '  agent="claude-code"',
  'elif [ "${OPENCODE:-}" = "1" ]; then',
  '  agent="opencode"',
  'elif [ "${AGENT:-}" = "1" ]; then',
  '  agent="agent"',
  'elif [ "${CURSOR_AGENT:-}" = "1" ]; then',
  '  agent="cursor"',
  'elif [ "${CODEX_CI:-}" = "1" ] || [ -n "${CODEX_SESSION_ID:-}" ]; then',
  '  agent="codex"',
  'fi',
  '[ -n "$agent" ] || exit 0',
  '# Only a plain name goes into the trailer (the same rule as agent-env.ts).',
  'case "$agent" in *[!A-Za-z0-9._-]*) agent="agent" ;; esac',
  '[ ${#agent} -le 64 ] || agent="agent"',
  '# A commit git replays (rebase, cherry-pick) or amends keeps its author: it is not marked as the agent\'s.',
  '[ "$2" = "commit" ] && exit 0',
  'gitdir="$(git rev-parse --git-dir 2>/dev/null)"',
  'if [ -n "$gitdir" ] && { [ -e "$gitdir/CHERRY_PICK_HEAD" ] || [ -d "$gitdir/rebase-merge" ] \\',
  '  || [ -d "$gitdir/rebase-apply" ]; }; then',
  '  exit 0',
  'fi',
  '[ -f "$1" ] || exit 0',
  'if grep -qi "^SDLC-Agent:" "$1"; then',
  '  exit 0',
  'fi',
  'git interpret-trailers --in-place --trailer "SDLC-Agent: $agent" "$1" || true',
  'exit 0',
];

/** The hook script, LF line endings. */
export function renderGitHook(): string {
  return `${SCRIPT_LINES.join('\n')}\n`;
}

/** Whether a hook's text is sdlc's: it has the marker line. */
export function isSdlcHook(text: string): boolean {
  const lines = text.split(/\r?\n/);
  return lines.some((line) => line.trim() === HOOK_MARKER);
}

/** Where git runs the hook (`core.hooksPath` respected); undefined outside a git repository. */
export function gitHookPath(root: string): string | undefined {
  const result = git(root, ['rev-parse', '--git-path', `hooks/${HOOK_NAME}`]);
  if (!result.ok || !result.stdout) return undefined;
  return path.resolve(root, result.stdout);
}

export type GitHookState =
  'installed' | 'updated' | 'unchanged' | 'kept' | 'removed' | 'absent' | 'failed' | 'shared';

/**
 * True when the hooks folder belongs to this project: inside the project or inside the repository's git directory.
 * A `core.hooksPath` that points elsewhere (a hooks folder shared by every repository, set with `git config
 * --global`) is never written: sdlc changes only this project.
 */
export function hookPathOwned(root: string, file: string): boolean {
  const common = git(root, ['rev-parse', '--git-common-dir']);
  const gitDir = common.ok && common.stdout ? path.resolve(root, common.stdout) : undefined;
  const real = realFolder(path.dirname(file));
  const inside = (parent: string) => isWithin(parent, file) && isWithin(realFolder(parent), real);
  return inside(root) || (gitDir !== undefined && inside(gitDir));
}

/** The real path of a folder (links resolved), or of its nearest existing ancestor joined with the rest. */
function realFolder(dir: string): string {
  const rest: string[] = [];
  let at = dir;
  while (!fs.existsSync(at) && path.dirname(at) !== at) {
    rest.unshift(path.basename(at));
    at = path.dirname(at);
  }
  return path.join(fs.realpathSync(at), ...rest);
}

export interface GitHookResult {
  state: GitHookState;
  /** Absolute path of the hook; unset outside a git repository. */
  path?: string;
  error?: string;
}

function writeScript(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { encoding: 'utf-8', mode: 0o755 });
  fs.chmodSync(file, 0o755);
}

function failure(file: string, error: unknown): GitHookResult {
  const message = error instanceof Error ? error.message : String(error);
  return { state: 'failed', path: file, error: message };
}

/** sdlc's copy next to the project's own hook, rewritten only when its content changed. */
function writeChainCopy(file: string, script: string): void {
  const copy = `${file}${CHAIN_SUFFIX}`;
  const current = readText(copy);
  if (current === script || (current !== undefined && !isSdlcHook(current))) return;
  writeScript(copy, script);
}

function applyHook(file: string, script: string, dryRun: boolean): GitHookResult {
  const current = readText(file);
  if (current !== undefined && !isSdlcHook(current)) {
    if (!dryRun) writeChainCopy(file, script);
    return { state: 'kept', path: file };
  }
  if (current === script) return { state: 'unchanged', path: file };
  if (!dryRun) writeScript(file, script);
  const state = current === undefined ? 'installed' : 'updated';
  return { state, path: file };
}

/**
 * Installs or refreshes sdlc's hook. Outside a git repository it does nothing (`absent`); a hook of the project's
 * own is left as it is (`kept`); an error is returned as `failed`, never thrown, so init and update go on.
 */
export function installGitHook(root: string, options: { dryRun?: boolean } = {}): GitHookResult {
  const file = gitHookPath(root);
  if (!file) return { state: 'absent' };
  if (!hookPathOwned(root, file)) return { state: 'shared', path: file };
  try {
    return applyHook(file, renderGitHook(), options.dryRun === true);
  } catch (error) {
    return failure(file, error);
  }
}

function removeIfSdlc(file: string, dryRun: boolean): boolean {
  const current = readText(file);
  if (current === undefined || !isSdlcHook(current)) return false;
  if (!dryRun) fs.rmSync(file, { force: true });
  return true;
}

/** Removes sdlc's hook and its chain copy; a hook of the project's own stays (`kept`). */
export function removeGitHook(root: string, options: { dryRun?: boolean } = {}): GitHookResult {
  const file = gitHookPath(root);
  if (!file) return { state: 'absent' };
  if (!hookPathOwned(root, file)) return { state: 'shared', path: file };
  const dryRun = options.dryRun === true;
  try {
    removeIfSdlc(`${file}${CHAIN_SUFFIX}`, dryRun);
    if (removeIfSdlc(file, dryRun)) return { state: 'removed', path: file };
    const state = readText(file) === undefined ? 'absent' : 'kept';
    return { state, path: file };
  } catch (error) {
    return failure(file, error);
  }
}

export type GitHookStatus = 'current' | 'outdated' | 'missing' | 'foreign' | 'chained' | 'no-git' | 'shared';

/** What `sdlc doctor` reports about the hook. Read-only. */
export function inspectGitHook(root: string): { status: GitHookStatus; path?: string } {
  const file = gitHookPath(root);
  if (!file) return { status: 'no-git' };
  const current = readText(file);
  if (!hookPathOwned(root, file) && !(current !== undefined && current.includes(`${HOOK_NAME}${CHAIN_SUFFIX}`))) {
    return { status: 'shared', path: file };
  }
  if (current === undefined) return { status: 'missing', path: file };
  if (isSdlcHook(current)) {
    const status = current === renderGitHook() ? 'current' : 'outdated';
    return { status, path: file };
  }
  const chained = current.includes(`${HOOK_NAME}${CHAIN_SUFFIX}`);
  return { status: chained ? 'chained' : 'foreign', path: file };
}
