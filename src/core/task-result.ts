import picomatch from 'picomatch';
import { readChangeState } from './change-state.js';
import type { ChangeRef } from './changes.js';
import type { SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { toPosix } from './fs-utils.js';
import { git } from './git.js';
import { matchesPlanFile, readPlanFiles } from './plan-files.js';
import { changeTasks, forbiddenPaths } from './task-contract.js';
import { TRAILER } from './trace.js';

/**
 * `sdlc task check-result` (B115): checks a branch an executor returned against the task contract - every commit
 * of `<base>..<branch>` carries `SDLC-Change: <id>` and `SDLC-Task: <a task of the change>`, and no forbidden path
 * is touched; a file outside the plan is a warning only. Read-only: it merges nothing, approves nothing, writes
 * no state and no log.
 */

export interface ResultCommit {
  sha: string;
  subject: string;
  change?: string;
  task?: string;
}

export type ResultProblemCode = 'missing_trailer' | 'unknown_task' | 'forbidden_path' | 'no_commits';

export interface ResultProblem {
  code: ResultProblemCode;
  sha?: string;
  file?: string;
  task?: string;
}

export interface ResultWarning {
  code: 'outside_plan';
  file: string;
}

export interface TaskResult {
  ok: boolean;
  base: string;
  commits: ResultCommit[];
  files: string[];
  problems: ResultProblem[];
  warnings: ResultWarning[];
}

/** Resolves a user-given ref to a commit; anything that is not one is an error, never a crash. */
function resolveRef(root: string, ref: string): string {
  const resolved = git(root, ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]);
  if (!resolved.ok) {
    throw new SdlcError('unknown_ref', { key: 'error.unknown_git_ref_x', params: { ref } });
  }
  return resolved.stdout;
}

/** The default base of a result branch: its merge-base with HEAD. */
function mergeBase(root: string, branch: string): string {
  const base = git(root, ['merge-base', 'HEAD', branch]);
  if (!base.ok || !base.stdout) {
    throw new SdlcError('no_merge_base', { key: 'error.no_common_base_of_head_and_x', params: { ref: branch } });
  }
  return base.stdout;
}

/** The commits of `base..branch`, oldest first, with their SDLC trailers (first trailer of each name wins). */
function commitsOf(root: string, base: string, branch: string): ResultCommit[] {
  const log = git(root, ['log', '--reverse', '--format=%H%x1f%s%x1f%B%x1e', `${base}..${branch}`]);
  if (!log.ok) return [];
  const commits: ResultCommit[] = [];
  for (const entry of log.stdout.split('\x1e')) {
    const [sha, subject, body = ''] = entry.trim().split('\x1f');
    if (!sha) continue;
    const trailers = new Map<string, string>();
    for (const match of body.matchAll(TRAILER)) {
      const name = match[1].toLowerCase();
      if (!trailers.has(name)) trailers.set(name, match[2]);
    }
    commits.push({
      sha,
      subject,
      ...(trailers.has('sdlc-change') ? { change: trailers.get('sdlc-change') } : {}),
      ...(trailers.has('sdlc-task') ? { task: trailers.get('sdlc-task') } : {}),
    });
  }
  return commits;
}

/** The files the range changed: repo-relative, posix separators, sorted, no duplicates. */
function changedFiles(root: string, base: string, branch: string): string[] {
  const diff = git(root, ['diff', '--name-only', `${base}..${branch}`]);
  if (!diff.ok || !diff.stdout) return [];
  const files = diff.stdout.split('\n')
    .map((file) => toPosix(file.trim()).replace(/^(?:\.\/)+/, ''))
    .filter((file) => file !== '');
  return [...new Set(files)].sort();
}

/** The verdict for a returned branch: problems fail it, warnings do not. */
export function checkResult(
  root: string, ref: ChangeRef, config: SdlcConfig, branch: string, base?: string,
): TaskResult {
  const branchSha = resolveRef(root, branch);
  const baseSha = base === undefined ? mergeBase(root, branchSha) : resolveRef(root, base);
  const commits = commitsOf(root, baseSha, branchSha);
  const files = changedFiles(root, baseSha, branchSha);
  const state = readChangeState(ref.dir);
  const isForbidden = picomatch(forbiddenPaths(root, config, state.tests_locked === true),
    { dot: true, nocase: true });
  const planned = readPlanFiles(ref.dir, true) ?? [];
  const taskIds = new Set(changeTasks(ref).map((task) => task.id));
  const problems: ResultProblem[] = [];
  const warnings: ResultWarning[] = [];
  if (commits.length === 0) problems.push({ code: 'no_commits' });
  for (const commit of commits) {
    if (commit.change !== ref.id || commit.task === undefined) {
      problems.push({ code: 'missing_trailer', sha: commit.sha });
    } else if (!taskIds.has(commit.task)) {
      problems.push({ code: 'unknown_task', sha: commit.sha, task: commit.task });
    }
  }
  for (const file of files) {
    if (isForbidden(file)) problems.push({ code: 'forbidden_path', file });
    else if (!planned.some((entry) => matchesPlanFile(entry, file))) warnings.push({ code: 'outside_plan', file });
  }
  return { ok: problems.length === 0, base: baseSha, commits, files, problems, warnings };
}
