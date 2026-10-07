import * as path from 'node:path';
import { isSeq } from './decision-order.js';
import { SdlcError } from './errors.js';
import { isFile } from './fs-utils.js';
import type { HarnessStamp } from './license.js';
import { readYamlObject, writeYaml } from './yaml-io.js';

/**
 * Per-change lifecycle record, stored as `.sdlc.yaml` inside the OpenSpec
 * change folder. OpenSpec ignores unknown files in a change folder and keeps
 * them through `openspec archive`, so the record travels with the change into
 * `changes/archive/` and stays part of the audit trail.
 */
export const CHANGE_KINDS = ['feature', 'bugfix', 'refactor', 'chore', 'docs', 'incident', 'security'] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];
export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const SOURCE_TYPES = ['idea', 'ticket', 'incident', 'alert', 'scan', 'review', 'exploration', 'bmad', 'backlog', 'deferred', 'other'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];
/**
 * `full` runs every gate. `lite` is the fast path for bounded work (a small
 * bug fix, refactor or chore): the intent and spec gates become optional and
 * the change starts at the plan.
 */
export const TRACKS = ['full', 'lite'] as const;
export type Track = (typeof TRACKS)[number];

/**
 * The sdlc version and the license the project used sdlc under when a record
 * was written. Every history event and gate, waiver and verification record
 * carries it.
 */
export interface Provenance {
  sdlc?: string;
  license?: string;
}

export function provenance(stamp: HarnessStamp | undefined): Provenance {
  return stamp ? { sdlc: stamp.version, license: stamp.license } : {};
}

export interface ApprovalRecord extends Provenance {
  role: string;
  by: string;
  person?: string;
  at: string;
  /** Order of the decision in the record (B39), written by the CLI; absent in records from sdlc 0.8.0 and earlier. */
  seq?: number;
  digest: string;
  note?: string;
  /** Digest of each main spec the change modifies, at approval time (spec gate). */
  base?: Record<string, string>;
}

export interface RejectionRecord extends Provenance {
  role?: string;
  by: string;
  at: string;
  /** Order of the decision in the record (B39), written by the CLI; absent in records from sdlc 0.8.0 and earlier. */
  seq?: number;
  note?: string;
}

/** A person sent the change back to this gate's stage (`sdlc rework`). */
export interface ReworkRecord extends Provenance {
  role?: string;
  by: string;
  at: string;
  /** Order of the decision in the record (B39), written by the CLI; absent in records from sdlc 0.8.0 and earlier. */
  seq?: number;
  reason: string;
  note: string;
  /** The change's stage before the rework. */
  from: string;
}

export interface VerifyCommandRecord {
  name: string;
  command: string;
  exit_code: number | null;
  duration_ms: number;
  required: boolean;
  timed_out?: boolean;
}

/** An MCP check of `sdlc verify` (B12): the CLI called the tool itself; the answer stays in the evidence. */
export interface VerifyMcpRecord {
  name: string;
  server: string;
  tool: string;
  required: boolean;
  ok: boolean;
  reason?: string;
  duration_ms: number;
}

export interface VerifyRecord extends Provenance {
  status: 'passed' | 'failed';
  at: string;
  commit?: string;
  fingerprint?: string;
  results: VerifyCommandRecord[];
  /** The MCP checks of the run; absent when the project has none. */
  mcp?: VerifyMcpRecord[];
}

export interface WaiverRecord extends Provenance {
  by: string;
  at: string;
  /** Order of the decision in the record (B39), written by the CLI; absent in records from sdlc 0.8.0 and earlier. */
  seq?: number;
  note: string;
}

export interface GateState {
  approvals?: ApprovalRecord[];
  rejection?: RejectionRecord;
  waived?: WaiverRecord;
  rework?: ReworkRecord;
}

export interface HistoryEvent extends Provenance {
  at: string;
  event: string;
  by?: string;
  detail?: string;
}

