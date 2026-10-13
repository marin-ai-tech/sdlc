/**
 * The review gate (moved out of lifecycle.ts, B123): findings in review.md plus a human code-owner
 * approval bound to the code under review and the review record. Blocking findings, missing pass or
 * lens coverage and findings deferred to unknown items all keep the gate blocked.
 */
import * as path from 'node:path';
import type { ChangeState, GateState } from './change-state.js';
import type { SdlcConfig } from './config.js';
import { readDeferred } from './deferred.js';
import { isFile, readText } from './fs-utils.js';
import {
  checkCoverage,
  parseCoverage,
  parseFindings,
  summarizeFindings,
} from './review.js';
import { evaluateApprovalGate, lr, type LocalizedReason } from './approval-gate.js';
import type { GateEvaluation, LifecycleView } from './lifecycle.js';

/** The review summary for the view plus the gate evaluation; `review` stays unset without review.md. */
export function evaluateReviewGate(
  root: string,
  changeDir: string,
  config: SdlcConfig,
  state: ChangeState,
  gateState: GateState | undefined,
  digest: string | undefined,
  blocked: LocalizedReason | undefined,
  trustRecorded: boolean,
  ignoreBlockedWithApproval: boolean
): { review?: LifecycleView['review']; evaluation: GateEvaluation } {
  const reviewFile = path.join(changeDir, 'review.md');
  let review: LifecycleView['review'];
  let reviewBlocked: LocalizedReason | undefined = blocked;
  if (isFile(reviewFile)) {
    const content = readText(reviewFile) ?? '';
    const findings = parseFindings(content);
    const summary = summarizeFindings(findings, config.review.blockOn);
    review = {
      total: summary.total,
      open: summary.open,
      bySeverity: summary.bySeverity,
      byPass: summary.byPass,
      blocking: summary.blocking.map((f) => ({ ...(f.id ? { id: f.id } : {}), title: f.title, severity: f.severity })),
    };
    if (!reviewBlocked && summary.blocking.length > 0) {
      reviewBlocked = lr('gate.reviewBlocking', { count: summary.blocking.length });
    }
    const coverage = checkCoverage(findings, parseCoverage(content), [...config.review.passes, ...config.review.lenses]);
    if (!reviewBlocked && config.review.requireLensCoverage && (coverage.missing.length || coverage.unchecked.length)) {
      reviewBlocked = lr('gate.reviewCoverage', {
        missing: coverage.missing.join(', '),
        unchecked: coverage.unchecked.join(', '),
      });
    }
    const knownDeferred = new Set(readDeferred(root).map((item) => item.id));
    const missingDeferred = findings
      .filter((finding) => finding.deferredTo && !knownDeferred.has(finding.deferredTo))
      .map((finding) => finding.deferredTo);
    if (!reviewBlocked && missingDeferred.length) {
      reviewBlocked = lr('gate.missingDeferred', { ids: missingDeferred.join(', ') });
    }
  } else if (!reviewBlocked) {
    reviewBlocked = lr('gate.noReview');
  }
  const evaluation = evaluateApprovalGate('review', config, state, gateState, digest, reviewBlocked,
    [], trustRecorded, ignoreBlockedWithApproval);
  return { review, evaluation };
}
