import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { resolveChange } from '../core/changes.js';
import { issueExecutorToken, readExecutors } from '../core/executors.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { humanCommandFix } from '../core/human-command.js';
import { t } from '../core/i18n.js';
import { appendLog } from '../core/log.js';
import { exportTasks } from '../core/task-contract.js';
import { checkResult } from '../core/task-result.js';
import { extensionInput, runPrepared } from '../plugins/evaluation.js';
import { cliActor } from '../plugins/broker.js';
import { settingsWrite } from '../plugins/activation.js';
function problemDetail(problem) {
    if (problem.file !== undefined)
        return problem.file;
    if (problem.task !== undefined)
        return `${problem.sha?.slice(0, 10)} ${problem.task}`;
    return problem.sha ?? '';
}
/** An executor as the listing shows it: `hasToken`, never the hash and never a token. */
function listed(executor) {
    const { tokenSha256, ...rest } = executor;
    return { ...rest, hasToken: tokenSha256 !== undefined };
}
/** `sdlc task executors`: the registry, read-only; an empty list and a note when there is none. */
export function taskExecutorsCommand(opts) {
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
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
/**
 * `sdlc task executors token <id>` (B118, epic E16): a person issues the executor a new token for
 * `sdlc mcp serve --http`. The token is printed once and only its SHA-256 is kept; a new token revokes the old
 * one. An agent can never issue one (`agent_cannot_issue_token`, and the hook denies the command).
 */
export function taskExecutorTokenCommand(id, opts) {
    try {
        if (agentEnvironment()) {
            throw new SdlcError('agent_cannot_issue_token', { key: 'error.agent_cannot_issue_token' }, humanCommandFix(`task executors token ${id}`));
        }
        const ctx = loadProject();
        const { executor, token } = settingsWrite(ctx.paths.sdlcConfig, !!ctx.config.plugins, () => issueExecutorToken(ctx.root, id));
        const by = formatIdentity(gitIdentity(ctx.root));
        appendLog(ctx.root, ctx.config, { event: 'executor.token_issued', executor: executor.id, ...(by ? { by } : {}) });
        if (opts.json) {
            printJson({ executor: executor.id, token });
            return;
        }
        line(t('task.executors.token.value', { executor: executor.id, token }));
        line(t('task.executors.token.note', { executor: executor.id }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
export async function taskExportCommand(opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, opts.change);
        const ext = extensionInput(opts.extJson);
        const items = await runPrepared(ctx.root, ctx.config, { operation: 'export', board: false,
            args: { change: ref.id, task: opts.task, executor: opts.executor, ext }, actor: cliActor(ctx.root, opts.executor) }, () => exportTasks(ctx.root, ref, ctx.config, opts.task, opts.executor, ext));
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
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function printCheckText(result) {
    if (result.ok) {
        line(t('task.check.ok', { commits: result.commits.length, files: result.files.length, base: result.base }));
    }
    else {
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
export async function taskCheckResultCommand(opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, opts.change);
        const result = await runPrepared(ctx.root, ctx.config, { operation: 'result', board: false,
            args: { change: ref.id, branch: opts.branch, base: opts.base }, actor: cliActor(ctx.root) }, () => checkResult(ctx.root, ref, ctx.config, opts.branch, opts.base));
        if (!result.ok)
            process.exitCode = 1;
        if (opts.json)
            printJson(result);
        else
            printCheckText(result);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
