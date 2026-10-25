import type { ChangeRef } from './changes.js';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import type { CapturedDigest, DigestCapture } from './digest.js';
import { evaluateChange } from './lifecycle.js';

/** One evaluation returns the same normalized texts that its gate digest hashed. No second file read. */
export function readGate(root: string, ref: ChangeRef, config: SdlcConfig, gate: ApprovalGateId): {
  change: string; gate: ApprovalGateId; status: string; snapshot?: CapturedDigest;
} {
  const capture: DigestCapture = new Map();
  const view = evaluateChange(root, ref, config, { capture, withQa: gate === 'qa' });
  const evaluation = view.gates.find((item) => item.id === gate)!;
  const snapshot = evaluation.digest ? capture.get(evaluation.digest) : undefined;
  return { change: ref.id, gate, status: evaluation.status, ...(snapshot ? { snapshot } : {}) };
}
