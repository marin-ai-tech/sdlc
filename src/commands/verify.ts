import * as path from 'node:path';
import { loadProject, recordChangeEvent, type ProjectContext } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { readChangeState } from '../core/change-state.js';
import { changeBase } from '../core/change-base.js';
import { resolveChange } from '../core/changes.js';
import { readChangeDeltas } from '../core/deltas.js';
import { readDeferred } from '../core/deferred.js';
import { SdlcError } from '../core/errors.js';
import { isFile, readText } from '../core/fs-utils.js';
import {
  defaultBaseRef, formatIdentity, git, gitIdentity, headCommit, isDirty, worktreeFingerprint,
} from '../core/git.js';
import { commitFingerprint, treeDifference } from '../core/tree-commit.js';
import { computePlanDrift } from '../core/plan-drift.js';
import { checkCoverage, parseCoverage, parseFindings, summarizeFindings } from '../core/review.js';
import { applyVerifyToState, runVerification, writeEvidence, type VerificationRun } from '../core/verify.js';
import { uncoveredScenarioReport } from '../core/verify-behaviour.js';
import { untouchedPlanned, verificationAttachments, type EvidenceExtras } from '../core/verify-extras.js';
import { runMcpChecks, selectedChecks, uncommittedCode, usesHead, withMcpChecks } from '../mcp/checks.js';
import { keepForAgent } from '../mcp/inbox.js';
import { readAsset } from '../integrations/assets.js';
import { readManifest } from '../integrations/manifest.js';
import { packLenses, reviewLenses, withPackChecks } from '../team/pack-effect.js';
import { reviewSuggest } from './review-suggest.js';
import { t } from '../core/i18n.js';
import { completeVerifyTasks } from '../core/verify-tasks.js';
import { branchChange } from '../core/change-branch.js';
import { appendLog, readLog } from '../core/log.js';
import { finishedRunFacts, skipsChecks, verifyTrigger, type VerifyTrigger } from '../core/verify-runs.js';
import { recordReviewRound } from '../core/review-rounds.js';
import { duplicateCheckNames } from '../core/verify-names.js';
import { assertKnownCheckNames } from '../core/verify-only.js';
import { failedSelection, mergeVerification } from '../core/verify-merge.js';
import { commandPassed } from '../core/verify-reason.js';
import { FINGERPRINT_EXCLUDES } from '../core/lifecycle.js';
import { findReuseSource, reuseHistoryDetail, reusedRun, reusedRunFacts } from '../core/verify-reuse.js';

export interface VerifyOptions {
  change?: string;
  only?: string;
  failed?: boolean;
  /** Commander sets this to false for `--no-reuse`. */
  reuse?: boolean;
  list?: boolean;
  check?: boolean;
  strict?: boolean;
  json?: boolean;
}

/**
 * The MCP checks (B12) after the commands: the CLI calls them itself, with `${HEAD}` and `${CHANGE}` expanded.
 * A `${HEAD}` check is not called while code outside openspec/ is uncommitted (B111).
 */
async function withMcp(
  ctx: ProjectContext,
  change: string,
  run: VerificationRun,
  opts: { only?: string[]; json?: boolean },
): Promise<VerificationRun> {
  if ((ctx.config.verify.mcp ?? []).length === 0) return run;
  const checks = selectedChecks(ctx.config, opts.only);
  for (const { name, server, tool } of opts.json ? [] : checks) {
    process.stderr.write(c.dim(`${t('verify.runningMcp', { name, server, tool })}\n`));
  }
  const needsTree = checks.some((check) => usesHead(check.args));
  const committedTree = needsTree && run.commit && run.fingerprint
    ? commitFingerprint(ctx.root, run.commit, FINGERPRINT_EXCLUDES) : undefined;
  const files = committedTree && run.fingerprint && committedTree !== run.fingerprint
    ? treeDifference(ctx.root, run.fingerprint, committedTree) : undefined;
  const treeBinding = needsTree
    ? { fingerprint: run.fingerprint, commitFingerprint: committedTree, files } : undefined;
  const vars = { head: run.commit, change, dirty: uncommittedCode(ctx.root, checks), treeBinding };
  const mcp = await runMcpChecks(ctx.config, checks, vars);
  return withMcpChecks(run, ctx.config, mcp);
}

/** B183: the reused run, if any, and the fingerprint taken for the lookup (a miss runs the checks on it). */
interface ReuseAttempt {
  run?: VerificationRun;
  fingerprint?: string;
}

