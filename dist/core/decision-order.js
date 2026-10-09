/** A usable order number: a positive integer. Anything else (a hand edit) leaves the decision to the time rule. */
export function isSeq(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/** True when decision `a` was recorded after decision `b`. */
export function decidedAfter(a, b) {
    if (isSeq(a.seq) && isSeq(b.seq))
        return a.seq > b.seq;
    return a.at > b.at;
}
/** True when `decision` was recorded after every one of `others` (also when there are none). */
export function decidedAfterAll(decision, others) {
    return others.every((other) => decidedAfter(decision, other));
}
/** The order fields of a decision, to carry into a record derived from it. */
export function orderOf(decision) {
    return isSeq(decision.seq) ? { at: decision.at, seq: decision.seq } : { at: decision.at };
}
function gateSeqs(gate) {
    if (!gate)
        return [];
    const records = [...(gate.approvals ?? []), gate.rejection, gate.waived, gate.rework];
    return records.map((record) => record?.seq);
}
/** The highest number given so far: the record's counter, or a decision's own `seq` (a counter lost on the way). */
function highestSeq(state) {
    const answers = (state.answers ?? []).map((answer) => answer.seq);
    const values = [state.seq, ...Object.values(state.gates).flatMap(gateSeqs), ...answers];
    return values.filter(isSeq).reduce((highest, value) => Math.max(highest, value), 0);
}
/** The number of the decision about to be written; advances the record's counter. */
export function nextSeq(state) {
    const next = highestSeq(state) + 1;
    state.seq = next;
    return next;
}
