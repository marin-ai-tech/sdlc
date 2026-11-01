import type { ChangeRef } from './changes.js';
import { statePath } from './change-state.js';
import { isFile } from './fs-utils.js';
import { parseApproval } from './approval-records.js';
import { recordObject } from './record-values.js';
import { readYamlObject } from './yaml-io.js';
import { malformedGateShape } from './opaque-decisions.js';

export function malformedDecisionShapes(ref: ChangeRef) {
  const file = statePath(ref.dir);
  if (!isFile(file)) return [];
  const gates = recordObject(readYamlObject(file)?.gates) ?? {};
  return Object.entries(gates).flatMap(([gate, value]) => {
    const shape = malformedGateShape(value);
    return shape ? [{ change: ref.id, gate, shape }] : [];
  });
}

export interface MalformedApproval {
  change: string;
  gate: string;
  position: number;
}

/** Inspect the persisted list so positions name the entries a person can edit. */
export function malformedApprovals(ref: ChangeRef): MalformedApproval[] {
  const file = statePath(ref.dir);
  if (!isFile(file)) return [];
  const gates = recordObject(readYamlObject(file)?.gates);
  if (!gates) return [];
  const found: MalformedApproval[] = [];
  for (const [gate, value] of Object.entries(gates)) {
    const approvals = recordObject(value)?.approvals;
    if (!Array.isArray(approvals)) continue;
    approvals.forEach((entry, position) => {
      if (!parseApproval(entry)) found.push({ change: ref.id, gate, position });
    });
  }
  return found;
}