/** A person holds the change (`sdlc takeover`): the agent waits until they hand it back. */
export interface TakeoverRecord {
  by: string;
  at: string;
  note: string;
}

/**
 * Record format: 2 when the record carries a gate `rework` or a `takeover`, else 1. An older CLI refuses version 2
 * with its "unsupported version" error instead of reading the record without those fields; this one reads both.
 */
export type StateVersion = 1 | 2;
const SUPPORTED_VERSIONS: readonly unknown[] = [1, 2];

export interface ChangeState {
  version: StateVersion;
  /** sdlc version and license that last wrote this record. */
  harness?: { sdlc: string; license: string };
  kind: ChangeKind;
  risk: RiskLevel;
  track: Track;
  track_suggestion?: { track: Track; reasons: string[] };
  created: string;
  source?: { type: SourceType; ref?: string; url?: string };
  links?: Record<string, string>;
  tests_locked?: boolean;
  takeover?: TakeoverRecord;
  /** The last decision order number the CLI gave in this record (B39); see `decision-order.ts`. */
  seq?: number;
  gates: {
    intent?: GateState;
    spec?: GateState;
    plan?: GateState;
    review?: GateState;
    release?: GateState & { environment?: string };
    /** Only `waived` is meaningful for verify; results live in `verify`. */
    verify?: GateState;
  };
  verify?: VerifyRecord;
  history: HistoryEvent[];
}

export const STATE_FILE = '.sdlc.yaml';

export function statePath(changeDir: string): string {
  return path.join(changeDir, STATE_FILE);
}

export function newChangeState(init: Partial<Pick<ChangeState, 'kind' | 'risk' | 'source' | 'track'>> = {}): ChangeState {
  return {
    version: 1,
    kind: init.kind ?? 'feature',
    risk: init.risk ?? 'medium',
    track: init.track ?? 'full',
    created: new Date().toISOString(),
    ...(init.source ? { source: init.source } : {}),
    gates: {},
    history: [],
  };
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * Reads the record, tolerating a missing file (a plain OpenSpec change that
 * never went through `sdlc new` still gets a lifecycle view with defaults).
 */
/**
 * Records written before the rename from scdl carry the version under `scdl:`; they are read as `sdlc:`
 * (and rewritten with the new key on the next write). No other key in a change record is called `scdl`.
 */
function renameLegacyKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(renameLegacyKeys);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    const name = key === 'scdl' && !('sdlc' in value) ? 'sdlc' : key;
    out[name] = renameLegacyKeys(inner);
  }
  return out;
}

/** A takeover record as read: a malformed one still holds the change (fail closed), with what it carries. */
function takeoverOf(value: unknown): { takeover?: TakeoverRecord } {
  if (!value || typeof value !== 'object') return {};
  const raw = value as Record<string, unknown>;
  const text = (field: unknown, fallback: string) => (typeof field === 'string' ? field : fallback);
  return { takeover: { by: text(raw.by, 'unknown'), at: text(raw.at, ''), note: text(raw.note, '') } };
}