/** B183: another change's passing run on this tree, when `verify.reuse` is on and this is a full run. */
function reusedVerification(
  ctx: ProjectContext,
  change: string,
  opts: VerifyOptions,
  requestedOnly: string[] | undefined,
): ReuseAttempt {
  if (!ctx.config.verify.reuse || opts.reuse === false || opts.failed || requestedOnly !== undefined) {
    return {};
  }
  const fingerprint = worktreeFingerprint(ctx.root, FINGERPRINT_EXCLUDES);
  if (!fingerprint) return {};
  const source = findReuseSource(ctx.paths, ctx.root, ctx.config, { change, fingerprint });
  if (!source) return { fingerprint };
  const dirty = isDirty(ctx.root, FINGERPRINT_EXCLUDES);
  const tree = { fingerprint, commit: headCommit(ctx.root), dirty };
  return { run: reusedRun(source, tree, ctx.config), fingerprint };
}

/** B57, B58: planned files nobody touched since the verify base and the `verification/` attachments. */
function evidenceExtras(ctx: ProjectContext, changeDir: string): EvidenceExtras {
  const base = ctx.config.review.base ?? defaultBaseRef(ctx.root);
  const ignore = Object.keys(readManifest(ctx.root).files);
  return {
    untouched: untouchedPlanned(ctx.root, changeDir, base, ignore),
    attachments: verificationAttachments(changeDir),
  };
}

/** The JSON answer's `mcp`: each check with the server's answer. */
function mcpJson(run: VerificationRun): Record<string, unknown> {
  if (!run.mcp) return {};
  const shape = run.mcp.map(({ name, server, tool, ok, reason, result, commit }) =>
    ({ name, server, tool, ok, ...(reason === undefined ? {} : { reason }), result,
      ...(commit ? { commit } : {}) }));
  return { mcp: shape };
}

function printMcpChecks(run: VerificationRun): void {
  for (const check of run.mcp ?? []) {
    const call = c.dim(`(${check.server}/${check.tool}, ${(check.duration_ms / 1000).toFixed(1)}s)`);
    line(`${check.ok ? c.green('✓') : c.red('✗')} ${check.name} ${call}`);
    if (check.reason) line(c.dim(`    ${check.reason}`));
  }
}

interface ListedCommand {
  name: string;
  run: string;
  required: boolean;
  remote?: true;
}

interface ListedMcpCheck {
  name: string;
  server: string;
  tool: string;
  required: boolean;
}

/** `--list`: the commands of `verify.commands` as configured. */
function listedCommands(ctx: ProjectContext): ListedCommand[] {
  return ctx.config.verify.commands.map((v) => ({
    name: v.name,
    run: v.run,
    required: v.required,
    ...(v.remote ? { remote: true as const } : {}),
  }));
}

/** `--list`: the MCP checks of `verify.mcp` as configured; no server is called. */
function listedMcpChecks(ctx: ProjectContext): ListedMcpCheck[] {
  const checks = ctx.config.verify.mcp ?? [];
  return checks.map(({ name, server, tool, required }) => ({ name, server, tool, required: required !== false }));
}

function printListedCommands(commands: ListedCommand[]): void {
  if (commands.length === 0) {
    line(t('verify.noCommands'));
    return;
  }
  for (const cmd of commands) {
    const optional = cmd.required ? '' : c.dim(t('verify.optional'));
    const remote = cmd.remote ? c.dim(t('verify.listRemote')) : '';
    line(`${cmd.name.padEnd(10)} ${cmd.run}${optional}${remote}`);
  }
}

function printListedMcpChecks(checks: ListedMcpCheck[]): void {
  if (checks.length === 0) return;
  line(c.bold(t('verify.listMcpHeading')));
  for (const check of checks) {
    const required = check.required ? t('verify.listRequired') : c.dim(t('verify.listOptional'));
    line(`${check.name.padEnd(10)} ${check.server} / ${check.tool}   ${required}`);
  }
}

/** `sdlc verify --list`: every check the verify gate runs - the commands, then the MCP checks. Runs nothing. */
function listChecks(ctx: ProjectContext, json?: boolean): void {
  const commands = listedCommands(ctx);
  const mcp = listedMcpChecks(ctx);
  if (json) return printJson({ commands, mcp });
  printListedCommands(commands);
  printListedMcpChecks(mcp);
}

