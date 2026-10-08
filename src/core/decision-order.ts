import type { ChangeState, GateState } from './change-state.js';

/**
 * The order decisions were recorded in (B39). `.sdlc.yaml` travels through git between machines whose clocks
 * differ, so the time of a decision cannot tell whether it came before or after another one. Every decision the
 * CLI writes to a change record (approval, rejection, waiver, rework, answer) carries `seq`, the record's next
 * number, and the record keeps the last number it gave in its top-level `seq`. Two decisions compare by `seq` when
 * both carry one; when either lacks it (records written by sdlc 0.8.0 and earlier) they compare by their `at` time.
 */
export interface Ordered {
  at: string;
  seq?: number;
}

/** A usable order number: a positive integer. Anything else (a hand edit) leaves the decision to the time rule. */
export function isSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** True when decision `a` was recorded after decision `b`. */
export function decidedAfter(a: Ordered, b: Ordered): boolean {
  if (isSeq(a.seq) && isSeq(b.seq)) return a.seq > b.seq;
  return a.at > b.at;
}

/** True when `decision` was recorded after every one of `others` (also when there are none). */
export function decidedAfterAll(decision: Ordered, others: Ordered[]): boolean {
  return others.every((other) => decidedAfter(decision, other));
}

/** The order fields of a decision, to carry into a record derived from it. */
export function orderOf(decision: Ordered): Ordered {
  return isSeq(decision.seq) ? { at: decision.at, seq: decision.seq } : { at: decision.at };
}

function gateSeqs(gate: GateState | undefined): unknown[] {
  if (!gate) return [];
  const records = [...(gate.approvals ?? []), gate.rejection, gate.waived, gate.rework];
  return records.map((record) => record?.seq);
}

/** The highest number given so far: the record's counter, or a decision's own `seq` (a counter lost on the way). */
function highestSeq(state: ChangeState): number {
  const answers = (state.answers ?? []).map((answer) => answer.seq);
  const values = [state.seq, ...Object.values(state.gates).flatMap(gateSeqs), ...answers];
  return values.filter(isSeq).reduce((highest, value) => Math.max(highest, value), 0);
}

/** The number of the decision about to be written; advances the record's counter. */
export function nextSeq(state: ChangeState): number {
  const next = highestSeq(state) + 1;
  state.seq = next;
  return next;
}
