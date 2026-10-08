/**
 * Planned vs actual participation of people (B63, 0.11.4): per change, the decisions the track plans for people
 * (the required approval gates and the approvals each needs) against what happened (approvals, re-approvals
 * included, reworks, takeovers, people's waivers, answers to open questions and the waits for a person).
 * Too few decisions (waived, forced) and too many (reworks, re-approvals, takeovers) both show. Read-only.
 */
import type { ChangeState, HistoryEvent } from './change-state.js';
import { APPROVAL_GATES, type ApprovalGateId, type SdlcConfig } from './config.js';
import type { LogEntry } from './log.js';
import { TAKEOVER_EVENT } from './takeover.js';

/** A person answered an open question of the change (the command comes with 0.11.4). */
export const ANSWERED_EVENT = 'question.answered';

const APPROVED = /^gate\.\w+\.approved$/;
const REWORK = /^gate\.\w+\.rework$/;
/** People's waivers only: a policy waiver is `gate.<g>.auto_waived` in the project log. */
const WAIVED = /^gate\.\w+\.waived$/;

export interface PlannedParticipation {
  /** The approval gates the track requires, in gate order. */
  gates: string[];
  /** The approvals those gates need, each gate counting its `min_approvals` (default 1). */
  approvals: number;
}

export interface ActualParticipation {
  approvals: number;
  reworks: number;
  takeovers: number;
  waivers: number;
  answers: number;
  /** Hours the gates waited for a person, summed, rounded to 0.1. */
  waitHours: number;
}

export interface Participation {
  planned: PlannedParticipation;
  actual: ActualParticipation;
}

/** Planned and actual summed over changes; `planned.gates` counts the planned gate decisions. */
export interface ParticipationTotals {
  planned: { gates: number; approvals: number };
  actual: ActualParticipation;
}

function plannedGate(config: SdlcConfig, track: ChangeState['track'], gate: ApprovalGateId): boolean {
  if (!config.gates[gate].required) return false;
  const optionalOnLite = gate === 'intent' || gate === 'spec';
  return !(track === 'lite' && optionalOnLite);
}

/** The gates the track requires and their approvals. */
export function plannedParticipation(config: SdlcConfig, track: ChangeState['track']): PlannedParticipation {
  const gates = APPROVAL_GATES.filter((gate) => plannedGate(config, track, gate));
  let approvals = 0;
  for (const gate of gates) {
    approvals += config.gates[gate].minApprovals ?? 1;
  }
  return { gates: [...gates], approvals };
}

function countEvents(history: HistoryEvent[], pattern: RegExp): number {
  return history.filter((event) => pattern.test(event.event)).length;
}

/** Answers come from the history; the project log is read when the history has none. */
function answersOf(history: HistoryEvent[], log: LogEntry[]): number {
  const inHistory = history.filter((event) => event.event === ANSWERED_EVENT).length;
  const inLog = log.filter((entry) => entry.event === ANSWERED_EVENT).length;
  return Math.max(inHistory, inLog);
}

function waitHoursOf(waits: Record<string, { seconds: number }>): number {
  let seconds = 0;
  for (const wait of Object.values(waits)) {
    seconds += wait.seconds;
  }
  return Math.round(seconds / 3600 * 10) / 10;
}

/** What people did on the change; `log` holds its project-log entries, `waits` the measured waits. */
export function actualParticipation(
  state: ChangeState,
  log: LogEntry[],
  waits: Record<string, { seconds: number }>,
): ActualParticipation {
  const history = state.history;
  return {
    approvals: countEvents(history, APPROVED),
    reworks: countEvents(history, REWORK),
    takeovers: history.filter((event) => event.event === TAKEOVER_EVENT).length,
    waivers: countEvents(history, WAIVED),
    answers: answersOf(history, log),
    waitHours: waitHoursOf(waits),
  };
}

export function participationOf(
  config: SdlcConfig,
  state: ChangeState,
  log: LogEntry[],
  waits: Record<string, { seconds: number }>,
): Participation {
  return {
    planned: plannedParticipation(config, state.track),
    actual: actualParticipation(state, log, waits),
  };
}

function emptyTotals(): ParticipationTotals {
  return {
    planned: { gates: 0, approvals: 0 },
    actual: { approvals: 0, reworks: 0, takeovers: 0, waivers: 0, answers: 0, waitHours: 0 },
  };
}

function addActual(total: ActualParticipation, row: ActualParticipation): void {
  total.approvals += row.approvals;
  total.reworks += row.reworks;
  total.takeovers += row.takeovers;
  total.waivers += row.waivers;
  total.answers += row.answers;
  total.waitHours = Math.round((total.waitHours + row.waitHours) * 10) / 10;
}

/** Planned and actual summed over the changes. */
export function sumParticipation(rows: Array<Participation | undefined>): ParticipationTotals {
  const total = emptyTotals();
  for (const row of rows) {
    if (!row) continue;
    total.planned.gates += row.planned.gates.length;
    total.planned.approvals += row.planned.approvals;
    addActual(total.actual, row.actual);
  }
  return total;
}

/** Planned gates of a change (`plan, review`, `-` when none), or their count over changes. */
function gatesText(gates: string[] | number): string | number {
  if (!Array.isArray(gates)) return gates;
  return gates.length > 0 ? gates.join(', ') : '-';
}

/** The message params of one participation line (`audit.participation`, the dashboard page). */
export function participationParams(p: Participation | ParticipationTotals): Record<string, string | number> {
  return {
    gates: gatesText(p.planned.gates),
    planned: p.planned.approvals,
    approvals: p.actual.approvals,
    reworks: p.actual.reworks,
    takeovers: p.actual.takeovers,
    waivers: p.actual.waivers,
    answers: p.actual.answers,
    hours: p.actual.waitHours,
  };
}