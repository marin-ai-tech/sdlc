import { c, line, printJson, warn } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { approvalCommitMessage, shortDigest } from '../core/approval-hygiene.js';
import { approverKey, stillNeeded } from '../core/approval-quorum.js';
import type { ReleaseCheckRecord } from '../core/change-state.js';
import type { StampAttempt } from '../core/stamp.js';
import { t } from '../core/i18n.js';
import { evaluateChange, type GateEvaluation } from '../core/lifecycle.js';
import type { ValidationIssue } from '../core/validate-change.js';
import type { ApprovalWork } from './gates.js';

export function presentGateApproval(work: ApprovalWork, warnings: ValidationIssue[], checks?: ReleaseCheckRecord[]) {
  const { ctx, ref, gate, digest, opts } = work;
  const after = evaluateChange(ctx.root, ref, ctx.config, { withQa: gate === 'qa' });
  const status = after.gates.find((item) => item.id === gate)!;
  const next = resolveNext(ctx, ref.id);
  const commitMessage = approvalCommitMessage(ref.id, gate, digest);
  if (opts.json) {
    printJson({ change: ref.id, gate, role: work.role, by: work.identity, status: status.status,
      missingRoles: status.missingRoles, ...(checks ? { checks } : {}),
      warnings: warnings.map((issue) => issue.message), commitMessage, ...(next ? { next } : {}),
      ...(work.replacedRoles?.length ? replacementDetails(work, status) : {}),
      ...(work.stamping ? { stamping: work.stamping } : {}) });
    return;
  }
  presentText(work, status, warnings, commitMessage);
}

function replacementDetails(work: ApprovalWork, status: GateEvaluation) {
  const count = new Set(status.approvals.map(approverKey)).size;
  const roles = status.missingRoles;
  const people = status.status === 'approved' ? 0 : Math.max(roles.length, (status.minApprovals ?? 1) - count);
  return { replacedRoles: work.replacedRoles, remainingAuthority: { roles, people } };
}

function presentText(work: ApprovalWork, status: GateEvaluation, warnings: ValidationIssue[], commitMessage: string) {
  const { ctx, ref, gate, role, identity, digest } = work;
  line(`${c.green(t('gate.approvedLine', { gate, identity, role }))} ${c.dim(`(${shortDigest(digest)})`)}`);
  for (const issue of warnings) warn(issue.message);
  if (status.status !== 'approved') line(`  ${t('gate.stillNeeded', { roles: stillNeeded(status) })}`);
  if (work.replacedRoles?.length) presentReplacement(work, status);
  presentStamping(work.stamping);
  const [subject, , trailer] = commitMessage.split('\n');
  line(c.dim(t('gate.commitMessage')));
  line(c.dim(`  $ git commit -m "${subject}" -m "${trailer}"`));
  emitNextHint(ctx, ref.id);
}

function presentReplacement(work: ApprovalWork, status: GateEvaluation): void {
  const details = replacementDetails(work, status);
  line(`  ${t('gate.replacedRoles', { roles: work.replacedRoles!.join(', ') })}`);
  if (details.remainingAuthority.people) {
    const roles = status.missingRoles.join(', ') || stillNeeded(status);
    line(`  ${t('gate.remainingIndependent', { roles })}`);
  }
}

export function presentStamping(stamping: StampAttempt | undefined): void {
  if (!stamping?.skippedCount) return;
  line(t('gate.stampCompleted', { count: stamping.stampedCount, files: stamping.stamped.join(', ') }));
  for (const skipped of stamping.skipped) line(t('gate.stampSkipped', skipped));
}
