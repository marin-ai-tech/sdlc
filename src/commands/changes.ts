import * as path from 'node:path';
import { loadProject, recordChangeEvent, type ProjectContext } from '../cli/context.js';
import { c, gateBadge, line, printJson, reportFailure, warn } from '../cli/output.js';
import {
  CHANGE_KINDS,
  newChangeState,
  readChangeState,
  RISK_LEVELS,
  SOURCE_TYPES,
  TRACKS,
  type ChangeKind,
  type RiskLevel,
  type SourceType,
  type Track,
} from '../core/change-state.js';
import { assertValidChangeId, listActiveChanges, listArchivedChanges, resolveChange } from '../core/changes.js';
import { changedBases, findOverlaps, readChangeDeltas, type Overlap } from '../core/deltas.js';
import { SdlcError } from '../core/errors.js';
import { isFile, isWithin } from '../core/fs-utils.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { evaluateChange, sharedFingerprint, type LifecycleView } from '../core/lifecycle.js';
import { openspecFailure, runOpenSpec, runOpenSpecJson } from '../core/openspec.js';
import { loadSchemaInfo } from '../core/openspec-schema.js';
import { PROJECT_URL } from '../core/license.js';
import { readYamlObject, writeYaml } from '../core/yaml-io.js';
import { readAsset } from '../integrations/assets.js';
import { agentEnvironment } from '../core/agent-env.js';
import { suggestTrack } from '../core/track.js';

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new SdlcError('invalid_option', `${flag} must be one of: ${allowed.join(', ')} (got ${value}).`);
  }
  return value as T;
}

function validateExplorationSource(root: string, type: SourceType | undefined, ref: string | undefined): void {
  if (type !== 'exploration') return;
  const directory = path.join(root, 'openspec', 'explorations');
  const target = ref ? path.resolve(root, ref) : '';
  if (!ref || !isWithin(directory, target) || !isFile(target)) {
    throw new SdlcError('unknown_exploration', 'Exploration source must reference an existing file in openspec/explorations/.');
  }
}

export interface NewOptions {
  kind?: string;
  risk?: string;
  track?: string;
  sourceType?: string;
  sourceRef?: string;
  sourceUrl?: string;
  skipSpecs?: boolean;
  schema?: string;
  description?: string;
  json?: boolean;
}

export function createChange(name: string, opts: NewOptions): { ctx: ProjectContext; dir: string } {
  assertValidChangeId(name);
  const ctx = loadProject();
  const { root, config } = ctx;
  const kind = oneOf<ChangeKind>(opts.kind, CHANGE_KINDS, '--kind') ?? 'feature';
  const risk = oneOf<RiskLevel>(opts.risk, RISK_LEVELS, '--risk') ?? 'medium';
  const suggested = suggestTrack(kind, risk);
  const sourceType = oneOf<SourceType>(opts.sourceType, SOURCE_TYPES, '--source-type');
  const schema = opts.schema ?? config.schema;
  loadSchemaInfo(schema, root);
  const result = runOpenSpecJson<{ change?: { id: string; path: string } }>(['new', 'change', name, '--schema', schema], root);
  if (!result.ok || !result.data?.change) throw new SdlcError('openspec_new_failed', `openspec new change failed: ${openspecFailure(result.data, result.raw)}`);
  const dir = result.data.change.path;
  const state = newChangeState({ kind, risk, track: 'full', ...(sourceType ? { source: { type: sourceType, ...(opts.sourceRef ? { ref: opts.sourceRef } : {}) } } : {}) });
  if (suggested.track === 'lite') state.track_suggestion = suggested;
  recordChangeEvent(ctx, { id: name, dir }, state, 'change.created', formatIdentity(gitIdentity(root)), `schema ${schema}, full track`);
  return { ctx, dir };
}

