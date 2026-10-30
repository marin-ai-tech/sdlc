import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { resolveChange } from '../core/changes.js';
import { issueExecutorToken, readExecutors, type Executor } from '../core/executors.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { humanCommandFix } from '../core/human-command.js';
import { t } from '../core/i18n.js';
import { appendLog } from '../core/log.js';
import { exportTasks } from '../core/task-contract.js';
import { checkResult, type ResultProblem, type ResultWarning, type TaskResult } from '../core/task-result.js';
import { extensionInput, runPrepared } from '../plugins/evaluation.js';
import { cliActor } from '../plugins/broker.js';
import { settingsWrite } from '../plugins/activation.js';

/**
 * `sdlc task export`, `sdlc task check-result` and `sdlc task executors` (B115/B116, epic E16): hand work out to
 * an executor under the `sdlc.task/1` contract, check what comes back, and show the executor registry. Anyone may
 * run all three, an agent too - they decide nothing and write nothing, so they are not on the human-only list.
 * `sdlc task executors token <id>` (B118) is: a person issues the executor's token.
 */

interface ExportOptions {
  extJson?: string;
  change?: string;
  task?: string;
  executor?: string;
  json?: boolean;
}

interface ExecutorsOptions {
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

/** An executor as the listing shows it: `hasToken`, never the hash and never a token. */
function listed(executor: Executor): Omit<Executor, 'tokenSha256'> & { hasToken: boolean } {
  const { tokenSha256, ...rest } = executor;
  return { ...rest, hasToken: tokenSha256 !== undefined };
}

/** `sdlc task executors`: the registry, read-only; an empty list and a note when there is none. */
export function taskExecutorsCommand(opts: ExecutorsOptions): void {
  try {
    const ctx = loadProject();
    const registry = readExecutors(ctx.root);
    const executors = [...(registry?.values() ?? [])];
    if (opts.json) {
      printJson({ executors: executors.map(listed) });
      return;
    }
    if (executors.length === 0) {
      line(t('task.executors.none'));
      return;
    }
    for (const executor of executors) {
      line(t('task.executors.item', {
        id: executor.id,
        type: executor.type,
        maxRisk: executor.maxRisk,
        kinds: executor.kinds?.join(', ') ?? t('task.executors.any'),
      }));
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

/**
 * `sdlc task executors token <id>` (B118, epic E16): a person issues the executor a new token for
 * `sdlc mcp serve --http`. The token is printed once and only its SHA-256 is kept; a new token revokes the old
 * one. An agent can never issue one (`agent_cannot_issue_token`, and the hook denies the command).
 */
export function taskExecutorTokenCommand(id: string, opts: ExecutorsOptions): void {
  try {
    if (agentEnvironment()) {
      throw new SdlcError(
        'agent_cannot_issue_token',
        { key: 'error.agent_cannot_issue_token' },
        humanCommandFix(`task executors token ${id}`),
      );
    }
    const ctx = loadProject();
    const { executor, token } = settingsWrite(ctx.paths.sdlcConfig, !!ctx.config.plugins,
      () => issueExecutorToken(ctx.root, id));
    const by = formatIdentity(gitIdentity(ctx.root));
    appendLog(ctx.root, ctx.config, { event: 'executor.token_issued', executor: executor.id, ...(by ? { by } : {}) });
    if (opts.json) {
      printJson({ executor: executor.id, token });
      return;
    }
    line(t('task.executors.token.value', { executor: executor.id, token }));
    line(t('task.executors.token.note', { executor: executor.id }));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function taskExportCommand(opts: ExportOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    const ext = extensionInput(opts.extJson);
    const items = await runPrepared(ctx.root, ctx.config, { operation: 'export', board: false,
      args: { change: ref.id, task: opts.task, executor: opts.executor, ext }, actor: cliActor(ctx.root, opts.executor) },
    () => exportTasks(ctx.root, ref, ctx.config, opts.task, opts.executor, ext));
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

export async function taskCheckResultCommand(opts: CheckOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    const result = await runPrepared(ctx.root, ctx.config, { operation: 'result', board: false,
      args: { change: ref.id, branch: opts.branch, base: opts.base }, actor: cliActor(ctx.root) },
    () => checkResult(ctx.root, ref, ctx.config, opts.branch, opts.base));
    if (!result.ok) process.exitCode = 1;
    if (opts.json) printJson(result);
    else printCheckText(result);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
