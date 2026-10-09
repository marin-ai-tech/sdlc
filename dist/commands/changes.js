import * as path from 'node:path';
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { c, gateBadge, line, printJson, reportFailure, warn } from '../cli/output.js';
import { bar, stepper } from '../cli/progress.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { t } from '../core/i18n.js';
import { CHANGE_KINDS, newChangeState, readChangeState, RISK_LEVELS, SOURCE_TYPES, TRACKS, } from '../core/change-state.js';
import { assertValidChangeId, listActiveChanges, listArchivedChanges, resolveChange, } from '../core/changes.js';
import { artifactStage, contextPackJson, contextPackLines, readContextPack, } from '../core/context-packs.js';
import { changedBases, findOverlaps, readChangeDeltas } from '../core/deltas.js';
import { SdlcError } from '../core/errors.js';
import { isFile, isWithin } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { evaluateChange, sharedFingerprint } from '../core/lifecycle.js';
import { recordAwaiting } from '../core/awaiting.js';
import { openspecFailure, runOpenSpec, runOpenSpecJson } from '../core/openspec.js';
import { loadSchemaInfo } from '../core/openspec-schema.js';
import { PROJECT_URL } from '../core/license.js';
import { readYamlObject, writeYaml } from '../core/yaml-io.js';
import { readAsset } from '../integrations/assets.js';
import { agentEnvironment } from '../core/agent-env.js';
import { suggestTrack } from '../core/track.js';
import { nextBacklogItem, readBacklog } from '../core/backlog.js';
function oneOf(value, allowed, flag) {
    if (value === undefined)
        return undefined;
    if (!allowed.includes(value)) {
        throw new SdlcError('invalid_option', { key: 'error.x_must_be_one_of_x_got_x', params: { flag: flag, p2: allowed.join(', '), value: value } });
    }
    return value;
}
function validateExplorationSource(root, type, ref) {
    if (type !== 'exploration')
        return;
    const directory = path.join(root, 'openspec', 'explorations');
    const target = ref ? path.resolve(root, ref) : '';
    if (!ref || !isWithin(directory, target) || !isFile(target)) {
        throw new SdlcError('unknown_exploration', { key: 'error.exploration_source_must_reference_an_existing_fi' });
    }
}
export function createChange(name, opts) {
    assertValidChangeId(name);
    const ctx = loadProject();
    const { root, config } = ctx;
    const kind = oneOf(opts.kind, CHANGE_KINDS, '--kind') ?? 'feature';
    const risk = oneOf(opts.risk, RISK_LEVELS, '--risk') ?? 'medium';
    const suggested = suggestTrack(kind, risk);
    const requestedTrack = oneOf(opts.track, TRACKS, '--track');
    const agentRequestedLite = requestedTrack === 'lite' && !!agentEnvironment();
    const track = requestedTrack === 'lite' && !agentRequestedLite ? 'lite' : 'full';
    const sourceType = oneOf(opts.sourceType, SOURCE_TYPES, '--source-type');
    const schema = opts.schema ?? config.schema;
    loadSchemaInfo(schema, root);
    validateExplorationSource(root, sourceType, opts.sourceRef);
    const args = ['new', 'change', name, '--schema', schema];
    if (opts.description)
        args.push('--description', opts.description);
    const result = runOpenSpecJson(args, root);
    if (!result.ok || !result.data?.change)
        throw new SdlcError('openspec_new_failed', { key: 'error.openspec_new_change_failed_x', params: { p1: openspecFailure(result.data, result.raw) } });
    const dir = result.data.change.path;
    if (opts.skipSpecs) {
        const metaFile = path.join(dir, '.openspec.yaml');
        const meta = readYamlObject(metaFile) ?? { schema };
        meta.skip_specs = true;
        writeYaml(metaFile, meta);
    }
    const source = sourceType || opts.sourceRef || opts.sourceUrl
        ? { type: sourceType ?? 'other', ...(opts.sourceRef ? { ref: opts.sourceRef } : {}),
            ...(opts.sourceUrl ? { url: opts.sourceUrl } : {}) } : undefined;
    const state = newChangeState({ kind, risk, track, ...(source ? { source } : {}) });
    const suggestion = agentRequestedLite
        ? { track: 'lite', reasons: ['An agent requested the lite track.', ...suggested.reasons] }
        : !requestedTrack && suggested.track === 'lite' ? suggested : undefined;
    if (suggestion)
        state.track_suggestion = suggestion;
    // B59: an agent picks the kind freely, so an auto_waive policy by kind does not apply to its choice.
    if (opts.kind && agentEnvironment())
        state.kind_by_agent = true;
    recordChangeEvent(ctx, { id: name, dir }, state, 'change.created', formatIdentity(gitIdentity(root)), `schema ${schema}, ${track} track`);
    return { ctx, dir };
}
export async function newCommand(name, opts) {
    try {
        const { ctx, dir: changeDir } = createChange(name, opts);
        const { root, paths, config } = ctx;
        const kind = oneOf(opts.kind, CHANGE_KINDS, '--kind') ?? 'feature';
        const risk = oneOf(opts.risk, RISK_LEVELS, '--risk') ?? 'medium';
        const requestedTrack = oneOf(opts.track, TRACKS, '--track');
        const suggested = suggestTrack(kind, risk);
        const agentRequestedLite = requestedTrack === 'lite' && !!agentEnvironment();
        const track = requestedTrack === 'lite' && !agentRequestedLite ? 'lite' : 'full';
        const trackSuggestion = agentRequestedLite
            ? { track: 'lite', reasons: ['An agent requested the lite track.', ...suggested.reasons] }
            : !requestedTrack && suggested.track === 'lite' ? suggested : undefined;
        const sourceType = oneOf(opts.sourceType, SOURCE_TYPES, '--source-type');
        validateExplorationSource(root, sourceType, opts.sourceRef);
        const schema = opts.schema ?? config.schema;
        loadSchemaInfo(schema, root); // fail early with a clear message
        const state = readChangeState(changeDir);
        const next = resolveNext(ctx, name);
        if (opts.json) {
            printJson({ change: { id: name, path: changeDir, schema, kind, risk, track, ...(trackSuggestion ? { trackSuggestion } : {}), ...(state.source ? { source: state.source } : {}) }, ...(next ? { next } : {}), root: { path: paths.root } });
            return;
        }
        line(c.bold(t('change.created', { name })) + c.dim(t('change.createdMeta', { schema, kind, risk, track })));
        if (agentRequestedLite)
            warn(t('warn.agentCannotLite', { cmd: `${config.cli} track set lite --change ${name}` }));
        line(`  ${path.relative(process.cwd(), changeDir) || changeDir}`);
        emitNextHint(ctx, name);
    }
    catch (error) {
        reportFailure(error, opts.json, { change: null });
    }
}
function overlapsFor(ctx) {
    const changes = listActiveChanges(ctx.paths).map((ref) => ({ id: ref.id, deltas: readChangeDeltas(ref.dir) }));
    return findOverlaps(changes);
}
/** Extra, cross-cutting warnings for one change (base drift, overlaps). */
function changeWarnings(ctx, view, overlaps) {
    const warnings = [...view.warnings];
    const state = readChangeState(view.dir);
    const base = state.gates.spec?.approvals?.at(-1)?.base;
    for (const cap of changedBases(ctx.paths, base)) {
        warnings.push(`openspec/specs/${cap}/spec.md changed after the spec gate was approved (another change archived?); re-check this change's MODIFIED/REMOVED requirements.`);
    }
    for (const o of overlaps.filter((x) => x.changes.some((ch) => ch.change === view.change))) {
        const others = o.changes.filter((ch) => ch.change !== view.change).map((ch) => `${ch.change} (${ch.op})`);
        warnings.push(`requirement "${o.requirement}" in ${o.capability} is also changed by ${others.join(', ')}; whichever archives second must reconcile.`);
    }
    return warnings;
}
function actorLabel(view) {
    if (view.next.actor === 'human')
        return c.yellow(t('actor.person'));
    if (view.next.actor === 'agent')
        return c.cyan(t('actor.agent'));
    return c.dim(t('actor.none'));
}
function nextText(view) {
    if (view.next.key)
        return t(view.next.key, view.next.params);
    return view.next.message;
}
function stageTitleText(view) {
    return t(`stage.${view.stage}`);
}
function printDetailed(view, warnings, invocationHint) {
    const header = t('status.header', { kind: view.kind, risk: view.risk, track: view.track, schema: view.schema });
    line(`${c.bold(view.change)}  ${c.dim(`[${header}]`)}`);
    line(`  ${t('status.stage').padEnd(10)}${c.bold(stageTitleText(view))}`);
    if (view.source) {
        line(`  ${t('status.source').padEnd(10)}${view.source.type}${view.source.ref ? ` ${view.source.ref}` : ''}${view.source.url ? ` ${view.source.url}` : ''}`);
    }
    const arts = view.artifacts.map((a) => `${a.id} ${a.status === 'done' ? c.green('✓') : a.status === 'skipped' ? c.dim('~') : a.status === 'ready' ? c.yellow('○') : c.dim('·')}`).join('  ');
    line(`  ${t('status.artifacts').padEnd(10)}${arts}`);
    line(`  ${stepper(view)}`);
    const taskBar = view.tasks.total === 0
        ? c.dim(t('status.noneYet'))
        : `${bar(view.tasks.complete, view.tasks.total)}  ${view.tasks.complete}/${view.tasks.total}`;
    line(`  ${t('status.tasks').padEnd(10)}${taskBar}`);
    line(`  ${t('status.gates')}`);
    for (const g of view.gates) {
        const who = g.approvals.map((a) => `${a.by} as ${a.role}`).join('; ');
        const reasonText = g.reasonKey ? t(g.reasonKey, g.reasonParams) : g.reason ?? '';
        const detail = g.status === 'approved' && who ? who : reasonText;
        const optional = g.required ? '' : c.dim(t('status.optional'));
        line(`    ${g.id.padEnd(8)} ${gateBadge(g.status).padEnd(20)} ${optional}${c.dim(detail)}`);
    }
    if (view.review) {
        const imp = view.review.bySeverity.important;
        const findings = t('status.findings', { total: view.review.total });
        const important = imp ? t('status.importantOpen', { open: imp.open, total: imp.total }) : '';
        line(`  ${t('status.review').padEnd(10)}${findings}${important}`);
    }
    line(`  ${t('status.next').padEnd(10)}${actorLabel(view)}: ${nextText(view)}`);
    if (view.next.cli)
        line(`             ${c.cyan(`$ ${view.next.cli}`)}`);
    else if (view.next.workflow && view.next.actor === 'agent')
        line(`             ${c.cyan(invocationHint(view.next.workflow))}`);
    for (const w of warnings)
        warn(`${view.change}: ${w}`);
}
function markdownReport(view, warnings) {
    const rows = view.gates.map((g) => {
        const who = g.approvals.map((a) => `${a.by} (${a.role}, ${a.at.slice(0, 10)})`).join('<br>');
        const reasonText = g.reasonKey ? t(g.reasonKey, g.reasonParams) : g.reason ?? '';
        return `| ${g.id} | ${g.status}${g.required ? '' : ' (optional)'} | ${who || reasonText} |`;
    });
    const lines = [
        `### SDLC: \`${view.change}\``,
        '',
        `**Stage:** ${view.stageTitle} · **Kind:** ${view.kind} · **Risk:** ${view.risk} · **Track:** ${view.track}${view.source?.ref ? ` · **Source:** ${view.source.type} ${view.source.ref}` : ''}`,
        '',
        '| Gate | Status | Approved by / reason |',
        '|---|---|---|',
        ...rows,
        '',
        `**Tasks:** ${view.tasks.complete}/${view.tasks.total} · **Verification:** ${view.verification?.status ?? 'never'}${view.verification?.at ? ` (${view.verification.at})` : ''}` +
            (view.review ? ` · **Review findings:** ${view.review.total} (${view.review.blocking.length} blocking open)` : ''),
        '',
        `**Next:** ${view.next.message}${view.next.cli ? ` \`${view.next.cli}\`` : ''}`,
    ];
    if (warnings.length > 0)
        lines.push('', ...warnings.map((w) => `> ⚠️ ${w}`));
    return lines.join('\n');
}
/** Markdown reports (pasted into pull requests and wikis) record the sdlc version and license that produced them. */
function reportFooter(ctx) {
    return `<sub>Generated by [sdlc](${PROJECT_URL}) ${ctx.stamp.version} · license: ${ctx.stamp.license}</sub>`;
}
export async function statusCommand(opts) {
    try {
        const ctx = loadProject();
        const overlaps = overlapsFor(ctx);
        const invocation = (wf) => ctx.config.tools.includes('claude') ? `/sdlc:${wf}` : `/sdlc-${wf}`;
        if (opts.change) {
            const ref = resolveChange(ctx.paths, opts.change, { allowArchived: true });
            const view = evaluateChange(ctx.root, ref, ctx.config);
            recordAwaiting(ctx.root, ctx.config, view, ctx.stamp);
            const warnings = changeWarnings(ctx, view, overlaps);
            if (opts.json)
                return printJson({ change: { ...view, warnings }, root: { path: ctx.root }, harness: ctx.stamp });
            if (opts.markdown)
                return line(`${markdownReport(view, warnings)}\n\n${reportFooter(ctx)}`);
            return printDetailed(view, warnings, invocation);
        }
        const refs = [...listActiveChanges(ctx.paths), ...(opts.archived ? listArchivedChanges(ctx.paths) : [])];
        const fingerprint = sharedFingerprint(ctx.root);
        const views = refs.map((ref) => {
            try {
                const view = evaluateChange(ctx.root, ref, ctx.config, { fingerprint });
                return { ...view, warnings: changeWarnings(ctx, view, overlaps) };
            }
            catch (error) {
                return { change: ref.id, error: error instanceof Error ? error.message : String(error) };
            }
        });
        recordAwaiting(ctx.root, ctx.config, views.filter((v) => !('error' in v)), ctx.stamp);
        if (opts.json)
            return printJson({ changes: views, overlaps, root: { path: ctx.root }, harness: ctx.stamp });
        if (opts.markdown) {
            const reports = views.map((v) => ('error' in v ? `### ${v.change}\n\n${v.error}` : markdownReport(v, v.warnings)));
            return line(`${reports.join('\n\n---\n\n')}\n\n${reportFooter(ctx)}`);
        }
        if (views.length === 0) {
            line(t('status.noChanges'));
            return;
        }
        const width = Math.max(8, ...views.map((v) => v.change.length));
        line(c.bold(`${t('status.colChange').padEnd(width)}  ${t('status.colStage').padEnd(9)} ${t('status.colNext')}`));
        for (const v of views) {
            if ('error' in v) {
                line(`${v.change.padEnd(width)}  ${c.red(t('status.error').padEnd(9))} ${v.error}`);
                continue;
            }
            const next = v.next.actor === 'human' && v.next.cli
                ? `${actorLabel(v)}: ${v.next.cli}`
                : `${actorLabel(v)}: ${v.next.workflow ? `${invocation(v.next.workflow)} - ` : ''}${nextText(v)}`;
            line(`${v.change.padEnd(width)}  ${v.stage.padEnd(9)} ${next}`);
        }
        for (const o of overlaps) {
            warn(t('warn.requirementChanged', { requirement: o.requirement, capability: o.capability, changes: o.changes.map((x) => `${x.change}:${x.op}`).join(', ') }));
        }
    }
    catch (error) {
        reportFailure(error, opts.json, { changes: [] });
    }
}
export async function nextCommand(opts) {
    try {
        const ctx = loadProject();
        if (!opts.change && listActiveChanges(ctx.paths).length === 0) {
            const item = nextBacklogItem(readBacklog(ctx.root));
            if (item) {
                const next = { actor: 'agent', action: 'start-backlog-item', item: item.id,
                    message: `Start backlog item ${item.id}: ${item.title}.`, cli: `${ctx.config.cli} backlog start ${item.id}` };
                if (opts.json)
                    printJson({ change: null, stage: null, next, root: { path: ctx.root } });
                else
                    line(`${item.id}: ${next.message}\n$ ${next.cli}`);
                return;
            }
        }
        const ref = resolveChange(ctx.paths, opts.change);
        const view = evaluateChange(ctx.root, ref, ctx.config);
        recordAwaiting(ctx.root, ctx.config, view, ctx.stamp);
        if (opts.json) {
            printJson({ change: view.change, stage: view.stage, stageTitle: view.stageTitle, track: view.track, next: view.next, root: { path: ctx.root } });
            return;
        }
        line(`${c.bold(view.change)}: ${view.stageTitle}`);
        line(`${actorLabel(view)}: ${nextText(view)}`);
        if (view.next.cli)
            line(c.cyan(`$ ${view.next.cli}`));
    }
    catch (error) {
        reportFailure(error, opts.json, { next: null });
    }
}
const RECORD_INSTRUCTIONS = {
    verification: 'Record how the change was verified. `sdlc verify` writes the automated evidence between the sdlc:evidence markers - never edit that block. ' +
        'Fill "Behavioral verification" from the independent verifier (sdlc-verifier subagent): one row per spec scenario and plan Proof item with what was run, what was seen, and PASS/FAIL/NOT RUN. ' +
        'Run `sdlc verify --check` to find scenarios with no row.',
    review: 'Record the review. Take base ref, changed files, policy and plan drift from `sdlc review context --json`. Each finding is a `### F<n> [important|nit|pre-existing][bugs|security|compliance] <title>` heading ' +
        'with Where, Detail, Fix and Status (open | fixed (<note>) | accepted (<reason>) | wontfix (<reason>)). Important = breaks behavior, leaks data or breaches a policy. ' +
        'Explain every plan-drift file under "Plan drift". `sdlc review check` must report zero open blocking findings before a code owner approves.',
    release: 'Prepare the release record: version and changelog (from proposal.md and the spec deltas), rollout per environment with who may run each step, monitoring signals and the control band that triggers rollback, ' +
        'and the exact, rehearsed rollback command. Production steps run only after `sdlc approve release` by a release manager.',
};
function projectContextText(ctx) {
    try {
        const cfg = readYamlObject(ctx.paths.openspecConfig);
        return typeof cfg?.context === 'string' && cfg.context.trim() ? cfg.context : undefined;
    }
    catch {
        return undefined;
    }
}
function printContextPack(pack) {
    const lines = contextPackLines(pack);
    if (lines.length > 0)
        line(`\n${lines.join('\n')}`);
}
function recordInstructions(ctx, ref, artifact, json) {
    const outputPath = path.join(ref.dir, `${artifact}.md`);
    const template = readAsset('records', `${artifact}.md`).replace(/<change>/g, ref.id);
    const context = projectContextText(ctx);
    const pack = readContextPack(ctx.root, artifactStage(artifact, []));
    const payload = {
        changeName: ref.id,
        artifactId: artifact,
        changeDir: ref.dir,
        outputPath: `${artifact}.md`,
        resolvedOutputPath: outputPath,
        exists: isFile(outputPath),
        instruction: RECORD_INSTRUCTIONS[artifact],
        ...(context ? { context } : {}),
        template,
        source: 'sdlc',
        root: { path: ctx.root },
        ...contextPackJson(pack),
    };
    if (json)
        return printJson(payload);
    line(`<artifact id="${artifact}" change="${ref.id}" source="sdlc">`);
    line(`Write to: ${outputPath}${payload.exists ? ' (exists - update it)' : ''}`);
    line();
    line(RECORD_INSTRUCTIONS[artifact]);
    if (context)
        line(`\n<context>\n${context}\n</context>`);
    printContextPack(pack);
    line(`\n<template>\n${template}</template>\n</artifact>`);
}
export async function instructionsCommand(artifact, opts) {
    try {
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, opts.change);
        if (artifact in RECORD_INSTRUCTIONS)
            return recordInstructions(ctx, ref, artifact, opts.json);
        // Planning artifacts and `apply` are OpenSpec's: delegate, then add the lifecycle view.
        if (!opts.json) {
            const r = runOpenSpec(['instructions', artifact, '--change', ref.id], { cwd: ctx.root, inherit: true });
            const view = evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true });
            printContextPack(readContextPack(ctx.root, artifactStage(artifact, view.gates)));
            line(c.dim(`\n[sdlc] stage: ${view.stageTitle}; next: ${view.next.message}`));
            if (!r.ok)
                process.exitCode = r.exitCode ?? 1;
            return;
        }
        const result = runOpenSpecJson(['instructions', artifact, '--change', ref.id], ctx.root);
        if (!result.data)
            throw new SdlcError('openspec_instructions_failed', { key: 'error.openspec_failure_detail', params: { detail: openspecFailure(result.data, result.raw) } });
        const view = evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true });
        const gate = view.gates.find((g) => g.artifacts.includes(artifact));
        const pack = readContextPack(ctx.root, artifactStage(artifact, view.gates));
        printJson({
            ...result.data,
            sdlc: {
                stage: view.stage,
                kind: view.kind,
                risk: view.risk,
                track: view.track,
                ...(gate ? { gate: gate.id, gateStatus: gate.status } : {}),
                note: gate && (gate.status === 'approved' || gate.status === 'waived')
                    ? `The ${gate.id} gate is ${gate.status}: editing ${artifact} invalidates that approval and needs re-approval.`
                    : undefined,
            },
            ...contextPackJson(pack),
        });
        if (!result.ok)
            process.exitCode = 1;
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
