import * as path from 'node:path';
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { readChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { readChangeDeltas } from '../core/deltas.js';
import { readDeferred } from '../core/deferred.js';
import { SdlcError } from '../core/errors.js';
import { isFile, readText } from '../core/fs-utils.js';
import { defaultBaseRef, formatIdentity, gitIdentity, headCommit } from '../core/git.js';
import { computePlanDrift } from '../core/plan-drift.js';
import { checkCoverage, parseCoverage, parseFindings, summarizeFindings } from '../core/review.js';
import { applyVerifyToState, runVerification, writeEvidence } from '../core/verify.js';
import { readAsset } from '../integrations/assets.js';
import { readManifest } from '../integrations/manifest.js';
import { t } from '../core/i18n.js';

export interface VerifyOptions {
  change?: string;
  only?: string;
  list?: boolean;
  check?: boolean;
  strict?: boolean;
  json?: boolean;
}

/** Scenarios from the change's delta specs that the behavioral table never mentions. */
function uncoveredScenarios(changeDir: string): { scenarios: string[]; missing: string[] } {
  const scenarios = [...new Set(readChangeDeltas(changeDir).flatMap((d) => d.scenarios))];
  const verification = (readText(path.join(changeDir, 'verification.md')) ?? '').toLowerCase();
  const behavioral = verification.split('## behavioral verification')[1] ?? '';
  const missing = scenarios.filter((s) => !behavioral.includes(s.toLowerCase()));
  return { scenarios, missing };
}

export async function verifyCommand(opts: VerifyOptions): Promise<void> {
  try {
    const ctx = loadProject();
    if (opts.list) {
      const commands = ctx.config.verify.commands.map((v) => ({ name: v.name, run: v.run, required: v.required }));
      if (opts.json) return printJson({ commands });
      if (commands.length === 0) {
        line(t('verify.noCommands'));
        return;
      }
      for (const cmd of commands) {
        line(`${cmd.name.padEnd(10)} ${cmd.run}${cmd.required ? '' : c.dim(t('verify.optional'))}`);
      }
      return;
    }
    const ref = resolveChange(ctx.paths, opts.change);
    if (opts.check) {
      const coverage = uncoveredScenarios(ref.dir);
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
    if (ctx.config.verify.commands.length === 0) {
      throw new SdlcError(
      'no_verify_commands',
      { key: 'error.no_verification_commands_are_configured' },
      { key: 'fix.add_them_under_verify_commands_in_openspec_sdlc_' }
    );
    }
    const only = opts.only ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const run = await runVerification(ctx.root, ctx.config, {
      only,
      onCheck: (check) => {
        if (!opts.json) process.stderr.write(c.dim(`${t('verify.running', { name: check.name, run: check.run })}\n`));
      },
    });
    const file = writeEvidence(ref.dir, run, ref.id, readAsset('records', 'verification.md'), ctx.stamp);
    const state = readChangeState(ref.dir);
    applyVerifyToState(state, run, ctx.stamp);
    recordChangeEvent(ctx, ref, state, `verify.${run.status}`, formatIdentity(gitIdentity(ctx.root)),
      run.checks.map((ch) => `${ch.name}=${ch.exit_code ?? 'timeout'}`).join(' '));
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, status: run.status, at: run.at, commit: run.commit, dirty: run.dirty, checks: run.checks,
        evidence: file, harness: ctx.stamp, ...(next ? { next } : {}) });
    } else {
      for (const check of run.checks) {
        const ok = check.exit_code === 0;
        const timeout = check.timed_out ? c.red(t('verify.timedOut')) : '';
        line(`${ok ? c.green('✓') : c.red('✗')} ${check.name} ${c.dim(`(${(check.duration_ms / 1000).toFixed(1)}s)`)}${timeout}`);
        if (!ok && check.output) line(c.dim(check.output.split('\n').map((l) => `    ${l}`).join('\n')));
      }
      line(run.status === 'passed'
        ? c.green(t('verify.passed', { file: path.relative(process.cwd(), file) }))
        : c.red(t('verify.failed')));
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
    if (action !== 'context' && action !== 'check') {
      throw new SdlcError('invalid_action', { key: 'error.use_sdlc_review_context_or_sdlc_review_check' });
    }
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
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
      const required = [...ctx.config.review.passes, ...ctx.config.review.lenses];
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
      return;
    }
    const base = opts.base ?? ctx.config.review.base ?? defaultBaseRef(ctx.root);
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
      lenses: ctx.config.review.lenses,
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
      diffCommand: base ? `git diff ${base}...HEAD && git diff HEAD` : 'git diff HEAD',
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
    line(`  ${t('review.diff', { command: payload.diffCommand })}`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
