import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { exportTasks } from '../core/task-contract.js';
import { checkResult, type ResultProblem, type ResultWarning, type TaskResult } from '../core/task-result.js';

/**
 * `sdlc task export` and `sdlc task check-result` (B115, epic E16): hand work out to an executor under the
 * `sdlc.task/1` contract and check what comes back. Anyone may run both commands, an agent too - they decide
 * nothing and write nothing, so they are not on the human-only command list.
 */

interface ExportOptions {
  change?: string;
  task?: string;
  json?: boolean;
}

interface CheckOptions {
  change?: string;
  branch: string;
  base?: string;
  json?: boolean;
}

function problemDetail(problem: ResultProblem): string {
  if (problem.file !== undefined) return problem.file;
  if (problem.task !== undefined) return `${problem.sha?.slice(0, 10)} ${problem.task}`;
  return problem.sha ?? '';
}

export function taskExportCommand(opts: ExportOptions): void {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    const items = exportTasks(ctx.root, ref, ctx.config, opts.task);
    if (opts.json) {
      printJson({ items, harness: ctx.stamp });
      return;
    }
    if (items.length === 0) {
      line(t('task.export.none', { change: ref.id }));
      return;
    }
    line(t('task.export.heading', { change: ref.id }));
    for (const item of items) {
      line(`  ${t('task.export.item', { id: item.id, text: item.task.text, branch: item.result.branch })}`);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

function printCheckText(result: TaskResult): void {
  if (result.ok) {
    line(t('task.check.ok', { commits: result.commits.length, files: result.files.length, base: result.base }));
  } else {
    line(t('task.check.problems', { count: result.problems.length }));
    for (const problem of result.problems) {
      line(`  ${t('task.issue', { code: problem.code, detail: problemDetail(problem) })}`);
    }
  }
  if (result.warnings.length > 0) {
    line(t('task.check.warnings', { count: result.warnings.length }));
    for (const warning of result.warnings) {
      line(`  ${t('task.issue', { code: warning.code, detail: warning.file })}`);
    }
  }
}

export function taskCheckResultCommand(opts: CheckOptions): void {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    const result = checkResult(ctx.root, ref, ctx.config, opts.branch, opts.base);
    if (!result.ok) process.exitCode = 1;
    if (opts.json) printJson(result);
    else printCheckText(result);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
