import { APPROVAL_GATES } from './config.js';
import { TAKEOVER_EVENT } from './takeover.js';
/** A person answered an open question of the change (the command comes with 0.11.4). */
export const ANSWERED_EVENT = 'question.answered';
const APPROVED = /^gate\.\w+\.approved$/;
const REWORK = /^gate\.\w+\.rework$/;
/** People's waivers only: a policy waiver is `gate.<g>.auto_waived` in the project log. */
const WAIVED = /^gate\.\w+\.waived$/;
function plannedGate(config, track, gate) {
    if (!config.gates[gate].required)
        return false;
    const optionalOnLite = gate === 'intent' || gate === 'spec';
    return !(track === 'lite' && optionalOnLite);
}
/** The gates the track requires and their approvals. */
export function plannedParticipation(config, track) {
    const gates = APPROVAL_GATES.filter((gate) => plannedGate(config, track, gate));
    let approvals = 0;
    for (const gate of gates) {
        approvals += config.gates[gate].minApprovals ?? 1;
    }
    return { gates: [...gates], approvals };
}
function countEvents(history, pattern) {
    return history.filter((event) => pattern.test(event.event)).length;
}
/** Answers come from the history; the project log is read when the history has none. */
function answersOf(history, log) {
    const inHistory = history.filter((event) => event.event === ANSWERED_EVENT).length;
    const inLog = log.filter((entry) => entry.event === ANSWERED_EVENT).length;
    return Math.max(inHistory, inLog);
}
function waitHoursOf(waits) {
    let seconds = 0;
    for (const wait of Object.values(waits)) {
        seconds += wait.seconds;
    }
    return Math.round(seconds / 3600 * 10) / 10;
}
/** What people did on the change; `log` holds its project-log entries, `waits` the measured waits. */
export function actualParticipation(state, log, waits) {
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
export function participationOf(config, state, log, waits) {
    return {
        planned: plannedParticipation(config, state.track),
        actual: actualParticipation(state, log, waits),
    };
}
function emptyTotals() {
    return {
        planned: { gates: 0, approvals: 0 },
        actual: { approvals: 0, reworks: 0, takeovers: 0, waivers: 0, answers: 0, waitHours: 0 },
    };
}
function addActual(total, row) {
    total.approvals += row.approvals;
    total.reworks += row.reworks;
    total.takeovers += row.takeovers;
    total.waivers += row.waivers;
    total.answers += row.answers;
    total.waitHours = Math.round((total.waitHours + row.waitHours) * 10) / 10;
}
/** Planned and actual summed over the changes. */
export function sumParticipation(rows) {
    const total = emptyTotals();
    for (const row of rows) {
        if (!row)
            continue;
        total.planned.gates += row.planned.gates.length;
        total.planned.approvals += row.planned.approvals;
        addActual(total.actual, row.actual);
    }
    return total;
}
/** Planned gates of a change (`plan, review`, `-` when none), or their count over changes. */
function gatesText(gates) {
    if (!Array.isArray(gates))
        return gates;
    return gates.length > 0 ? gates.join(', ') : '-';
}
/** The message params of one participation line (`audit.participation`, the dashboard page). */
export function participationParams(p) {
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
