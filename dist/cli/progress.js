const DONE = new Set(['approved', 'passed', 'waived', 'n/a']);
const STEPS = [
    'intent',
    'spec',
    'plan',
    'build',
    'verify',
    'review',
    'release',
    'archive',
];
function gateOf(view, id) {
    return view.gates.find((gate) => gate.id === id);
}
/** Show release when the gate is required or already has recorded approvals/activity. */
export function includeRelease(view) {
    const gate = gateOf(view, 'release');
    if (!gate)
        return false;
    if (gate.required)
        return true;
    if (gate.approvals && gate.approvals.length > 0)
        return true;
    return gate.status !== 'pending'
        && gate.status !== 'blocked'
        && gate.status !== 'n/a';
}
export function isStepDone(step, view) {
    if (step === 'build') {
        return view.tasks.total > 0 && view.tasks.complete >= view.tasks.total;
    }
    if (step === 'archive') {
        return view.archived === true;
    }
    const gate = gateOf(view, step);
    if (!gate)
        return false;
    return DONE.has(gate.status);
}
/** Ordered lifecycle steps for this change (release omitted when unused). */
export function progressSteps(view) {
    return STEPS.filter((step) => step !== 'release' || includeRelease(view));
}
/**
 * Terminal stage stepper: "intent ● ─ spec ○ ─ … ─ archive ○".
 * ✓ done, ● first incomplete (current), ○ later.
 */
export function stepper(view) {
    const steps = progressSteps(view);
    let sawCurrent = false;
    const parts = [];
    for (const step of steps) {
        let mark;
        if (isStepDone(step, view)) {
            mark = '✓';
        }
        else if (!sawCurrent) {
            mark = '●';
            sawCurrent = true;
        }
        else {
            mark = '○';
        }
        parts.push(`${step} ${mark}`);
    }
    return parts.join(' ─ ');
}
/** Filled █ / empty ░ bar. total<=0 returns '' so callers can print "none yet". */
export function bar(done, total, width = 10) {
    if (total <= 0 || width <= 0)
        return '';
    const ratio = Math.max(0, Math.min(1, done / total));
    const filled = Math.round(ratio * width);
    return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}
/** Neutralize people/agent text so it cannot break Mermaid or invent edges. */
export function sanitizeMermaidLabel(text) {
    return String(text)
        .replace(/[\r\n]+/g, ' ')
        .replace(/"/g, '#quot;')
        .replace(/\[/g, '#lbrack;')
        .replace(/\]/g, '#rbrack;')
        .replace(/\{/g, '#lbrace;')
        .replace(/\}/g, '#rbrace;')
        .replace(/\(/g, '#lparen;')
        .replace(/\)/g, '#rparen;')
        .replace(/</g, '#lt;')
        .replace(/>/g, '#gt;')
        .replace(/\|/g, '#pipe;');
}
