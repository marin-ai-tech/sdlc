import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { buildTrace } from '../core/trace.js';
function printRequirement(requirement) {
    line(t('trace.requirement', { name: requirement.name, file: requirement.file }));
    if (requirement.scenarios.length === 0)
        line(`  ${t('trace.noScenarios')}`);
    for (const scenario of requirement.scenarios) {
        const results = scenario.evidence.map((row) => row.result).join(', ');
        const evidence = results ? t('trace.evidence', { results }) : t('trace.noEvidence');
        line(`  ${t('trace.scenario', { name: scenario.name, evidence })}`);
    }
}
function printTasks(trace) {
    line(t('trace.tasks'));
    for (const task of trace.tasks) {
        const commits = task.commits.map((hash) => hash.slice(0, 7)).join(', ');
        const link = commits ? t('trace.commits', { commits }) : t('trace.noCommit');
        line(`  ${task.id} [${task.done ? 'x' : ' '}] ${task.text} — ${link}`);
    }
}
function printFindings(trace) {
    line(t('trace.findings'));
    for (const finding of trace.findings) {
        const status = finding.status ?? t('trace.noStatus');
        line(`  ${finding.id} ${status} — ${finding.title}`);
    }
}
function printText(trace) {
    line(t(trace.archived ? 'trace.headingArchived' : 'trace.heading', { change: trace.change }));
    if (trace.intent)
        line(t('trace.intent', { title: trace.intent.title }));
    for (const requirement of trace.requirements)
        printRequirement(requirement);
    if (trace.tasks.length > 0)
        printTasks(trace);
    if (trace.findings.length > 0)
        printFindings(trace);
    if (trace.gaps.length === 0) {
        line(t('trace.noGaps'));
        return;
    }
    line(t('trace.gaps', { count: trace.gaps.length }));
    for (const gap of trace.gaps)
        line(`  ${t(`trace.gap.${gap.kind}`, { ref: gap.ref })}`);
}
export function traceCommand(id, opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, id, { allowArchived: true });
        const trace = buildTrace(ctx.root, ref);
        if (opts.json)
            printJson({ ...trace, harness: ctx.stamp });
        else
            printText(trace);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