/** The closing line of a failed run: a busy or silent remote is not a code defect. */
function failedLineKey(reason: VerificationRun['reason']): string {
  if (reason === 'fingerprint_unavailable') return 'verify.fingerprintUnavailable';
  if (reason === 'remote_unavailable') return 'verify.failedRemoteUnavailable';
  if (reason === 'remote_no_answer') return 'verify.failedRemoteNoAnswer';
  if (reason === 'remote_dirty') return 'verify.failedRemoteDirty';
  return 'verify.failed';
}

/** One check in the event detail: its exit code, the reason of a refused remote check, or `timeout`. */
function checkDetail(check: { name: string; exit_code: number | null; reason?: string }): string {
  if (check.exit_code !== null) return `${check.name}=${check.exit_code}`;
  const refused = check.reason === 'remote_dirty' || check.reason === 'remote_no_commit';
  return `${check.name}=${refused ? check.reason : 'timeout'}`;
}

export async function verifyCommand(opts: VerifyOptions): Promise<void> {
  try {
    // The checks of the accepted packs (B18) run after the project's own, each as an agent.
    const ctx = withPackChecks(loadProject());
    if (opts.list) return listChecks(ctx, opts.json);
    const duplicates = duplicateCheckNames(ctx.config.verify);
    if (duplicates.length > 0) {
      const { name, keys } = duplicates[0];
      throw new SdlcError('duplicate_check_names',
        { key: 'error.duplicate_check_names', params: { name, keys: keys.join(', ') } },
        { key: 'fix.duplicate_check_names' });
    }
    const ref = resolveChange(ctx.paths, opts.change ?? branchChange(ctx.root, ctx.paths));
    if (opts.check) {
      const coverage = uncoveredScenarioReport(ref.dir);
      if (opts.json) {
        printJson({ change: ref.id, scenarios: coverage.scenarios.length, uncovered: coverage.missing });
      } else if (coverage.missing.length === 0) {
        line(c.green(t('verify.checkOk', { count: coverage.scenarios.length })));
      } else {
        line(c.yellow(t('verify.checkMissing', {
          missing: coverage.missing.length, total: coverage.scenarios.length,
        })));
        for (const s of coverage.missing) line(`  - ${s}`);
      }
      if (opts.strict && coverage.missing.length > 0) process.exitCode = 1;
      return;
    }
    const requestedOnly = opts.only === undefined
      ? undefined : opts.only.split(',').map((s) => s.trim()).filter(Boolean);
    const previous = readChangeState(ref.dir).verify;
    const only = opts.failed
      ? failedSelection(previous, ctx.config, worktreeFingerprint(ctx.root, FINGERPRINT_EXCLUDES), requestedOnly)
      : requestedOnly;
    assertKnownCheckNames(ctx.config.verify, only);
    if (ctx.config.verify.commands.length === 0 && (ctx.config.verify.mcp ?? []).length === 0) {
      throw new SdlcError(
      'no_verify_commands',
      { key: 'error.no_verification_commands_are_configured' },
      { key: 'fix.add_them_under_verify_commands_in_openspec_sdlc_' }
    );
    }
    const attempt = reusedVerification(ctx, ref.id, opts, requestedOnly);
    const reused = attempt.run;
    let trigger: VerifyTrigger = 'first';
    const commands = reused ?? await runVerification(ctx.root, ctx.config, {
      only,
      ...(attempt.fingerprint ? { fingerprint: attempt.fingerprint } : {}),
      changeDir: ref.dir,
      onStart: (start) => {
        trigger = verifyTrigger(readLog(ctx.root).filter((entry) => entry.change === ref.id),
          start.started_at, start.fingerprint);
        appendLog(ctx.root, ctx.config, {
          event: 'verify.started', change: ref.id,
          run: { id: start.id, started_at: start.started_at,
            ...(start.fingerprint ? { fingerprint: start.fingerprint } : {}),
            ...(start.commit ? { commit: start.commit } : {}) },
        }, ctx.stamp, { outbox: false, strict: true });
      },
      onCheck: (check) => {
        if (!opts.json) process.stderr.write(c.dim(`${t('verify.running', { name: check.name, run: check.run })}\n`));
      },
    });
    const executed = reused ?? await withMcp(ctx, ref.id, commands, { only, json: opts.json });
    if (!reused) executed.at = new Date().toISOString();
    const run = reused ?? mergeVerification(executed, previous, ctx.config);
    const extras = evidenceExtras(ctx, ref.dir);
    const template = readAsset('records', 'verification.md');
    const file = writeEvidence(ref.dir, run, ref.id, template, ctx.stamp, extras, ctx.config);
    const state = readChangeState(ref.dir);
    applyVerifyToState(state, run, ctx.stamp);
    const mcpDetail = (executed.mcp ?? []).map((m) => `${m.name}=${m.ok ? 'ok' : 'failed'}`);
    const detail = reused?.reusedFrom ? reuseHistoryDetail(reused.reusedFrom)
      : [...executed.checks.map(checkDetail), ...mcpDetail].join(' ');
    const facts = reused ? reusedRunFacts(reused)
      : finishedRunFacts(executed, trigger, skipsChecks(ctx.config, only));
    recordChangeEvent(ctx, ref, state, `verify.${run.status}`, formatIdentity(gitIdentity(ctx.root)),
      detail, { run: facts });
    if (run.status === 'passed' && !only) completeVerifyTasks(ref.dir);
    // Outside an agent session the MCP results are also kept for the agent (the inbox).
    if (!reused) keepForAgent(ctx.root, ref.id, executed);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, status: run.status, ...(run.reason ? { reason: run.reason } : {}),
        ...(run.reusedFrom ? { reused_from: run.reusedFrom } : {}),
        at: run.at, commit: run.commit, dirty: run.dirty, checks: executed.checks,
        ...mcpJson(executed), planDrift: { untouched: extras.untouched }, attachments: extras.attachments,
        evidence: file, harness: ctx.stamp, ...(next ? { next } : {}) });
    } else {
      if (run.reusedFrom) {
        const from = { change: run.reusedFrom.change, run: run.reusedFrom.run_id };
        line(c.yellow(t('verify.reusedNotice', from)));
      }
      for (const check of executed.checks) {
        const ok = commandPassed(check);
        const timeout = check.timed_out ? c.red(t('verify.timedOut')) : '';
        line(`${ok ? c.green('✓') : c.red('✗')} ${check.name} ${c.dim(`(${(check.duration_ms / 1000).toFixed(1)}s)`)}${timeout}`);
        if (!ok && check.output) line(c.dim(check.output.split('\n').map((l) => `    ${l}`).join('\n')));
      }
      printMcpChecks(executed);
      if (extras.untouched.length > 0) {
        line(c.yellow(t('verify.untouchedPlanned', { list: extras.untouched.join(', ') })));
      }
      line(run.status === 'passed'
        ? c.green(t('verify.passed', { file: path.relative(process.cwd(), file) }))
        : c.red(t(failedLineKey(run.reason))));
      if (only) line(c.dim(t('verify.partial')));
      emitNextHint(ctx, ref.id);
    }
    if (run.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function reviewCommand(action: string, opts: { change?: string; base?: string; json?: boolean }): Promise<void> {
  try {
    if (action === 'suggest') return reviewSuggest(opts);
    if (action !== 'context' && action !== 'check') {
      throw new SdlcError('invalid_action', { key: 'error.use_sdlc_review_context_or_sdlc_review_check' });
    }
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, action === 'check'
      ? opts.change ?? branchChange(ctx.root, ctx.paths) : opts.change);
    // The lenses of the accepted packs (B18) are required and listed like the configured ones.
    const lenses = packLenses(ctx.root, ctx.config);
    if (action === 'check') {
      const file = path.join(ref.dir, 'review.md');
      if (!isFile(file)) throw new SdlcError(
      'no_review',
      { key: 'error.no_review_md_in_x_yet', params: { ref_id: ref.id } },
      { key: 'fix.run_the_review_workflow_first' }
    );
      const content = readText(file) ?? '';
      const findings = parseFindings(content);
      const summary = summarizeFindings(findings, ctx.config.review.blockOn);
      const required = [...ctx.config.review.passes, ...reviewLenses(ctx.config, lenses)];
      const coverage = { required, enforced: ctx.config.review.requireLensCoverage, ...checkCoverage(findings, parseCoverage(content), required) };
      const known = new Set(readDeferred(ctx.root).map((item) => item.id));
      const deferred = { missing: findings.filter((f) => f.deferredTo && !known.has(f.deferredTo)).map((f) => ({ finding: f, id: f.deferredTo })), unlinked: findings.filter((f) => f.deferredUnlinked) };
      if (opts.json) {
        printJson({ change: ref.id, ...summary, blocking: summary.blocking, coverage, deferred });
      } else {
        line(t('review.findingsSummary', {
          total: summary.total, open: summary.open, blocking: summary.blocking.length,
        }));
        for (const f of summary.blocking) {
          const where = f.where ? c.dim(` (${f.where})`) : '';
          line(`  ${c.red('✗')} ${f.id ?? ''} [${f.severity}][${f.pass}] ${f.title}${where}`);
        }
      }
      if (!opts.json) {
        if (coverage.missing.length) {
          line(t('review.missingCoverage', { list: coverage.missing.join(', ') }));
        }
        if (coverage.unchecked.length) {
          line(t('review.uncheckedCoverage', { list: coverage.unchecked.join(', ') }));
        }
        if (coverage.mismatched.length) {
          line(t('review.mismatchedCoverage', {
            list: coverage.mismatched.map((m) => m.name).join(', '),
          }));
        }
        if (deferred.missing.length) {
          line(t('review.missingDeferred', {
            list: deferred.missing.map((m) => m.id).join(', '),
          }));
        }
        if (deferred.unlinked.length) {
          line(t('review.unlinkedDeferred', {
            list: deferred.unlinked.map((f) => f.id ?? f.title).join(', '),
          }));
        }
      }
      if (summary.blocking.length > 0 || deferred.missing.length > 0 || (coverage.enforced && (coverage.missing.length > 0 || coverage.unchecked.length > 0))) process.exitCode = 1;
      try {
        recordReviewRound(ctx.root, ctx.config, ref.id, content, summary);
      } catch {
        // Recording is an observation; the check's output and verdict are already decided.
      }
      return;
    }
    const base = changeBase(ctx, ref, opts.base ?? ctx.config.review.base);
    const drift = computePlanDrift(ctx.root, ref.dir, base, Object.keys(readManifest(ctx.root).files));
    const policyFile = path.join(ctx.root, ctx.config.review.policy);
    const policy = readText(policyFile) ?? readAsset('project', 'REVIEW.md');
    const rel = (f: string) => path.relative(ctx.root, path.join(ref.dir, f));
    const payload = {
      change: ref.id,
      base: base ?? null,
      head: headCommit(ctx.root) ?? null,
      changedFiles: drift.changedFiles,
      planDrift: { unplanned: drift.unplanned, untouched: drift.untouched, plannedPaths: drift.plannedPaths },
      policy: { file: isFile(policyFile) ? ctx.config.review.policy : null, content: policy },
      blockOn: ctx.config.review.blockOn,
      passes: ctx.config.review.passes,
      lenses: reviewLenses(ctx.config, lenses),
      packLenses: lenses.map(({ id, pack, text }) => ({ id, pack, text })),
      requireLensCoverage: ctx.config.review.requireLensCoverage,
      artifacts: {
        intent: rel('intent.md'),
        proposal: rel('proposal.md'),
        specs: readChangeDeltas(ref.dir).map((d) => rel(d.file)),
        design: rel('design.md'),
        plan: rel('plan.md'),
        verification: rel('verification.md'),
        review: rel('review.md'),
      },
      diffCommand: base ? `git diff ${base}${git(ctx.root, ['cat-file', '-t', base]).stdout === 'tree'
        ? '..' : '...'}HEAD && git diff HEAD` : 'git diff HEAD',
    };
    if (opts.json) return printJson(payload);
    const baseLabel = base ?? 'n/a';
    line(`${c.bold(t('review.contextTitle', { change: ref.id }))} ${c.dim(t('review.base', { base: baseLabel }))}`);
    line(`  ${t('review.changedFiles', { count: drift.changedFiles.length })}`);
    line(`  ${t('review.planDrift', {
      unplanned: drift.unplanned.length, untouched: drift.untouched.length,
    })}`);
    for (const f of drift.unplanned) line(`    + ${f} ${c.dim(t('review.notInPlan'))}`);
    for (const f of drift.untouched) line(`    - ${f} ${c.dim(t('review.plannedUnchanged'))}`);
    const policyLabel = isFile(policyFile) ? ctx.config.review.policy : t('review.policyBuiltin');
    line(`  ${t('review.policy', { policy: policyLabel })}`);
    for (const lens of lenses) line(`  ${t('review.packLens', { id: lens.id, pack: lens.pack })}`);
    line(`  ${t('review.diff', { command: payload.diffCommand })}`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
