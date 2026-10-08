import { CHANGE_KINDS, TRACKS, type ChangeState, type GateState } from './change-state.js';
import { APPROVAL_GATES, type ApprovalGateId, type SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { t } from './i18n.js';
import type { HarnessStamp } from './license.js';
import type { GateEvaluation, LifecycleView } from './lifecycle.js';
import { appendLog, readLog, type LogEntry } from './log.js';
import { effectiveGates } from './rework.js';

/**
 * Auto-waive policy (0.11.2, B59): `gates.<g>.auto_waive: { kinds: [...], tracks: [...] }` in the protected
 * `openspec/sdlc.yaml` waives a gate for changes of a matching kind or track. The evaluation reads the gate as
 * waived by the policy (it stays pure); the commands that record waits also append `gate.<g>.auto_waived` to the
 * project log once per change and gate, so the audit counts it as a policy waiver, not a person's. The verify and
 * review gates can never be waived by a policy.
 */
export interface AutoWaive {
  kinds?: string[];
  tracks?: string[];
}

export const POLICY_WAIVER = 'policy';
const KEYS = ['kinds', 'tracks'];
// Verify and review are the checks of the code; release runs its own checks when a person approves it (B47).
const NEVER: readonly string[] = ['verify', 'review', 'release'];
export const AUTO_WAIVED_EVENT = /^gate\.(\w+)\.auto_waived$/;

function invalid(where: string): SdlcError {
  return new SdlcError('invalid_config', { key: 'error.auto_waive_invalid', params: { where } });
}

function stringList(value: unknown, where: string, allowed: readonly string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) throw invalid(where);
  if (!value.every((item) => typeof item === 'string' && allowed.includes(item))) throw invalid(where);
  return value as string[];
}

/** `gates.<id>.auto_waive`, parsed; refused on verify, review and release, with other keys, or with bad lists. */
export function parseAutoWaive(value: unknown, gate: string, where: string): AutoWaive | undefined {
  if (value === undefined || value === null) return undefined;
  if (NEVER.includes(gate)) {
    throw new SdlcError('invalid_config', { key: 'error.auto_waive_not_allowed', params: { where, gate } });
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw invalid(where);
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !KEYS.includes(key))) throw invalid(where);
  const kinds = stringList(raw.kinds, `${where}.kinds`, CHANGE_KINDS);
  const tracks = stringList(raw.tracks, `${where}.tracks`, TRACKS);
  if (!kinds && !tracks) throw invalid(where);
  return { ...(kinds ? { kinds } : {}), ...(tracks ? { tracks } : {}) };
}

/** Why the policy waives the gate for this change ("kind docs", "track lite"); undefined when it does not. */
export function autoWaiveReason(config: SdlcConfig, gate: ApprovalGateId, state: ChangeState): string | undefined {
  if (NEVER.includes(gate)) return undefined;
  const policy = config.gates[gate].autoWaive;
  if (!state.kind_by_agent && policy?.kinds?.includes(state.kind)) return `kind ${state.kind}`;
  if (policy?.tracks?.includes(state.track)) return `track ${state.track}`;
  return undefined;
}

/** The gate records with the policy's waivers added; a person's own waiver stays as it is. */
export function withAutoWaive(
  gates: ChangeState['gates'], state: ChangeState, config: SdlcConfig,
): ChangeState['gates'] {
  const out: ChangeState['gates'] = { ...gates };
  for (const id of APPROVAL_GATES) {
    const reason = autoWaiveReason(config, id, state);
    const gate: GateState = out[id] ?? {};
    if (!reason || gate.waived) continue;
    out[id] = { ...gate, waived: { by: POLICY_WAIVER, at: state.created, note: `auto_waive: ${reason}` } };
  }
  return out;
}

/** Gates waived by the policy say so in their reason (`gate.autoWaived`, with the policy). */
export function markAutoWaived(gates: GateEvaluation[], state: ChangeState, config: SdlcConfig): GateEvaluation[] {
  return gates.map((gate) => {
    const id = gate.id as ApprovalGateId;
    const reason = (APPROVAL_GATES as readonly string[]).includes(id) ? autoWaiveReason(config, id, state) : undefined;
    const own = effectiveGates(state)[id]?.waived;
    if (!reason || gate.status !== 'waived' || own) return gate;
    const params = { policy: reason };
    return { ...gate, reason: t('gate.autoWaived', params, 'en'), reasonKey: 'gate.autoWaived', reasonParams: params };
  });
}

function logged(entries: LogEntry[], change: string, gate: string): boolean {
  return entries.some((e) => e.event === `gate.${gate}.auto_waived` && e.change === change);
}

type LogConfig = Parameters<typeof appendLog>[1];

/** Appends `gate.<g>.auto_waived` the first time a view shows a policy waiver. Never throws. */
export function recordAutoWaived(root: string, config: LogConfig, views: LifecycleView[], stamp?: HarnessStamp): void {
  const waived = views.flatMap((view) => view.gates
    .filter((gate) => gate.reasonKey === 'gate.autoWaived' && !view.archived)
    .map((gate) => ({ change: view.change, gate: gate.id, policy: String(gate.reasonParams?.policy ?? '') })));
  if (waived.length === 0) return;
  try {
    const entries = readLog(root);
    for (const item of waived.filter((w) => !logged(entries, w.change, w.gate))) {
      const event = `gate.${item.gate}.auto_waived`;
      const input = { event, change: item.change, by: POLICY_WAIVER, detail: item.policy };
      appendLog(root, config, input, stamp);
      entries.push({ ts: new Date().toISOString(), sdlc: '', license: '', ...input });
    }
  } catch {
    // The policy still applies; a missing log line only makes the audit less complete.
  }
}
