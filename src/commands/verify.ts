import * as path from 'node:path';
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
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
        line('No verification commands configured (verify.commands in openspec/sdlc.yaml).');
        return;
      }
      for (const cmd of commands) line(`${cmd.name.padEnd(10)} ${cmd.run}${cmd.required ? '' : c.dim(' (optional)')}`);
      return;
    }
    const ref = resolveChange(ctx.paths, opts.change);
    if (opts.check) {
      const coverage = uncoveredScenarios(ref.dir);
      if (opts.json) {
        printJson({ change: ref.id, scenarios: coverage.scenarios.length, uncovered: coverage.missing });
      } else if (coverage.missing.length === 0) {
        line(`${c.green('✓')} every spec scenario (${coverage.scenarios.length}) has a row under "Behavioral verification".`);
      } else {
        line(`${c.yellow('!')} ${coverage.missing.length} of ${coverage.scenarios.length} scenario(s) have no behavioral verification row:`);
        for (const s of coverage.missing) line(`  - ${s}`);
      }
      if (opts.strict && coverage.missing.length > 0) process.exitCode = 1;
      return;
    }
    if (ctx.config.verify.commands.length === 0) {
      throw new SdlcError('no_verify_commands', 'No verification commands are configured.',
        'Add them under verify.commands in openspec/sdlc.yaml (for example `- name: test\\n    run: npm test`).');
    }
    const only = opts.only ? opts.only.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const run = await runVerification(ctx.root, ctx.config, {
      only,
      onCheck: (check) => { if (!opts.json) process.stderr.write(c.dim(`running ${check.name}: ${check.run}\n`)); },
    });
    const file = writeEvidence(ref.dir, run, ref.id, readAsset('records', 'verification.md'), ctx.stamp);
    const state = readChangeState(ref.dir);
    applyVerifyToState(state, run, ctx.stamp);
    recordChangeEvent(ctx, ref, state, `verify.${run.status}`, formatIdentity(gitIdentity(ctx.root)),
      run.checks.map((ch) => `${ch.name}=${ch.exit_code ?? 'timeout'}`).join(' '));
    if (opts.json) {
      printJson({ change: ref.id, status: run.status, at: run.at, commit: run.commit, dirty: run.dirty, checks: run.checks,
        evidence: file, harness: ctx.stamp });
    } else {
      for (const check of run.checks) {
        const ok = check.exit_code === 0;
        line(`${ok ? c.green('✓') : c.red('✗')} ${check.name} ${c.dim(`(${(check.duration_ms / 1000).toFixed(1)}s)`)}${check.timed_out ? c.red(' timed out') : ''}`);
        if (!ok && check.output) line(c.dim(check.output.split('\n').map((l) => `    ${l}`).join('\n')));
      }
      line(run.status === 'passed'
        ? `${c.green('Verification passed')} - evidence recorded in ${path.relative(process.cwd(), file)}`
        : `${c.red('Verification failed')} - fix the code (not the tests) and run \`sdlc verify\` again.`);
      if (only) line(c.dim('Partial runs (--only) record evidence but never pass the verify gate.'));
    }
    if (run.status !== 'passed') process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function reviewCommand(action: string, opts: { change?: string; base?: string; json?: boolean }): Promise<void> {
  try {
    if (action !== 'context' && action !== 'check') {
      throw new SdlcError('invalid_action', 'Use `sdlc review context` or `sdlc review check`.');
    }
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    if (action === 'check') {
      const file = path.join(ref.dir, 'review.md');
      if (!isFile(file)) throw new SdlcError('no_review', `No review.md in ${ref.id} yet.`, 'Run the review workflow first.');
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
        line(`${summary.total} finding(s), ${summary.open} open; blocking open: ${summary.blocking.length}`);
        for (const f of summary.blocking) line(`  ${c.red('✗')} ${f.id ?? ''} [${f.severity}][${f.pass}] ${f.title}${f.where ? c.dim(` (${f.where})`) : ''}`);
      }
      if (!opts.json) {
        if (coverage.missing.length) line(`Missing review coverage: ${coverage.missing.join(', ')}`);
        if (coverage.unchecked.length) line(`Coverage lacks checked evidence: ${coverage.unchecked.join(', ')}`);
        if (coverage.mismatched.length) line(`Coverage counts differ from findings: ${coverage.mismatched.map((m) => m.name).join(', ')}`);
        if (deferred.missing.length) line(`Missing deferred registry ids: ${deferred.missing.map((m) => m.id).join(', ')}`);
        if (deferred.unlinked.length) line(`Unlinked deferred findings: ${deferred.unlinked.map((f) => f.id ?? f.title).join(', ')}; use sdlc defer add … --finding <F-id>`);
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
    line(`${c.bold(`Review context for ${ref.id}`)} ${c.dim(`(base ${base ?? 'n/a'})`)}`);
    line(`  changed files: ${drift.changedFiles.length}`);
    line(`  plan drift: ${drift.unplanned.length} unplanned, ${drift.untouched.length} planned but untouched`);
    for (const f of drift.unplanned) line(`    + ${f} ${c.dim('(not in plan.md)')}`);
    for (const f of drift.untouched) line(`    - ${f} ${c.dim('(planned, unchanged)')}`);
    line(`  policy: ${isFile(policyFile) ? ctx.config.review.policy : 'built-in default (no REVIEW.md)'}`);
    line(`  diff: ${payload.diffCommand}`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
