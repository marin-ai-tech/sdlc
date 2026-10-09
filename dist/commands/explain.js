import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { draftExplanation, explanationJson, } from '../core/explain.js';
import { t } from '../core/i18n.js';
export async function explainCommand(opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, opts.change, { allowArchived: true });
        const draft = draftExplanation(ctx.root, ref, ctx.config);
        if (opts.json) {
            printJson(explanationJson(draft));
            return;
        }
        printExplanation(draft);
    }
    catch (error) {
        reportFailure(error, opts.json, { change: null });
    }
}
/** The text in the reader's language: a short paragraph per section. */
function printExplanation(draft) {
    line(c.bold(t('explain.title', { change: draft.view.change, stage: t(`stage.${draft.view.stage}`) })));
    line(gateText(draft));
    line();
    line(waitingText(draft));
    line();
    line(c.bold(t('explain.unblock')));
    draft.steps.forEach((step, index) => printStep(step, index));
    line();
    line(c.bold(t('explain.recent')));
    printRecent(draft.recent);
}
function gateText(draft) {
    const gate = draft.gate;
    if (!gate) {
        return t('explain.noGate');
    }
    const reason = gate.reasonKey ? t(gate.reasonKey, gate.reasonParams) : gate.reason ?? '';
    const status = t(`gateStatus.${gate.status}`);
    if (reason === '') {
        return t('explain.gateNoReason', { gate: gate.id, status });
    }
    return t('explain.gate', { gate: gate.id, status, reason });
}
/** Who the change waits for, and the facts of the open gate; the next step itself is the first unblock step. */
function waitingText(draft) {
    const actor = actorText(draft.view.next.actor);
    const who = waitingWho(draft);
    const head = who ? t('explain.waitingWho', { actor, who }) : t('explain.waiting', { actor });
    return [head, ...draft.facts.map(localized)].join(' ');
}
/** The people who may act now (from roles.yaml), else the roles an approval waits for. */
function waitingWho(draft) {
    const people = draft.view.next.people ?? [];
    if (people.length > 0) {
        return people.map((person) => `${person.name}, ${person.role}`).join('; ');
    }
    return draft.roles.join(', ');
}
function printStep(step, index) {
    line(`  ${index + 1}. ${actorText(step.actor)}: ${localized(step.text)}`);
    if (step.cli) {
        line(c.cyan(`     $ ${step.cli}`));
    }
}
function printRecent(recent) {
    if (recent.length === 0) {
        line(`  ${t('explain.noRecent')}`);
        return;
    }
    for (const event of recent) {
        const by = event.by ? `  ${event.by}` : '';
        const detail = event.detail ? `: ${event.detail}` : '';
        line(`  ${c.dim(event.at)}  ${event.event}${by}${detail}`);
    }
}
function actorText(actor) {
    if (actor === 'human') {
        return t('actor.person');
    }
    if (actor === 'agent') {
        return t('actor.agent');
    }
    return t('actor.none');
}
function localized(ref) {
    return t(ref.key, ref.params);
}
