import * as path from 'node:path';
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
 * The scdl version and the license the project used scdl under when a record
 * was written. Every history event and gate, waiver and verification record
 * carries it.
 */
export interface Provenance {
  scdl?: string;
  license?: string;
}

export function provenance(stamp: HarnessStamp | undefined): Provenance {
  return stamp ? { scdl: stamp.version, license: stamp.license } : {};
}

export interface ApprovalRecord extends Provenance {
  role: string;
  by: string;
  person?: string;
  at: string;
  digest: string;
  note?: string;
  /** Digest of each main spec the change modifies, at approval time (spec gate). */
  base?: Record<string, string>;
}

export interface RejectionRecord extends Provenance {
  role?: string;
  by: string;
  at: string;
  note?: string;
}

export interface VerifyCommandRecord {
  name: string;
  command: string;
  exit_code: number | null;
  duration_ms: number;
  required: boolean;
  timed_out?: boolean;
}

export interface VerifyRecord extends Provenance {
  status: 'passed' | 'failed';
  at: string;
  commit?: string;
  fingerprint?: string;
  results: VerifyCommandRecord[];
}

export interface WaiverRecord extends Provenance {
  by: string;
  at: string;
  note: string;
}

export interface GateState {
  approvals?: ApprovalRecord[];
  rejection?: RejectionRecord;
  waived?: WaiverRecord;
}

export interface HistoryEvent extends Provenance {
  at: string;
  event: string;
  by?: string;
  detail?: string;
}

export interface ChangeState {
  version: 1;
  /** scdl version and license that last wrote this record. */
  harness?: { scdl: string; license: string };
  kind: ChangeKind;
  risk: RiskLevel;
  track: Track;
  track_suggestion?: { track: Track; reasons: string[] };
  created: string;
  source?: { type: SourceType; ref?: string; url?: string };
  links?: Record<string, string>;
  tests_locked?: boolean;
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
export function readChangeState(changeDir: string): ChangeState {
  const file = statePath(changeDir);
  if (!isFile(file)) return { ...newChangeState(), created: '' };
  const raw = readYamlObject(file) ?? {};
  if (raw.version !== undefined && raw.version !== 1) {
    throw new SdlcError('unsupported_state_version', `${file} has unsupported version ${String(raw.version)}.`);
  }
  const gates = (raw.gates && typeof raw.gates === 'object' ? raw.gates : {}) as ChangeState['gates'];
  const source = raw.source && typeof raw.source === 'object' ? (raw.source as Record<string, unknown>) : undefined;
  const harness = raw.harness && typeof raw.harness === 'object' ? (raw.harness as Record<string, unknown>) : undefined;
  const suggestion = raw.track_suggestion && typeof raw.track_suggestion === 'object' ? raw.track_suggestion as Record<string, unknown> : undefined;
  return {
    version: 1,
    ...(harness && typeof harness.scdl === 'string' && typeof harness.license === 'string'
      ? { harness: { scdl: harness.scdl, license: harness.license } }
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
    gates,
    ...(raw.verify && typeof raw.verify === 'object' ? { verify: raw.verify as VerifyRecord } : {}),
    history: Array.isArray(raw.history) ? (raw.history as HistoryEvent[]) : [],
  };
}

/** Writes the record; with a stamp, `harness` records the scdl version and license writing it. */
export function writeChangeState(changeDir: string, state: ChangeState, stamp?: HarnessStamp): void {
  if (stamp) state.harness = { scdl: stamp.version, license: stamp.license };
  const ordered: Record<string, unknown> = {
    version: 1,
    ...(state.harness ? { harness: state.harness } : {}),
    kind: state.kind,
    risk: state.risk,
    track: state.track,
    ...(state.track_suggestion ? { track_suggestion: state.track_suggestion } : {}),
    created: state.created || new Date().toISOString(),
    ...(state.source ? { source: state.source } : {}),
    ...(state.links && Object.keys(state.links).length > 0 ? { links: state.links } : {}),
    ...(state.tests_locked ? { tests_locked: true } : {}),
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
