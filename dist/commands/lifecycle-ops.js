import { t } from '../core/i18n.js';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { agentEnvironment } from '../core/agent-env.js';
import { appendHistory, copyKeptApprovals, readChangeState, writeChangeState } from '../core/change-state.js';
import { listActiveChanges, listChangeFolders, resolveChange } from '../core/changes.js';
import { checkDeltaTargets, findOverlaps, readChangeDeltas } from '../core/deltas.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { evaluateChange } from '../core/lifecycle.js';
import { openspecFailure, runOpenSpecJson } from '../core/openspec.js';
import { isFile, readText, writeTextAtomic } from '../core/fs-utils.js';
import { stampTextLocalized } from '../core/license.js';
import { appendLog, readLog } from '../core/log.js';
import { filterLog } from '../core/log-filter.js';
import { changeMarkdown, tryStampArtifacts } from '../core/stamp.js';
import { aggregateMetrics, changeMetrics } from '../core/metrics.js';
import { agentCommits } from '../core/agent-commits.js';
import { agentEvents } from '../core/agent-events.js';
import { auditChange, changesInPeriod } from '../core/audit-change.js';
import { changeLog } from '../core/awaiting.js';
import { printChangeFlow, printChangeParticipation, printProjectFlow, printProjectParticipation, } from './audit-flow.js';
import { readBacklog, setBacklogStatus } from '../core/backlog.js';
import { queueIssueClose } from '../mcp/issues.js';
import { auditExportCommand } from './audit-export.js';
import { closeDeferred, readDeferred } from '../core/deferred.js';
import { parseSince } from '../report/model.js';
import { validateOne } from '../core/validate-change.js';
export async function validateCommand(opts) {
    try {
        const ctx = loadProject();
        const refs = opts.all || (!opts.change && listActiveChanges(ctx.paths).length !== 1)
            ? listChangeFolders(ctx.paths)
            : [resolveChange(ctx.paths, opts.change)];
        const items = refs.map((ref) => validateOne(ctx, ref));
        const overlaps = findOverlaps(listActiveChanges(ctx.paths).map((r) => ({ id: r.id, deltas: readChangeDeltas(r.dir) })))
            .filter((o) => o.changes.some((ch) => refs.some((r) => r.id === ch.change)));
        const failed = items.filter((i) => !i.valid).length;
        if (opts.json) {
            printJson({
                items: items.map((item) => ({
                    change: item.change,
                    valid: item.valid,
                    issues: item.issues.map(({ source, level, path: p, line: ln, message }) => ({
                        source, level, ...(p ? { path: p } : {}), ...(ln ? { line: ln } : {}), message,
                    })),
                })),
                overlaps,
                summary: { total: items.length, valid: items.length - failed, invalid: failed },
            });
        }
        else {
            for (const item of items) {
                line(`${item.valid ? c.green('✓') : c.red('✗')} ${item.change}`);
                for (const i of item.issues) {
                    const tag = i.level === 'error' ? c.red(t('label.error'))
                        : i.level === 'warning' ? c.yellow(t('label.warning'))
                            : c.dim(t('label.info'));
                    const msg = i.textKey ? t(i.textKey, i.textParams) : i.message;
                    const loc = i.path ? `${i.path}${i.line ? `:${i.line}` : ''}: ` : '';
                    line(`    ${tag} ${c.dim(`[${i.source}]`)} ${loc}${msg}`);
                }
            }
            for (const o of overlaps) {
                warn(t('warn.archiveOverlap', {
                    requirement: o.requirement, capability: o.capability,
                    changes: o.changes.map((x) => `${x.change}:${x.op}`).join(', '),
                }));
            }
            if (items.length === 0)
                line(t('validate.none'));
        }
        if (failed > 0)
            process.exitCode = 1;
    }
    catch (error) {
        reportFailure(error, opts.json, { items: [] });
    }
}
async function confirm(question) {
    if (!process.stdin.isTTY)
        return false;
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    try {
        return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
    }
    finally {
        rl.close();
    }
}
export async function archiveCommand(id, opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, id);
        const view = evaluateChange(ctx.root, ref, ctx.config);
        const open = view.gates.filter((g) => g.required && !g.satisfied);
        if (open.length > 0 && !opts.force) {
            throw new SdlcError('gates_not_satisfied', { key: 'error.cannot_archive_x_x', params: { ref_id: ref.id, p2: open.map((g) => `${g.id} (${g.status}${g.reason ? `: ${g.reason}` : ''})`).join('; ') } }, { key: 'fix.next_x', params: { detail: view.next.cli ?? view.next.message } });
        }
        if (opts.force) {
            const agent = agentEnvironment();
            if (agent && ctx.config.enforcement.forbidAgentApprovals) {
                throw new SdlcError('agent_cannot_force', { key: 'error.archiving_past_unsatisfied_gates_is_a_human_deci' });
            }
            if (open.length > 0 && !opts.note)
                throw new SdlcError('note_required', { key: 'error.force_past_open_gates_needs_note_why_for_the_aud' });
        }
        const deltaErrors = checkDeltaTargets(ctx.paths, readChangeDeltas(ref.dir)).filter((i) => i.level === 'error');
        if (deltaErrors.length > 0 && !opts.skipSpecs) {
            throw new SdlcError('delta_check_failed', { key: 'error.delta_specs_of_x_do_not_match_the_living_specs_x', params: { ref_id: ref.id, p2: deltaErrors.map((e) => `${e.file}:${e.line} ${e.message}`).join(' | ') } }, { key: 'fix.fix_the_delta_headers_run_sdlc_validate_change_x', params: { ref_id: ref.id } });
        }
        if (!opts.yes && !(await confirm(`Archive ${ref.id} and merge its delta specs into openspec/specs?`))) {
            throw new SdlcError('archive_confirmation_required', { key: 'error.archive_needs_confirmation' }, { key: 'fix.re_run_with_yes_sdlc_archive_x_yes', params: { ref_id: ref.id } });
        }
        const before = readChangeState(ref.dir);
        const state = JSON.parse(JSON.stringify(before));
        copyKeptApprovals(before, state);
        const by = formatIdentity(gitIdentity(ctx.root)) ?? agentEnvironment();
        const event = open.length > 0 ? 'change.archived.forced' : 'change.archived';
        const detail = open.length > 0 ? `open gates: ${open.map((g) => g.id).join(', ')}; ${opts.note ?? ''}` : undefined;
        // Every artifact that goes into the archive records the sdlc version and license that archived it.
        const originals = new Map(changeMarkdown(ref.dir).map((f) => [f, readText(path.join(ref.dir, f)) ?? '']));
        const stamping = tryStampArtifacts(ref.dir, [...originals.keys()], ctx.stamp);
        if (stamping.error && !opts.json)
            warn(t('warn.provenanceNotWritten', { error: stamping.error }));
        appendHistory(state, event, by, detail, ctx.stamp);
        writeChangeState(ref.dir, state, ctx.stamp);
        const args = ['archive', ref.id, '--yes'];
        if (opts.skipSpecs)
            args.push('--skip-specs');
        const result = runOpenSpecJson(args, ctx.root);
        if (!result.ok || !result.data?.archive) {
            writeChangeState(ref.dir, before);
            for (const [file, content] of originals) {
                const target = path.join(ref.dir, file);
                if (isFile(target) && readText(target) !== content)
                    writeTextAtomic(target, content);
            }
            throw new SdlcError('openspec_archive_failed', { key: 'error.openspec_archive_failed_x', params: { p1: openspecFailure(result.data, result.raw) } });
        }
        const archive = result.data.archive;
        appendLog(ctx.root, ctx.config, {
            event,
            change: ref.id,
            ...(by ? { by } : {}),
            detail: `archived as ${archive.archivedAs}${detail ? `; ${detail}` : ''}`,
        }, ctx.stamp);
        const source = before.source;
        if (source?.type === 'backlog' && source.ref && /^B\d+$/.test(source.ref)) {
            const item = readBacklog(ctx.root).items.find(entry => entry.id === source.ref);
            if (item?.status === 'in-progress' && item.change === ref.id) {
                setBacklogStatus(ctx.root, item.id, 'done', { note: `archived as ${archive.archivedAs}` });
                appendLog(ctx.root, ctx.config, { event: 'backlog.done', change: ref.id,
                    ...(by ? { by } : {}), detail: `${item.id} archived as ${archive.archivedAs}` }, ctx.stamp);
                const deferred = item.source?.match(/^deferred (D\d+)$/)?.[1];
                if (deferred && readDeferred(ctx.root).some(entry => entry.id === deferred && entry.status === 'open')) {
                    closeDeferred(ctx.root, deferred, 'done', `implemented by ${ref.id}`);
                }
            }
            // B93: a linked GitHub issue gets a comment and is closed, through the event outbox.
            if (item?.issue) {
                queueIssueClose(ctx.root, ctx.config, {
                    change: ref.id,
                    issue: item.issue,
                    sdlc: ctx.stamp.version,
                    license: ctx.stamp.license,
                    ...(by ? { by } : {}),
                });
            }
        }
        const next = resolveNext(ctx);
        if (opts.json) {
            printJson({ archive: { change: ref.id, ...archive, forced: open.length > 0 }, root: { path: ctx.root }, harness: ctx.stamp, ...(next ? { next } : {}) });
            return;
        }
        line(c.green(t('archive.done', {
            change: ref.id, path: path.relative(ctx.root, archive.path),
        })));
        if (archive.totals) {
            const totals = archive.totals;
            line(`  ${t('archive.specs', {
                added: totals.added ?? 0, modified: totals.modified ?? 0,
                removed: totals.removed ?? 0, renamed: totals.renamed ?? 0,
            })}`);
        }
        for (const w of archive.warnings ?? [])
            warn(w);
        emitNextHint(ctx);
    }
    catch (error) {
        reportFailure(error, opts.json, { archive: null });
    }
}
/** ` [sdlc 0.1.0 · community]` for events that recorded the harness version and license. */
function stampSuffix(event) {
    if (!event.sdlc)
        return '';
    const type = event.license?.split(' ')[0];
    return c.dim(` [sdlc ${event.sdlc}${type ? ` · ${type}` : ''}]`);
}
/** One commit line under the change's trail. */
function printCommit(commit) {
    line(`  ${commit.date}  ${commit.sha.slice(0, 10)}  ${commit.author}  ${commit.subject}`);
}
/** The commits touching the change folder and the agents' share of the change's commits (B104). */
function printChangeCommits(audit, change, events) {
    if (audit.commits.length > 0) {
        line(c.bold(`  ${t('audit.commits')}`));
        for (const commit of audit.commits)
            printCommit(commit);
    }
    const share = audit.agentCommits;
    line(`  ${t('audit.changeAgentCommits', { agent: share.agent, total: share.total, change })}`);
    line(`  ${t('audit.agentEvents', { agent: events.agent, total: events.total })}`);
}
/** Lead times, verify runs, flow and participation of one change. */
function printChangeMetrics(metrics) {
    const lt = metrics.leadTimeHours;
    line(c.bold(`  ${t('audit.leadTimes')}`));
    line(`  ${t('audit.leadLine', {
        a: lt.intentToSpecApproval ?? '-', b: lt.specToPlanApproval ?? '-',
        c: lt.planToVerified ?? '-', d: lt.verifiedToReviewApproval ?? '-',
        e: lt.createdToArchived ?? '-',
    })}`);
    const first = metrics.verifyFirstPass === undefined ? ''
        : metrics.verifyFirstPass ? t('audit.firstPassed') : t('audit.firstFailed');
    line(`  ${t('audit.verifyRuns', {
        runs: metrics.verifyRuns, first, rejections: metrics.rejections, waivers: metrics.waivers,
        policy: metrics.policyWaivers,
    })}`);
    printChangeFlow(metrics);
    printChangeParticipation(metrics.participation);
}
/** `sdlc audit --change <id> [--since <date>]`: the trail of one change, active or archived. */
function auditOneChange(ctx, id, since, json) {
    const ref = resolveChange(ctx.paths, id, { allowArchived: true });
    const audit = auditChange(ctx.paths, ref, since);
    const state = audit.state;
    const metrics = changeMetrics(state, changeLog(readLog(ctx.root), ref.id), ctx.config);
    const events = agentEvents(ctx.root, since, ref.id);
    if (json) {
        printJson({
            change: ref.id, archived: ref.archived, ...(state.dropped ? { dropped: state.dropped } : {}),
            kind: state.kind, risk: state.risk, track: state.track,
            source: state.source, ...(state.harness ? { recordedWith: state.harness } : {}), ...(since ? { since } : {}),
            history: audit.history, commits: audit.commits, agentCommits: audit.agentCommits,
            agentEvents: events, metrics, harness: ctx.stamp,
        });
        return;
    }
    line(c.bold(t('audit.trail', { change: ref.id }))
        + c.dim(t('audit.meta', { kind: state.kind, risk: state.risk, track: state.track })));
    if (state.dropped)
        line(t('audit.dropped', { by: state.dropped.by, note: state.dropped.note }));
    if (since)
        line(`  ${t('audit.period', { since })}`);
    for (const h of audit.history) {
        line(`  ${h.at}  ${h.event.padEnd(26)} ${h.by ?? ''}${h.detail ? c.dim(` - ${h.detail}`) : ''}${stampSuffix(h)}`);
    }
    printChangeCommits(audit, ref.id, events);
    printChangeMetrics(metrics);
}
/** The per-change rows of the project audit and the sdlc versions and licenses their histories recorded. */
function projectRows(ctx, refs) {
    const versions = new Set();
    const licenses = new Set();
    const log = readLog(ctx.root);
    const rows = refs.map((ref) => {
        const state = readChangeState(ref.dir);
        for (const h of state.history) {
            if (h.sdlc)
                versions.add(h.sdlc);
            if (h.license)
                licenses.add(h.license);
        }
        const metrics = changeMetrics(state, changeLog(log, ref.id), ctx.config);
        return { change: ref.id, archived: ref.archived,
            ...(state.dropped ? { dropped: state.dropped } : {}), kind: state.kind, track: state.track, ...metrics };
    });
    return { rows, versions: [...versions].sort(), licenses: [...licenses].sort() };
}
/** The aggregate over the rows; `since` (B104) limits the agents' commits to the period. */
function projectAggregate(ctx, audit, since) {
    const rows = audit.rows;
    return {
        changes: rows.length,
        archived: rows.filter((r) => r.archived).length,
        ...aggregateMetrics(rows),
        /** Commits reachable from HEAD and those made in agent sessions (`SDLC-Agent:` trailer, B24). */
        agentCommits: agentCommits(ctx.root, since),
        agentEvents: agentEvents(ctx.root, since),
        /** sdlc versions and licenses recorded in the change histories. */
        recordedWith: { versions: audit.versions, licenses: audit.licenses },
    };
}
/** The text of the project audit. */
function printProjectAudit(ctx, audit, aggregate, since) {
    line(c.bold(t('audit.metrics', {
        changes: aggregate.changes, archived: aggregate.archived,
    })) + c.dim(` · ${stampTextLocalized(ctx.stamp)}`));
    if (since)
        line(`  ${t('audit.period', { since })}`);
    const m = aggregate.medianLeadTimeHours;
    line(`  ${t('audit.medianHours', {
        a: m.intentToSpecApproval ?? '-', b: m.specToPlanApproval ?? '-',
        c: m.planToVerified ?? '-', d: m.verifiedToReviewApproval ?? '-',
        e: m.createdToArchived ?? '-',
    })}`);
    line(`  ${t('audit.firstPassRate', {
        rate: aggregate.verifyFirstPassRate ?? '-',
        rejections: aggregate.rejections, waivers: aggregate.waivers, policy: aggregate.policyWaivers,
    })}`);
    const commits = aggregate.agentCommits;
    line(`  ${t('audit.agentCommits', { agent: commits.agent, total: commits.total })}`);
    line(`  ${t('audit.agentEvents', {
        agent: aggregate.agentEvents.agent, total: aggregate.agentEvents.total,
    })}`);
    printProjectFlow(aggregate);
    printProjectParticipation(audit.rows, aggregate.participation);
    for (const row of audit.rows) {
        if (row.dropped)
            line(`  ${row.change}: ${t('audit.dropped', row.dropped)}`);
    }
    if (audit.versions.length > 0) {
        line(`  ${t('audit.recordedWith', {
            versions: audit.versions.join(', '),
            licenses: audit.licenses.join('; '),
        })}`);
    }
}
/** `sdlc audit [--since <date>]`: the metrics across the changes (B104: those with history in the period). */
function auditProject(ctx, since, json) {
    const audit = projectRows(ctx, changesInPeriod(ctx.paths, since));
    const aggregate = projectAggregate(ctx, audit, since);
    if (json) {
        printJson({ ...(since ? { since } : {}), aggregate, agentEvents: aggregate.agentEvents,
            changes: audit.rows, harness: ctx.stamp });
        return;
    }
    printProjectAudit(ctx, audit, aggregate, since);
}
export async function auditCommand(opts) {
    // B21: --export writes the evidence bundle instead of the audit; --since then limits the bundle.
    if (opts.export !== undefined)
        return auditExportCommand(opts);
    try {
        const ctx = loadProject();
        // B104: without --export, --since is the audit for the period.
        const since = parseSince(opts.since);
        if (opts.change) {
            auditOneChange(ctx, opts.change, since, opts.json);
            return;
        }
        auditProject(ctx, since, opts.json);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
function parseLogLimit(value) {
    const limit = value === undefined ? 50 : Number(value);
    if (!Number.isInteger(limit) || limit <= 0)
        throw new SdlcError('invalid_option', { key: 'error.limit_must_be_a_positive_whole_number' });
    return limit;
}
/** Prints the project log (`openspec/.sdlc/log.jsonl`), newest last; B106: `--event` and `--since` filter it. */
export async function logCommand(opts) {
    try {
        const ctx = loadProject();
        const limit = parseLogLimit(opts.limit);
        const since = parseSince(opts.since);
        const entries = filterLog(readLog(ctx.root), { change: opts.change, event: opts.event, since });
        const shown = entries.slice(-limit);
        if (opts.json)
            return printJson({ entries: shown, total: entries.length, harness: ctx.stamp });
        if (entries.length === 0) {
            line(ctx.config.log.enabled ? t('log.empty') : t('log.off'));
            return;
        }
        if (shown.length < entries.length) {
            line(c.dim(t('log.truncated', { shown: shown.length, total: entries.length })));
        }
        for (const e of shown) {
            const who = `${e.by ?? ''}${e.agent ? ` (agent ${e.agent})` : ''}`;
            line(`${e.ts}  ${e.event.padEnd(26)} ${e.change ? `${e.change} ` : ''}${who}${e.detail ? c.dim(` - ${e.detail}`) : ''}` +
                c.dim(` [sdlc ${e.sdlc ?? '?'} · ${(e.license ?? '?').split(' ')[0]}]`));
        }
    }
    catch (error) {
        reportFailure(error, opts.json, { entries: [] });
    }
}
