import * as path from 'node:path';
import { readChangeState, type ChangeState, type HistoryEvent } from './change-state.js';
import { listActiveChanges, listArchivedChanges, type ChangeRef } from './changes.js';
import { changeAgentCommits, type AgentCommits } from './agent-commits.js';
import { commitsTouching, type CommitInfo } from './git.js';
import type { ProjectPaths } from './project.js';

/** B104: what `sdlc audit --change <id> [--since <date>]` reads for one change. */
export interface ChangeAudit {
  state: ChangeState;
  /** The history events, only those at or after `since` when it is given. */
  history: HistoryEvent[];
  /** The commits touching the change folder, before and after the archive move. */
  commits: CommitInfo[];
  /** The commits with `SDLC-Change: <id>` and how many of them also have `SDLC-Agent:`. */
  agentCommits: AgentCommits;
}

/** True when `at` (an ISO timestamp) is at or after `since`; everything is in the period without `since`. */
export function atOrAfter(at: string, since: string | undefined): boolean {
  if (since === undefined) return true;
  return Date.parse(at) >= Date.parse(since);
}

/** A path relative to the root with forward slashes, as git's pathspecs take it on every platform. */
function gitPath(root: string, dir: string): string {
  return path.relative(root, dir).split(path.sep).join('/');
}

/**
 * The folders the change's commits touched: the current one and, for an archived change, the pre-archive
 * openspec/changes/<id>/ (the history did not follow the move to openspec/changes/archive/<date>-<id>/).
 */
export function changeFolders(paths: ProjectPaths, ref: ChangeRef): string[] {
  const current = gitPath(paths.root, ref.dir);
  const before = gitPath(paths.root, path.join(paths.changesDir, ref.id));
  return current === before ? [current] : [current, before];
}

/** The commits touching any of the change's folders (one `git log`, so de-duplicated), within the period. */
function changeCommits(paths: ProjectPaths, ref: ChangeRef, since: string | undefined): CommitInfo[] {
  const commits = commitsTouching(paths.root, changeFolders(paths, ref));
  return commits.filter((commit) => atOrAfter(commit.date, since));
}

/** Reads the audit of one change; `since` (ISO) limits its history and commits to the period. */
export function auditChange(paths: ProjectPaths, ref: ChangeRef, since?: string): ChangeAudit {
  const state = readChangeState(ref.dir);
  return {
    state,
    history: state.history.filter((event) => atOrAfter(event.at, since)),
    commits: changeCommits(paths, ref, since),
    agentCommits: changeAgentCommits(paths.root, ref.id, since),
  };
}

/** True when the change has any history event at or after `since` (always true without `since`). */
function activeSince(ref: ChangeRef, since: string | undefined): boolean {
  if (since === undefined) return true;
  return readChangeState(ref.dir).history.some((event) => atOrAfter(event.at, since));
}

/** The active and archived changes; with `since`, only those with any history event in the period (B104). */
export function changesInPeriod(paths: ProjectPaths, since?: string): ChangeRef[] {
  const refs = [...listActiveChanges(paths), ...listArchivedChanges(paths)];
  return refs.filter((ref) => activeSince(ref, since));
}