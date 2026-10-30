import { t } from './i18n.js';
import { openGateDeciders } from './named-approvers.js';
/**
 * Rework cycle limit (0.11.2, B61): once a gate was sent back `rework.max_cycles` times (default 3), the next step
 * of a change waiting on that rework is a person's, not another round of the agent: take the change over or review
 * its scope. A hint, not a ban: approving the gate again moves the change on as before.
 */
function isCounter(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/**
 * How many reworks the gate had: the record's counter; for a record written before 0.11.2 (no counter), the
 * `gate.<g>.rework` events of the change history (B79), at least one.
 */
export function reworkCycles(state, gate) {
    const rework = state.gates[gate]?.rework;
    if (!rework)
        return 0;
    if (isCounter(rework.cycle))
        return rework.cycle;
    const events = state.history.filter((event) => event.event === `gate.${gate}.rework`).length;
    return Math.max(events, 1);
}
/** The counter the next rework of a gate records. */
export function nextCycle(state, gate) {
    return reworkCycles(state, gate) + 1;
}
function peopleNames(root, config, view, state) {
    const deciders = openGateDeciders(root, config, view, state);
    return (deciders?.people ?? []).map((person) => person.name).join(', ');
}
/** The person's step once the open gate reached the limit while it waits on its rework; undefined otherwise. */
export function reworkLimitNext(root, config, view, state, skipPeople = false) {
    if (view.archived)
        return undefined;
    const gate = view.gates.find((item) => !item.satisfied);
    if (!gate || gate.status !== 'rejected' || !gate.rework)
        return undefined;
    const cycles = reworkCycles(state, gate.id);
    if (cycles < config.rework.maxCycles)
        return undefined;
    const people = skipPeople ? '' : peopleNames(root, config, view, state);
    const key = people ? 'next.reviewScopePeople' : 'next.reviewScope';
    const params = { gate: gate.id, cycles, change: view.change, ...(people ? { people } : {}) };
    return {
        actor: 'human',
        action: 'review-scope',
        gate: gate.id,
        cli: `sdlc takeover --change ${view.change} --note "<why>"`,
        key,
        params,
        message: t(key, params, 'en'),
    };
}
