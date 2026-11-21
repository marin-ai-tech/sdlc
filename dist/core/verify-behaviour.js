import * as path from 'node:path';
import { readChangeDeltas } from './deltas.js';
import { readText } from './fs-utils.js';
import { t } from './i18n.js';
/**
 * Spec scenarios the Behavioral verification table of verification.md never mentions
 * (same rule as `sdlc verify --check`, B110).
 */
export function uncoveredScenarioReport(changeDir) {
    const scenarios = [...new Set(readChangeDeltas(changeDir).flatMap((d) => d.scenarios))];
    const verification = (readText(path.join(changeDir, 'verification.md')) ?? '').toLowerCase();
    const behavioral = verification.split('## behavioral verification')[1] ?? '';
    const missing = scenarios.filter((s) => !behavioral.includes(s.toLowerCase()));
    return { scenarios, missing };
}
/** Scenario names still missing from the behavioral table. */
export function uncoveredScenarios(changeDir) {
    return uncoveredScenarioReport(changeDir).missing;
}
/**
 * When `verify.require_behaviour` is on and the table is incomplete, params for
 * `gate.verifyBehaviour`; otherwise undefined (behaviour does not block the gate).
 */
export function behaviourGapParams(changeDir, requireBehaviour) {
    if (!requireBehaviour)
        return undefined;
    const missing = uncoveredScenarios(changeDir);
    if (missing.length === 0)
        return undefined;
    return { scenarios: missing.join(', ') };
}
/**
 * A passed verify run whose behavioral table misses scenarios (`gate.verifyBehaviour`)
 * asks the agent to fill the table instead of re-running verify.
 */
export function verifyBehaviourNext(view, next) {
    if (next.action !== 'verify' || next.key !== 'next.verifyRun')
        return next;
    const verify = view.gates.find((g) => g.id === 'verify');
    if (verify?.reasonKey !== 'gate.verifyBehaviour')
        return next;
    const params = { scenarios: String(verify.reasonParams?.scenarios ?? '') };
    return {
        actor: 'agent',
        action: 'verify',
        workflow: 'verify',
        cli: `sdlc verify --change ${view.change} --check`,
        key: 'next.verifyBehaviour',
        params,
        message: t('next.verifyBehaviour', params, 'en'),
    };
}