export function readChangeState(changeDir: string): ChangeState {
  const file = statePath(changeDir);
  if (!isFile(file)) return { ...newChangeState(), created: '' };
  const raw = renameLegacyKeys(readYamlObject(file) ?? {}) as Record<string, unknown>;
  if (raw.version !== undefined && !SUPPORTED_VERSIONS.includes(raw.version)) {
    throw new SdlcError(
      'unsupported_state_version',
      { key: 'error.x_has_unsupported_version_x', params: { file: file, p2: String(raw.version) } }
    );
  }
  const gates = (raw.gates && typeof raw.gates === 'object' ? raw.gates : {}) as ChangeState['gates'];
  const source = raw.source && typeof raw.source === 'object' ? (raw.source as Record<string, unknown>) : undefined;
  const harness = raw.harness && typeof raw.harness === 'object' ? (raw.harness as Record<string, unknown>) : undefined;
  const suggestion = raw.track_suggestion && typeof raw.track_suggestion === 'object' ? raw.track_suggestion as Record<string, unknown> : undefined;
  return {
    version: raw.version === 2 ? 2 : 1,
    ...(harness && typeof harness.sdlc === 'string' && typeof harness.license === 'string'
      ? { harness: { sdlc: harness.sdlc, license: harness.license } }
      : {}),
    kind: oneOf(raw.kind, CHANGE_KINDS, 'feature'),
    risk: oneOf(raw.risk, RISK_LEVELS, 'medium'),
    track: oneOf(raw.track, TRACKS, 'full'),
    ...(suggestion && typeof suggestion.track === 'string' && (TRACKS as readonly string[]).includes(suggestion.track) && Array.isArray(suggestion.reasons) && suggestion.reasons.every((r) => typeof r === 'string')
      ? { track_suggestion: { track: suggestion.track as Track, reasons: suggestion.reasons as string[] } } : {}),
    created: typeof raw.created === 'string' ? raw.created : '',
    ...(source
      ? {
          source: {
            type: oneOf(source.type, SOURCE_TYPES, 'other'),
            ...(typeof source.ref === 'string' ? { ref: source.ref } : {}),
            ...(typeof source.url === 'string' ? { url: source.url } : {}),
          },
        }
      : {}),
    ...(raw.links && typeof raw.links === 'object' ? { links: raw.links as Record<string, string> } : {}),
    ...(raw.tests_locked === true ? { tests_locked: true } : {}),
    ...takeoverOf(raw.takeover),
    ...(isSeq(raw.seq) ? { seq: raw.seq } : {}),
    gates,
    ...(raw.verify && typeof raw.verify === 'object' ? { verify: raw.verify as VerifyRecord } : {}),
    history: Array.isArray(raw.history) ? (raw.history as HistoryEvent[]) : [],
  };
}

/** The format a record needs: 2 with a gate rework or a takeover (fields older CLIs do not know), else 1. */
export function stateVersion(state: Pick<ChangeState, 'gates' | 'takeover'>): StateVersion {
  const reworked = Object.values(state.gates).some((gate) => gate?.rework !== undefined);
  return reworked || state.takeover !== undefined ? 2 : 1;
}

/** Writes the record; with a stamp, `harness` records the sdlc version and license writing it. */
export function writeChangeState(changeDir: string, state: ChangeState, stamp?: HarnessStamp): void {
  if (stamp) state.harness = { sdlc: stamp.version, license: stamp.license };
  state.version = stateVersion(state);
  const ordered: Record<string, unknown> = {
    version: state.version,
    ...(state.harness ? { harness: state.harness } : {}),
    kind: state.kind,
    risk: state.risk,
    track: state.track,
    ...(state.track_suggestion ? { track_suggestion: state.track_suggestion } : {}),
    created: state.created || new Date().toISOString(),
    ...(state.source ? { source: state.source } : {}),
    ...(state.links && Object.keys(state.links).length > 0 ? { links: state.links } : {}),
    ...(state.tests_locked ? { tests_locked: true } : {}),
    ...(state.takeover ? { takeover: state.takeover } : {}),
    ...(state.seq !== undefined ? { seq: state.seq } : {}),
    gates: state.gates,
    ...(state.verify ? { verify: state.verify } : {}),
    history: state.history,
  };
  writeYaml(
    statePath(changeDir),
    ordered,
    '# SDLC lifecycle record for this change (managed by `sdlc`; approvals are bound to artifact digests).'
  );
}

export function appendHistory(
  state: ChangeState,
  event: string,
  by?: string,
  detail?: string,
  stamp?: HarnessStamp
): void {
  state.history.push({
    at: new Date().toISOString(),
    event,
    ...(by ? { by } : {}),
    ...(detail ? { detail } : {}),
    ...provenance(stamp),
  });
}
