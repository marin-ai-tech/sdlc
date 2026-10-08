import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { approvalTrailers } from '../core/approval-hygiene.js';
import {
  allChanges, approvalSignature, approvalSites, rolesSignatures, trailerStatus, withAllowedSigners,
  type SignatureStatus,
} from '../core/approval-signatures.js';
import { SdlcError } from '../core/errors.js';
import type { ProjectPaths } from '../core/project.js';
import { readRolesFile, SIGNING_MODES, type RolesFile, type SigningMode } from '../core/roles.js';
import { t } from '../core/i18n.js';

interface Result { status: SignatureStatus; commit?: string; signer?: string }

function verify(root: string, paths: ProjectPaths, roles: RolesFile, signers: string) {
  const results: Array<Record<string, unknown> & Result> = [];
  const trailers = approvalTrailers(root);
  for (const site of approvalSites(root, allChanges(paths))) {
    const { ref, gate, record } = site;
    const trailer = trailerStatus(trailers, ref.id, gate, record.digest);
    const base = { change: ref.id, gate, role: record.role, by: record.by, person: record.person, trailer };
    results.push({ ...base, ...approvalSignature(root, roles, signers, site) });
  }
  results.push(...rolesSignatures(root, roles, signers));
  return results;
}

function printResults(results: ReturnType<typeof verify>, mode: string): void {
  for (const result of results) {
    const subject = result.file ?? `${result.change}/${result.gate}`;
    const mark = result.status === 'valid' ? '✓' : '✗';
    const status = t(`approvals.status.${result.status}`);
    line(`${mark} ${subject} ${result.person ?? result.by} ${status} ${result.commit?.slice(0, 8) ?? '-'}`);
  }
  const approvals = results.filter((result) => result.change).length;
  const failures = results.filter((result) => result.status !== 'valid');
  const blocking = mode === 'warn' ? t('approvals.warnNotBlocking') : '';
  line(t('approvals.summary', { approvals, invalid: failures.length, blocking }));
  if (failures.length) line(t('approvals.signHint'));
}

export function approvalsVerify(opts: { mode?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    const roles = readRolesFile(ctx.root);
    const mode = opts.mode ?? roles?.signing ?? 'off';
    if (!SIGNING_MODES.includes(mode as SigningMode)) {
      throw new SdlcError('invalid_mode', { key: 'error.unknown_signing_mode_x', params: { mode: mode } });
    }
    if (mode === 'off' || !roles) {
      if (opts.json) printJson({ mode, ok: true, results: [] });
      else line(t('approvals.off'));
      return;
    }
    const results = withAllowedSigners(roles, (signers) => verify(ctx.root, ctx.paths, roles, signers));
    const ok = results.every((result) => result.status === 'valid');
    if (opts.json) printJson({ mode, ok, results });
    else printResults(results, mode);
    if (mode === 'required' && !ok) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