export async function newCommand(name: string, opts: NewOptions): Promise<void> {
  try {
    assertValidChangeId(name);
    const ctx = loadProject();
    const { root, paths, config } = ctx;
    const kind = oneOf<ChangeKind>(opts.kind, CHANGE_KINDS, '--kind') ?? 'feature';
    const risk = oneOf<RiskLevel>(opts.risk, RISK_LEVELS, '--risk') ?? 'medium';
    const requestedTrack = oneOf<Track>(opts.track, TRACKS, '--track');
    const suggested = suggestTrack(kind, risk);
    const agentRequestedLite = requestedTrack === 'lite' && !!agentEnvironment();
    const track = requestedTrack === 'lite' && !agentRequestedLite ? 'lite' : 'full';
    const trackSuggestion = agentRequestedLite
      ? { track: 'lite' as const, reasons: ['An agent requested the lite track.', ...suggested.reasons] }
      : !requestedTrack && suggested.track === 'lite' ? suggested : undefined;
    const sourceType = oneOf<SourceType>(opts.sourceType, SOURCE_TYPES, '--source-type');
    validateExplorationSource(root, sourceType, opts.sourceRef);
    const schema = opts.schema ?? config.schema;
    loadSchemaInfo(schema, root); // fail early with a clear message

    const args = ['new', 'change', name, '--schema', schema];
    if (opts.description) args.push('--description', opts.description);
    const result = runOpenSpecJson<{ change?: { id: string; path: string } }>(args, root);
    if (!result.ok || !result.data?.change) {
      throw new SdlcError('openspec_new_failed', `openspec new change failed: ${openspecFailure(result.data, result.raw)}`);
    }
    const changeDir = result.data.change.path;

    if (opts.skipSpecs) {
      const metaFile = path.join(changeDir, '.openspec.yaml');
      const meta = readYamlObject(metaFile) ?? { schema };
      meta.skip_specs = true;
      writeYaml(metaFile, meta);
    }
    const state = newChangeState({
      kind,
      risk,
      track,
      ...(sourceType || opts.sourceRef || opts.sourceUrl
        ? { source: { type: sourceType ?? 'other', ...(opts.sourceRef ? { ref: opts.sourceRef } : {}), ...(opts.sourceUrl ? { url: opts.sourceUrl } : {}) } }
        : {}),
    });
    if (trackSuggestion) state.track_suggestion = trackSuggestion;
    recordChangeEvent(ctx, { id: name, dir: changeDir }, state, 'change.created', formatIdentity(gitIdentity(root)),
      `schema ${schema}, ${track} track`);

    const view = evaluateChange(root, { id: name, dir: changeDir, archived: false }, config, { skipFingerprint: true });
    if (opts.json) {
      printJson({ change: { id: name, path: changeDir, schema, kind, risk, track, ...(trackSuggestion ? { trackSuggestion } : {}), ...(state.source ? { source: state.source } : {}) }, next: view.next, root: { path: paths.root } });
      return;
    }
    line(c.bold(`Created change ${name}`) + c.dim(` (${schema} schema, ${kind}, risk ${risk}, ${track} track)`));
    if (agentRequestedLite) warn(`An agent cannot select lite; ask a person to run ${config.cli} track set lite --change ${name}.`);
    line(`  ${path.relative(process.cwd(), changeDir) || changeDir}`);
    line(`  next: ${view.next.message}`);
    if (view.next.cli) line(`        ${c.cyan(view.next.cli)}`);
  } catch (error) {
    reportFailure(error, opts.json, { change: null });
  }
}

function overlapsFor(ctx: ProjectContext): Overlap[] {
  const changes = listActiveChanges(ctx.paths).map((ref) => ({ id: ref.id, deltas: readChangeDeltas(ref.dir) }));
  return findOverlaps(changes);
}

