import * as path from 'node:path';
import type { PreviousAttempt } from './board-reopen.js';
import { agentEnvironment } from './agent-env.js';
import { readChangeState } from './change-state.js';
import type { ChangeRef } from './changes.js';
import type { SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { executorRefusal, readExecutors, type Executor } from './executors.js';
import { readText } from './fs-utils.js';
import { headCommit } from './git.js';
import { evaluateChange, type LifecycleView } from './lifecycle.js';
import { appendLog } from './log.js';
import { readPlanFiles, readPlanProof } from './plan-files.js';
import { STATE_FILES } from './state-files.js';
import { parseTasks } from './tasks.js';
import { parseRequirements, TASK_ID } from './trace.js';

/**
 * `sdlc task export` (B115, epic E16): the `sdlc.task/1` work item an executor of any kind - one agent, an
 * orchestrated swarm, a task board - receives for one open task of a change: what to do, which checks to run,
 * which paths are off-limits and where the result goes. Work is handed out only while the plan gate is approved
 * (and not stale). The contract is executor-neutral; adapters and boards build on it later.
 */

export interface TaskCheck {
  name: string;
  run: string;
  required: boolean;
}

export interface TaskItem {
  contract: 'sdlc.task/1';
  /** `<change>#<task>` - unique across changes, since task numbers repeat. */
  id: string;
  change: string;
  risk: string;
  kind: string;
  /** Registry id of the executor the item is handed to (B116; only with a registry). */
  executor?: string;
  task: { id: string; text: string };
  base: { commit?: string };
  plan: { files: string[]; proof: string[] };
  scenarios: string[];
  checks: TaskCheck[];
  forbidden: string[];
  previousAttempts?: PreviousAttempt[];
  result: { branch: string; trailers: { 'SDLC-Change': string; 'SDLC-Task': string; 'SDLC-Agent'?: string } };
}

export interface ChangeTask {
  id: string;
  text: string;
  done: boolean;
}

/** The numbered tasks of tasks.md, in file order. */
export function changeTasks(ref: ChangeRef): ChangeTask[] {
  const progress = parseTasks(readText(path.join(ref.dir, 'tasks.md')) ?? '');
  return progress.tasks.flatMap((task) => {
    const match = TASK_ID.exec(task.description);
    return match ? [{ id: match[1], text: match[2], done: task.done }] : [];
  });
}

/** The paths an executor must not touch: state files, the config, protected paths, locked test paths. */
export function forbiddenPaths(root: string, config: SdlcConfig, testsLocked: boolean): string[] {
  const files = [
    ...STATE_FILES,
    '.sdlc.yaml',
    'openspec/sdlc.yaml',
    // A `.sdlc.yaml` holds the gate approvals; the glob covers every change folder, one a branch adds too.
    'openspec/changes/**/.sdlc.yaml',
    ...config.enforcement.protectedPaths,
  ];
  if (testsLocked) files.push(...config.enforcement.testPaths);
  return [...new Set(files)];
}

/** Handing out work needs an approved (or waived / not applicable) plan gate; pending, blocked and stale refuse. */
export function planOpen(view: LifecycleView): boolean {
  const gate = view.gates.find((entry) => entry.id === 'plan');
  return !!gate && (gate.status === 'approved' || gate.status === 'waived' || gate.status === 'n/a');
}

export function planStatus(view: LifecycleView): string {
  return view.gates.find((entry) => entry.id === 'plan')?.status ?? 'pending';
}

function workItem(
  ref: ChangeRef, task: ChangeTask, shared: Omit<TaskItem, 'id' | 'task' | 'result'>, executor?: Executor,
): TaskItem {
  return {
    ...shared,
    id: `${ref.id}#${task.id}`,
    task: { id: task.id, text: task.text },
    ...(executor ? { executor: executor.id } : {}),
    result: {
      branch: `sdlc/${ref.id}/${task.id}`,
      trailers: {
        'SDLC-Change': ref.id,
        'SDLC-Task': task.id,
        // The executor fills in its own agent name at commit time: <executor>/<agent>.
        ...(executor ? { 'SDLC-Agent': `${executor.id}/<agent>` } : {}),
      },
    },
  };
}

/**
 * Resolves the `--executor` flag against the registry (B116): no registry and a flag is `no_executor_registry`, a
 * registry and no flag is `executor_required`, an unknown id is `unknown_executor`. `undefined` = as in 0.19.0.
 */
function resolveExecutor(root: string, executorId: string | undefined): Executor | undefined {
  const registry = readExecutors(root);
  if (registry === undefined) {
    if (executorId !== undefined) {
      throw new SdlcError('no_executor_registry', { key: 'error.no_executor_registry' });
    }
    return undefined;
  }
  if (executorId === undefined) {
    throw new SdlcError('executor_required', { key: 'error.executor_required' });
  }
  const executor = registry.get(executorId);
  if (!executor) {
    throw new SdlcError(
      'unknown_executor',
      { key: 'error.x_is_not_an_executor_of_x', params: { executor: executorId, file: 'openspec/executors.yaml' } },
    );
  }
  return executor;
}

/**
 * The validation and the items of `exportTasks`, without the `task.exported` log entries (B118a: the board
 * reuses it for a claim, whose own log is `task.claimed`). The refusal order is the one `task export` has:
 * registry, plan gate, task number, executor permission.
 */
export function exportItems(
  root: string, ref: ChangeRef, config: SdlcConfig, only?: string, executorId?: string,
): { items: TaskItem[]; executor?: Executor } {
  const executor = resolveExecutor(root, executorId);
  const view = evaluateChange(root, ref, config, { skipFingerprint: true, skipPeople: true });
  if (!planOpen(view)) {
    throw new SdlcError(
      'plan_not_approved',
      { key: 'error.the_plan_gate_of_x_is_x', params: { change: ref.id, status: planStatus(view) } },
      { key: 'fix.approve_the_plan_gate_of_x', params: { change: ref.id } },
    );
  }
  const tasks = changeTasks(ref);
  if (only !== undefined && !tasks.some((task) => task.id === only)) {
    throw new SdlcError(
      'unknown_task',
      { key: 'error.x_is_not_a_task_of_change_x', params: { task: only, change: ref.id } },
    );
  }
  const state = readChangeState(ref.dir);
  const refusal = executor ? executorRefusal(executor, state.risk, state.kind) : undefined;
  if (executor && refusal) {
    throw new SdlcError(
      'executor_not_allowed',
      { key: 'error.executor_x_cannot_take_x_x', params: { executor: executor.id, change: ref.id, reason: refusal } },
    );
  }
  const shared = {
    contract: 'sdlc.task/1' as const,
    change: ref.id,
    risk: state.risk,
    kind: state.kind,
    base: { ...(headCommit(root) ? { commit: headCommit(root) } : {}) },
    plan: { files: readPlanFiles(ref.dir, true) ?? [], proof: readPlanProof(ref.dir) },
    scenarios: parseRequirements(ref.dir).flatMap((r) => r.scenarios.map((s) => s.name)),
    checks: config.verify.commands.map((check) => ({ name: check.name, run: check.run, required: check.required })),
    forbidden: forbiddenPaths(root, config, state.tests_locked === true),
  };
  const items = tasks
    .filter((task) => !task.done && (only === undefined || task.id === only))
    .map((task) => workItem(ref, task, shared, executor));
  return { items, executor };
}

/** One work item per open (unchecked) task; `only` picks a single task number. */
export function exportTasks(
  root: string, ref: ChangeRef, config: SdlcConfig, only?: string, executorId?: string,
): TaskItem[] {
  const { items, executor } = exportItems(root, ref, config, only, executorId);
  // Each handed-out task is one log entry; a refused export logs nothing.
  const agent = agentEnvironment();
  for (const item of items) {
    if (executor) {
      appendLog(root, config, {
        event: 'task.exported', change: ref.id, task: item.task.id, executor: executor.id,
        ...(agent ? { agent } : {}),
      });
    }
  }
  return items;
}
