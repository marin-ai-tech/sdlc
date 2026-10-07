import { loadProject } from '../cli/context.js';
import { withCliPrefix } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { previewApproval, type ApprovePreview } from '../core/approve-preview.js';
import { resolveChange } from '../core/changes.js';
import { APPROVAL_GATES, type ApprovalGateId } from '../core/config.js';
import { t } from '../core/i18n.js';
import { approveCli } from '../core/lifecycle.js';
import { assertHuman, parseGate } from './gates.js';

/**
 * `sdlc approve <gate> --change <id> --preview`: what the approval would cover and whether I may give it, without
 * giving it. Like `approve` it is a person's command (refused in an agent session); unlike it, it writes nothing.
 */
export interface PreviewOptions {
  change?: string;
  as?: string;
  by?: string;
  json?: boolean;
}

export async function approvePreviewCommand(gateArg: string, opts: PreviewOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, APPROVAL_GATES) as ApprovalGateId;
    assertHuman(ctx.config, 'approve');
    const ref = resolveChange(ctx.paths, opts.change);
    const preview = previewApproval({ root: ctx.root, config: ctx.config, ref, gate, as: opts.as, by: opts.by });
    const cli = withCliPrefix(approveCli(ref.id, gate, opts.as), ctx.config.cli);
    if (opts.json) return printJson(previewJson(preview, cli));
    printPreview(preview, cli);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

function previewJson(preview: ApprovePreview, cli: string): Record<string, unknown> {
  const refusals = preview.refusals.map(({ rule, message }) => ({ rule, message }));
  return { ...preview, refusals, ...(preview.allowed ? { cli } : {}) };
}

function printPreview(preview: ApprovePreview, cli: string): void {
  const status = t(`gateStatus.${preview.gateStatus}`);
  line(c.bold(t('preview.header', { gate: preview.gate, change: preview.change, status })));
  printArtifacts(preview);
  line(t('preview.approvals', { count: preview.approvals, min: preview.needed }));
  if (preview.openFindings) printFindings(preview.openFindings);
  if (preview.verification) {
    const { status: verified, at } = preview.verification;
    line(t(`preview.verification.${verified}`, { at: at ?? '' }));
  }
  printDecision(preview, cli);
}

function printArtifacts(preview: ApprovePreview): void {
  line(t('preview.artifacts'));
  for (const artifact of preview.artifacts) line(`  ${artifact.name}  ${artifact.path}`);
  if (preview.artifacts.length === 0) line(`  ${t('preview.none')}`);
  const changed = preview.changedSinceApproval;
  line(t('preview.changed', { files: changed.length > 0 ? changed.join(', ') : t('preview.nothing') }));
}

function printFindings(findings: NonNullable<ApprovePreview['openFindings']>): void {
  line(t('preview.findings', { count: findings.length }));
  for (const finding of findings) {
    line(`  ${finding.id ? `${finding.id} ` : ''}[${finding.severity}] ${finding.title}`);
  }
}

function printDecision(preview: ApprovePreview, cli: string): void {
  if (preview.allowed) {
    line(c.green(t('preview.allowed')));
    line(c.cyan(`$ ${cli}`));
    return;
  }
  line(c.red(t('preview.refused')));
  for (const refusal of preview.refusals) line(`  - ${refusal.text}`);
}
