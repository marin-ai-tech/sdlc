import picomatch from 'picomatch';
import { agentEnvironment } from './agent-env.js';
import { readChangedPaths } from './changed-paths.js';
import { readChangeState } from './change-state.js';
import type { ChangeRef } from './changes.js';
import type { SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { AGENT_TRAILER, executorRefusal, readExecutors, type Executor } from './executors.js';
import { toPosix } from './fs-utils.js';
import { git } from './git.js';
import { resultBranch } from './result-branch.js';
import { appendLog } from './log.js';
import { matchesPlanFile, readPlanFiles } from './plan-files.js';
import { changeTasks, forbiddenPaths } from './task-contract.js';
import { TRAILER } from './trace.js';
import { consumeHook, declareOperation, immutableCandidate, restrictionsConfigured } from '../plugins/evaluation.js';
import type { PluginAttribution } from '../plugins/hooks.js';

/**
 * `sdlc task check-result` (B115): checks a branch an executor returned against the task contract - every commit
 * of `<base>..<branch>` carries `SDLC-Change: <id>` and `SDLC-Task: <a task of the change>`, and no forbidden path
 * is touched; a file outside the plan is a warning only. Read-only: it merges nothing, approves nothing, writes
 * no state; with an executor registry each check is one `task.result_checked` log entry (B116).
 */

export interface ResultCommit {
  sha: string;
  subject: string;
  change?: string;
  task?: string;
  /** The `SDLC-Agent` trailer value `<executor>/<agent>`, when the commit carries one (B116). */
  agent?: string;
}

export type ResultProblemCode =
  'missing_trailer' | 'unknown_task' | 'forbidden_path' | 'no_commits' |
  'missing_agent' | 'unknown_executor' | 'executor_not_allowed' | 'wrong_executor' | 'diff_unavailable' | 'plugin_refused';

export interface ResultProblem {
  plugin?: PluginAttribution;
  policy?: string;
  code: ResultProblemCode;
  sha?: string;
  file?: string;
  task?: string;
  /** Executor id named by the `SDLC-Agent` trailer (B116). */
  executor?: string;
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
  /** Distinct executor ids the commits' `SDLC-Agent` trailers name, sorted (B116; only with a registry). */
  executors?: string[];
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
      ...(trailers.has('sdlc-agent') ? { agent: trailers.get('sdlc-agent') } : {}),
    });
  }
  return commits;
}

/** The `<executor>/<agent>` a commit's first `SDLC-Agent` trailer must carry (B116). */
function agentOf(
  commit: ResultCommit, registry: Map<string, Executor>, state: { risk: string; kind: string },
): ResultProblem | undefined {
  const match = commit.agent === undefined ? undefined : AGENT_TRAILER.exec(commit.agent);
  if (!match) return { code: 'missing_agent', sha: commit.sha };
  const executor = registry.get(match[1]);
  if (!executor) return { code: 'unknown_executor', sha: commit.sha, executor: match[1] };
  if (executorRefusal(executor, state.risk, state.kind)) {
    return { code: 'executor_not_allowed', sha: commit.sha, executor: match[1] };
  }
  return undefined;
}

/**
 * The verdict for a returned branch: problems fail it, warnings do not. `expectExecutor` (B118a, the board's
 * `submit`) makes every commit's `SDLC-Agent` trailer name that executor; a different one is `wrong_executor`.
 */
export function checkResultCore(
  root: string, ref: ChangeRef, config: SdlcConfig, branch: string, base?: string, expectExecutor?: string,
): TaskResult {
  const registry = readExecutors(root);
  const { head: branchSha, baseSha } = resultCandidate(root, branch, base);
  const commits = commitsOf(root, baseSha, branchSha);
  const changed = readChangedPaths(root, baseSha, branchSha);
  const files = changed.ok ? changed.files : [];
  const state = readChangeState(ref.dir);
  const isForbidden = picomatch(forbiddenPaths(root, config, state.tests_locked === true),
    { dot: true, nocase: true });
  const planned = readPlanFiles(ref.dir, true) ?? [];
  const taskIds = new Set(changeTasks(ref).map((task) => task.id));
  const problems: ResultProblem[] = [];
  const warnings: ResultWarning[] = [];
  if (!changed.ok) problems.push({ code: 'diff_unavailable' });
  if (commits.length === 0) problems.push({ code: 'no_commits' });
  for (const commit of commits) {
    if (commit.change !== ref.id || commit.task === undefined) {
      problems.push({ code: 'missing_trailer', sha: commit.sha });
    } else if (!taskIds.has(commit.task)) {
      problems.push({ code: 'unknown_task', sha: commit.sha, task: commit.task });
    }
    if (registry !== undefined) {
      const problem = agentOf(commit, registry, state);
      if (problem) problems.push(problem);
    }
    const who = commit.agent === undefined ? undefined : AGENT_TRAILER.exec(commit.agent)?.[1];
    if (expectExecutor !== undefined && who !== undefined && who !== expectExecutor) {
      problems.push({ code: 'wrong_executor', sha: commit.sha, executor: who });
    }
  }
  for (const file of files) {
    const legacyName = toPosix(file.trim()).replace(/^(?:\.\/)+/, '');
    if (isForbidden(file) || isForbidden(legacyName)) problems.push({ code: 'forbidden_path', file });
    else if (!planned.some((entry) => matchesPlanFile(entry, file))) warnings.push({ code: 'outside_plan', file });
  }
  const executors = registry === undefined
    ? undefined
    : [...new Set(commits.flatMap((commit) => {
        const id = commit.agent === undefined ? undefined : AGENT_TRAILER.exec(commit.agent)?.[1];
        return id === undefined ? [] : [id];
      }))].sort();
  return {
    ok: problems.length === 0, base: baseSha, commits, files, problems, warnings,
    ...(executors ? { executors } : {}),
  };
}

function resultCandidate(root: string, branch: string, base?: string) {
  const actual = resultBranch(root, branch);
  return immutableCandidate(root, actual, base, () => {
    const head = resolveRef(root, actual);
    return { head, baseSha: base === undefined ? mergeBase(root, head) : resolveRef(root, base) };
  });
}

/** Full supported result acceptance. Core/route prerequisites precede every plugin verdict. */
export function checkResult(root: string, ref: ChangeRef, config: SdlcConfig, branch: string,
  base?: string, expectExecutor?: string): TaskResult {
  declareOperation(root, config, 'result', { change: ref.id, branch, base, executor: expectExecutor });
  const result = checkResultCore(root, ref, config, branch, base, expectExecutor);
  if (result.ok && restrictionsConfigured(root, config)) {
    const candidate = resultCandidate(root, branch, base);
    const verdict = consumeHook(root, config, 'result_accept', { change: ref.id, candidate,
      ...(expectExecutor ? { executor: expectExecutor } : {}), result });
    if (verdict.decision === 'deny') {
      result.ok = false;
      result.problems.push({ code: 'plugin_refused', sha: candidate.head,
        ...(verdict.plugin ? { plugin: verdict.plugin } : {}), ...(verdict.policy ? { policy: verdict.policy } : {}) });
    }
  }
  if (readExecutors(root) !== undefined) {
    appendLog(root, config, { event: 'task.result_checked', change: ref.id,
      detail: result.ok ? 'ok' : [...new Set(result.problems.map((problem) => problem.code))].join(', '),
      ...(result.executors?.length === 1 ? { executor: result.executors[0] } : {}),
      ...(agentEnvironment() ? { agent: agentEnvironment() } : {}) });
  }
  return result;
}
