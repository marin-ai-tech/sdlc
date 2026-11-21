import { decidedAfter, decidedAfterAll } from './decision-order.js';
import { effectiveGates } from './rework.js';
import { t } from './i18n.js';
/** A rejection stays open until a later approval of the same gate. */
export function markOpenRejections(gates, state) {
    const effective = effectiveGates(state);
    return gates.map((gate) => {
        const record = effective[gate.id];
        const rejection = record?.rejection;
        if (!rejection || !decidedAfterAll(rejection, record?.approvals ?? []))
            return gate;
        if (rejection.digest && gate.digest && rejection.digest !== gate.digest)
            return gate;
        if (record?.waived && decidedAfter(record.waived, rejection))
            return gate;
        if (gate.status === 'rejected')
            return gate;
        const key = rejection.note ? 'gate.rejectedNote' : 'gate.rejected';
        const params = { by: rejection.by, note: rejection.note ?? '' };
        return { ...gate, status: 'rejected', satisfied: false,
            reason: t(key, params, 'en'), reasonKey: key, reasonParams: params };
    });
}
export function openRejectionNotes(gates) {
    return gates.filter((gate) => gate.status === 'rejected' && gate.reason)
        .map((gate) => `${gate.id}: ${gate.reasonParams?.note ?? gate.reason}`);
}
