import { digestFiles, withoutCheckboxState } from './digest.js';
import { evaluateApprovalGate, lr, withLocalizedReason, } from './approval-gate.js';
import { GATE_STAGE } from './stages.js';
import { judgeBlockReason } from './judge-gate.js';
/** The three planning-gate evaluations plus the first reason a later gate is waiting on. */
export function evaluatePlanningGates(ref, config, state, decided, schema, mapping, artifacts, tracks) {
    const byId = new Map(artifacts.map((a) => [a.id, a]));
    const coveredFiles = (ids) => ids.flatMap((id) => byId.get(id)?.files ?? []);
    const missingOf = (ids) => ids.filter((id) => {
        const s = byId.get(id)?.status;
        return s !== 'done' && s !== 'skipped';
    });
    const gates = [];
    let upstreamOpen;
    for (const id of ['intent', 'spec', 'plan']) {
        const covered = mapping[id];
        if (covered.length === 0) {
            gates.push(withLocalizedReason({ id, stage: GATE_STAGE[id], required: false, status: 'n/a', satisfied: true,
                artifacts: [], approvals: [], staleApprovals: [], missingRoles: [] }, lr('gate.noArtifacts', { schema: schema.name })));
            continue;
        }
        const missing = missingOf(covered);
        const digest = missing.length === 0
            ? digestFiles(ref.dir, coveredFiles(covered), (rel, content) => (rel === tracks ? withoutCheckboxState(content) : content))
            : undefined;
        const judgeBlock = judgeBlockReason(config, state, id, digest);
        const blocked = missing.length > 0
            ? lr('gate.missingArtifacts', { artifacts: missing.join(', ') })
            : (upstreamOpen ?? judgeBlock);
        const evaluation = evaluateApprovalGate(id, config, state, decided[id], digest, blocked, covered, ref.archived);
        gates.push(evaluation);
        if (!evaluation.satisfied && !upstreamOpen)
            upstreamOpen = lr('gate.waitingOn', { gate: id });
    }
    return { gates, upstreamOpen };
}
