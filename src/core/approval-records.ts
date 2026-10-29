import type { ApprovalRecord, GateState, ReleaseCheckRecord } from './change-state.js';
import { isSeq } from './decision-order.js';
import { recordObject, stringFields } from './record-values.js';

function releaseChecks(value: unknown): ReleaseCheckRecord[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: ReleaseCheckRecord[] = [];
  for (const entry of value) {
    const raw = recordObject(entry);
    if (!raw || !stringFields(raw, ['name', 'server', 'tool', 'at']) || typeof raw.ok !== 'boolean') return undefined;
    out.push({ ...raw, name: raw.name as string, server: raw.server as string,
      tool: raw.tool as string, at: raw.at as string, ok: raw.ok });
  }
  return out;
}

/** Malformed decisions never become an approval. Legacy decisions need no new fields. */
export function parseApproval(value: unknown): ApprovalRecord | undefined {
  const raw = recordObject(value);
  const optional = ['person', 'note', 'sdlc', 'license'];
  if (!raw || !stringFields(raw, ['role', 'by', 'at', 'digest'], optional)) return undefined;
  if (raw.seq !== undefined && !isSeq(raw.seq)) return undefined;
  const base = raw.base === undefined ? undefined : recordObject(raw.base);
  if (raw.base !== undefined && (!base || Object.values(base).some((item) => typeof item !== 'string'))) {
    return undefined;
  }
  const checks = raw.checks === undefined ? undefined : releaseChecks(raw.checks);
  if (raw.checks !== undefined && !checks) return undefined;
  return {
    ...raw,
    role: raw.role as string, by: raw.by as string, at: raw.at as string, digest: raw.digest as string,
    ...(raw.person !== undefined ? { person: raw.person as string } : {}),
    ...(raw.note !== undefined ? { note: raw.note as string } : {}),
    ...(raw.sdlc !== undefined ? { sdlc: raw.sdlc as string } : {}),
    ...(raw.license !== undefined ? { license: raw.license as string } : {}),
    ...(isSeq(raw.seq) ? { seq: raw.seq } : {}),
    ...(base ? { base: base as Record<string, string> } : {}),
    ...(checks ? { checks } : {}),
  };
}

/** Gate envelopes remain backward compatible; every approval is independently parsed. */
export function parseApprovalGatesWithRejected(value: unknown): {
  gates: Record<string, GateState>;
  rejected: Record<string, unknown[]>;
} {
  const raw = recordObject(value);
  if (!raw) return { gates: {}, rejected: {} };
  const gates: Record<string, GateState> = Object.create(null);
  const rejected: Record<string, unknown[]> = Object.create(null);
  for (const [name, value] of Object.entries(raw)) {
    const gate = recordObject(value);
    if (!gate) continue;
    const approvals = Array.isArray(gate.approvals) ? gate.approvals.flatMap((entry) => {
      const parsed = parseApproval(entry);
      if (!parsed) (rejected[name] ??= []).push(entry);
      return parsed ? [parsed] : [];
    }) : [];
    gates[name] = { ...gate, ...(gate.approvals !== undefined ? { approvals } : {}) };
  }
  return { gates, rejected };
}

export function parseApprovalGates(value: unknown): Record<string, GateState> {
  return parseApprovalGatesWithRejected(value).gates;
}
