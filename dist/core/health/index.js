import { contextStaleFinding, doctorFinding, enforcementFinding, noVerifyFinding, signingFinding, singlePersonFinding, } from './config-findings.js';
import { loadHealthContext } from './context.js';
import { denialsFinding, forcedArchiveFinding, liteBehaviourFinding, restaleFinding, testLockFinding, waiversFinding, } from './discipline.js';
import { deferredFinding, overdueFinding, stalledFinding, waitFinding } from './flow.js';
import { countFindings, orderFindings, renderFinding, } from './model.js';
import { firstPassFinding, openFindingsFinding, planDriftFinding, reworkReasonFinding, traceFinding, } from './quality.js';
const COLLECTORS = [
    { id: 'flow.overdue', run: overdueFinding, cost: 'bad' },
    { id: 'flow.wait', run: waitFinding, cost: 'normal' },
    { id: 'flow.stalled', run: stalledFinding, cost: 'normal' },
    { id: 'flow.deferred', run: deferredFinding, cost: 'normal' },
    { id: 'quality.first_pass', run: firstPassFinding, cost: 'normal' },
    { id: 'quality.rework_reason', run: reworkReasonFinding, cost: 'normal' },
    { id: 'quality.open_findings', run: openFindingsFinding, cost: 'normal' },
    { id: 'quality.plan_drift', run: planDriftFinding, cost: 'expensive' },
    { id: 'quality.trace', run: traceFinding, cost: 'expensive' },
    { id: 'discipline.waivers', run: waiversFinding, cost: 'normal' },
    { id: 'discipline.lite_behaviour', run: liteBehaviourFinding, cost: 'normal' },
    { id: 'discipline.forced_archive', run: forcedArchiveFinding, cost: 'normal' },
    { id: 'discipline.restale', run: restaleFinding, cost: 'normal' },
    { id: 'discipline.denials', run: denialsFinding, cost: 'normal' },
    { id: 'discipline.test_lock', run: testLockFinding, cost: 'normal' },
    { id: 'config.no_verify', run: noVerifyFinding, cost: 'bad' },
    { id: 'config.enforcement', run: enforcementFinding, cost: 'bad' },
    { id: 'config.single_person', run: singlePersonFinding, cost: 'normal' },
    { id: 'config.signing', run: signingFinding, cost: 'normal' },
    { id: 'config.context_stale', run: contextStaleFinding, cost: 'normal' },
    { id: 'config.doctor', run: doctorFinding, cost: 'expensive' },
];
function selected(ctx) {
    if (ctx.badOnly)
        return COLLECTORS.filter((entry) => entry.cost === 'bad');
    if (ctx.light)
        return COLLECTORS.filter((entry) => entry.cost !== 'expensive');
    return COLLECTORS;
}
/**
 * Runs the selected collectors. A collector that fails is left out of `evaluated` as well as of the findings, so a
 * failure is never read as a finding that went away.
 */
export function runHealth(root, paths, config, options = {}) {
    const ctx = loadHealthContext(root, paths, config, options);
    const drafts = [];
    const evaluated = [];
    for (const entry of selected(ctx)) {
        try {
            drafts.push(entry.run(ctx));
            evaluated.push(entry.id);
        }
        catch {
            // Health never fails on the data it reads.
        }
    }
    return { drafts: orderFindings(drafts), evaluated };
}
/** Every finding with facts, ordered bad, warn, info, then by id. */
export function collectHealth(root, paths, config, options = {}) {
    return runHealth(root, paths, config, options).drafts;
}
/** The findings rendered in a locale, with their counts per level. */
export function healthReport(drafts, locale) {
    const findings = drafts.map((draft) => renderFinding(draft, locale));
    return { findings, counts: countFindings(findings) };
}
