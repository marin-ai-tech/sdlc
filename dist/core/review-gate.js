/**
 * The review gate (moved out of lifecycle.ts, B123): findings in review.md plus a human code-owner
 * approval bound to the code under review and the review record. Blocking findings, missing pass or
 * lens coverage and findings deferred to unknown items all keep the gate blocked.
 */
import * as path from 'node:path';
import { readDeferred } from './deferred.js';
import { isFile, readText } from './fs-utils.js';
import { checkCoverage, parseCoverage, parseFindings, summarizeFindings, } from './review.js';
import { evaluateApprovalGate, lr } from './approval-gate.js';
/** The review summary for the view plus the gate evaluation; `review` stays unset without review.md. */
export function evaluateReviewGate(root, changeDir, config, state, gateState, digest, blocked, trustRecorded, ignoreBlockedWithApproval) {
    const reviewFile = path.join(changeDir, 'review.md');
    let review;
    let reviewBlocked = blocked;
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
            reviewBlocked = lr(coverage.unchecked.length ? 'gate.reviewCoverageUnchecked' : 'gate.reviewCoverage', {
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
    }
    else if (!reviewBlocked) {
        reviewBlocked = lr('gate.noReview');
    }
    const evaluation = evaluateApprovalGate('review', config, state, gateState, digest, reviewBlocked, [], trustRecorded, ignoreBlockedWithApproval);
    return { review, evaluation };
}