/** Extra, cross-cutting warnings for one change (base drift, overlaps). */
function changeWarnings(ctx: ProjectContext, view: LifecycleView, overlaps: Overlap[]): string[] {
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

function actorLabel(view: LifecycleView): string {
  if (view.next.actor === 'human') return c.yellow('person');
  if (view.next.actor === 'agent') return c.cyan('agent');
  return c.dim('none');
}

function printDetailed(view: LifecycleView, warnings: string[], invocationHint: (wf: string) => string): void {
  line(`${c.bold(view.change)}  ${c.dim(`[${view.kind} · risk ${view.risk} · ${view.track} track · schema ${view.schema}]`)}`);
  line(`  stage      ${c.bold(view.stageTitle)}`);
  if (view.source) line(`  source     ${view.source.type}${view.source.ref ? ` ${view.source.ref}` : ''}${view.source.url ? ` ${view.source.url}` : ''}`);
  line(`  artifacts  ${view.artifacts.map((a) => `${a.id} ${a.status === 'done' ? c.green('✓') : a.status === 'skipped' ? c.dim('~') : a.status === 'ready' ? c.yellow('○') : c.dim('·')}`).join('  ')}`);
  line(`  tasks      ${view.tasks.total === 0 ? c.dim('none yet') : `${view.tasks.complete}/${view.tasks.total}`}`);
  line('  gates');
  for (const g of view.gates) {
    const who = g.approvals.map((a) => `${a.by} as ${a.role}`).join('; ');
    const detail = g.status === 'approved' && who ? who : g.reason ?? '';
    line(`    ${g.id.padEnd(8)} ${gateBadge(g.status).padEnd(20)} ${g.required ? '' : c.dim('(optional) ')}${c.dim(detail)}`);
  }
  if (view.review) {
    const imp = view.review.bySeverity.important;
    line(`  review     ${view.review.total} finding(s)${imp ? `, important ${imp.open} open / ${imp.total}` : ''}`);
  }
  line(`  next       ${actorLabel(view)}: ${view.next.message}`);
  if (view.next.cli) line(`             ${c.cyan(`$ ${view.next.cli}`)}`);
  else if (view.next.workflow && view.next.actor === 'agent') line(`             ${c.cyan(invocationHint(view.next.workflow))}`);
  for (const w of warnings) warn(`${view.change}: ${w}`);
}

function markdownReport(view: LifecycleView, warnings: string[]): string {
  const rows = view.gates.map((g) => {
    const who = g.approvals.map((a) => `${a.by} (${a.role}, ${a.at.slice(0, 10)})`).join('<br>');
    return `| ${g.id} | ${g.status}${g.required ? '' : ' (optional)'} | ${who || (g.reason ?? '')} |`;
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
  if (warnings.length > 0) lines.push('', ...warnings.map((w) => `> ⚠️ ${w}`));
  return lines.join('\n');
}

/** Markdown reports (pasted into pull requests and wikis) record the scdl version and license that produced them. */
function reportFooter(ctx: ProjectContext): string {
  return `<sub>Generated by [scdl](${PROJECT_URL}) ${ctx.stamp.version} · license: ${ctx.stamp.license}</sub>`;
}

export interface StatusOptions {
  change?: string;
  archived?: boolean;
  json?: boolean;
  markdown?: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const overlaps = overlapsFor(ctx);
    const invocation = (wf: string) =>
      ctx.config.tools.includes('claude') ? `/sdlc:${wf}` : `/sdlc-${wf}`;
    if (opts.change) {
      const ref = resolveChange(ctx.paths, opts.change, { allowArchived: true });
      const view = evaluateChange(ctx.root, ref, ctx.config);
      const warnings = changeWarnings(ctx, view, overlaps);
      if (opts.json) return printJson({ change: { ...view, warnings }, root: { path: ctx.root }, harness: ctx.stamp });
      if (opts.markdown) return line(`${markdownReport(view, warnings)}\n\n${reportFooter(ctx)}`);
      return printDetailed(view, warnings, invocation);
    }
    const refs = [...listActiveChanges(ctx.paths), ...(opts.archived ? listArchivedChanges(ctx.paths) : [])];
    const fingerprint = sharedFingerprint(ctx.root);
    const views = refs.map((ref) => {
      try {
        const view = evaluateChange(ctx.root, ref, ctx.config, { fingerprint });
        return { ...view, warnings: changeWarnings(ctx, view, overlaps) };
      } catch (error) {
        return { change: ref.id, error: error instanceof Error ? error.message : String(error) } as unknown as LifecycleView & { error: string };
      }
    });
    if (opts.json) return printJson({ changes: views, overlaps, root: { path: ctx.root }, harness: ctx.stamp });
    if (opts.markdown) {
      const reports = views.map((v) => ('error' in v ? `### ${v.change}\n\n${(v as { error: string }).error}` : markdownReport(v, v.warnings)));
      return line(`${reports.join('\n\n---\n\n')}\n\n${reportFooter(ctx)}`);
    }
    if (views.length === 0) {
      line('No active changes. Start one with /sdlc:intent (Claude Code), /sdlc-intent (OpenCode), or `sdlc new <name>`.');
      return;
    }
    const width = Math.max(8, ...views.map((v) => v.change.length));
    line(c.bold(`${'CHANGE'.padEnd(width)}  ${'STAGE'.padEnd(9)} NEXT`));
    for (const v of views) {
      if ('error' in v) {
        line(`${v.change.padEnd(width)}  ${c.red('error'.padEnd(9))} ${(v as { error: string }).error}`);
        continue;
      }
      const next = v.next.actor === 'human' && v.next.cli
        ? `${actorLabel(v)}: ${v.next.cli}`
        : `${actorLabel(v)}: ${v.next.workflow ? `${invocation(v.next.workflow)} - ` : ''}${v.next.message}`;
      line(`${v.change.padEnd(width)}  ${v.stage.padEnd(9)} ${next}`);
    }
    for (const o of overlaps) {
      warn(`requirement "${o.requirement}" (${o.capability}) is changed by ${o.changes.map((x) => `${x.change}:${x.op}`).join(', ')}`);
    }
  } catch (error) {
    reportFailure(error, opts.json, { changes: [] });
  }
}

export async function nextCommand(opts: { change?: string; json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    const view = evaluateChange(ctx.root, ref, ctx.config);
    if (opts.json) {
      printJson({ change: view.change, stage: view.stage, stageTitle: view.stageTitle, track: view.track, next: view.next, root: { path: ctx.root } });
      return;
    }
    line(`${c.bold(view.change)}: ${view.stageTitle}`);
    line(`${actorLabel(view)}: ${view.next.message}`);
    if (view.next.cli) line(c.cyan(`$ ${view.next.cli}`));
  } catch (error) {
    reportFailure(error, opts.json, { next: null });
  }
}

const RECORD_INSTRUCTIONS: Record<string, string> = {
  verification:
    'Record how the change was verified. `sdlc verify` writes the automated evidence between the sdlc:evidence markers - never edit that block. ' +
    'Fill "Behavioral verification" from the independent verifier (sdlc-verifier subagent): one row per spec scenario and plan Proof item with what was run, what was seen, and PASS/FAIL/NOT RUN. ' +
    'Run `sdlc verify --check` to find scenarios with no row.',
  review:
    'Record the review. Take base ref, changed files, policy and plan drift from `sdlc review context --json`. Each finding is a `### F<n> [important|nit|pre-existing][bugs|security|compliance] <title>` heading ' +
    'with Where, Detail, Fix and Status (open | fixed (<note>) | accepted (<reason>) | wontfix (<reason>)). Important = breaks behavior, leaks data or breaches a policy. ' +
    'Explain every plan-drift file under "Plan drift". `sdlc review check` must report zero open blocking findings before a code owner approves.',
  release:
    'Prepare the release record: version and changelog (from proposal.md and the spec deltas), rollout per environment with who may run each step, monitoring signals and the control band that triggers rollback, ' +
    'and the exact, rehearsed rollback command. Production steps run only after `sdlc approve release` by a release manager.',
};

function projectContextText(ctx: ProjectContext): string | undefined {
  try {
    const cfg = readYamlObject(ctx.paths.openspecConfig);
    return typeof cfg?.context === 'string' && cfg.context.trim() ? cfg.context : undefined;
  } catch {
    return undefined;
  }
}

export async function instructionsCommand(artifact: string, opts: { change?: string; json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    if (artifact in RECORD_INSTRUCTIONS) {
      const outputPath = path.join(ref.dir, `${artifact}.md`);
      const template = readAsset('records', `${artifact}.md`).replace(/<change>/g, ref.id);
      const context = projectContextText(ctx);
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
      };
      if (opts.json) return printJson(payload);
      line(`<artifact id="${artifact}" change="${ref.id}" source="sdlc">`);
      line(`Write to: ${outputPath}${payload.exists ? ' (exists - update it)' : ''}`);
      line();
      line(RECORD_INSTRUCTIONS[artifact]);
      if (context) line(`\n<context>\n${context}\n</context>`);
      line(`\n<template>\n${template}</template>\n</artifact>`);
      return;
    }
    // Planning artifacts and `apply` are OpenSpec's: delegate, then add the lifecycle view.
    if (!opts.json) {
      const r = runOpenSpec(['instructions', artifact, '--change', ref.id], { cwd: ctx.root, inherit: true });
      const view = evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true });
      line(c.dim(`\n[sdlc] stage: ${view.stageTitle}; next: ${view.next.message}`));
      if (!r.ok) process.exitCode = r.exitCode ?? 1;
      return;
    }
    const result = runOpenSpecJson<Record<string, unknown>>(['instructions', artifact, '--change', ref.id], ctx.root);
    if (!result.data) throw new SdlcError('openspec_instructions_failed', openspecFailure(result.data, result.raw));
    const view = evaluateChange(ctx.root, ref, ctx.config, { skipFingerprint: true });
    const gate = view.gates.find((g) => g.artifacts.includes(artifact));
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
    });
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
