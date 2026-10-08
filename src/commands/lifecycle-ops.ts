import { t } from '../core/i18n.js';
import * as path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { loadProject, type ProjectContext } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { agentEnvironment } from '../core/agent-env.js';
import { appendHistory, readChangeState, writeChangeState, type ChangeState, type HistoryEvent } from '../core/change-state.js';
import { listActiveChanges, listArchivedChanges, resolveChange, type ChangeRef } from '../core/changes.js';
import { checkDeltaTargets, findOverlaps, readChangeDeltas, type DeltaIssue } from '../core/deltas.js';
import { SdlcError } from '../core/errors.js';
import { commitsTouching, formatIdentity, gitIdentity } from '../core/git.js';
import { evaluateChange } from '../core/lifecycle.js';
import { openspecFailure, runOpenSpecJson } from '../core/openspec.js';
import { readOpenSpecMetadata } from '../core/openspec-schema.js';
import { isFile, readText, writeTextAtomic } from '../core/fs-utils.js';
import { stampText, stampTextLocalized } from '../core/license.js';
import { appendLog, readLog } from '../core/log.js';
import { changeMarkdown, tryStampArtifacts } from '../core/stamp.js';
import { aggregateMetrics, changeMetrics } from '../core/metrics.js';
import { changeLog } from '../core/awaiting.js';
import { printChangeFlow, printProjectFlow } from './audit-flow.js';
import { readBacklog, setBacklogStatus } from '../core/backlog.js';
import { closeDeferred, readDeferred } from '../core/deferred.js';

interface ValidationIssue {
  source: 'openspec' | 'sdlc';
  level: 'error' | 'warning' | 'info';
  path?: string;
  line?: number;
  message: string;
  textKey?: string;
}

interface OpenSpecValidateItem {
  id: string;
  valid: boolean;
  issues: Array<{ level: string; path?: string; message: string; line?: number }>;
}

function validateOne(ctx: ProjectContext, ref: ChangeRef): { change: string; valid: boolean; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const deltas = readChangeDeltas(ref.dir);
  const skipSpecs = readOpenSpecMetadata(ref.dir).skip_specs === true;
  if (deltas.length === 0 && !skipSpecs) {
    issues.push({
      source: 'sdlc', level: 'info',
      message: t('validate.noDeltaSpecs', undefined, 'en'),
      textKey: 'validate.noDeltaSpecs',
    });
  } else {
    const result = runOpenSpecJson<{ items?: OpenSpecValidateItem[] }>(['validate', ref.id, '--type', 'change', '--strict', '--no-interactive'], ctx.root);
    const item = result.data?.items?.[0];
    if (!item) {
      issues.push({ source: 'openspec', level: 'error', message: `openspec validate failed: ${openspecFailure(result.data, result.raw)}` });
    } else {
      for (const i of item.issues) {
        const level = i.level.toLowerCase() === 'error' ? 'error' : i.level.toLowerCase() === 'warning' ? 'warning' : 'info';
        issues.push({ source: 'openspec', level, ...(i.path ? { path: i.path } : {}), ...(i.line ? { line: i.line } : {}), message: i.message });
      }
      if (!item.valid && !item.issues.some((i) => i.level.toLowerCase() === 'error')) {
        issues.push({
          source: 'openspec', level: 'error',
          message: t('validate.openspecInvalid', undefined, 'en'),
          textKey: 'validate.openspecInvalid',
        });
      }
    }
    issues.push(...checkDeltaTargets(ctx.paths, deltas).map((i: DeltaIssue) => ({ source: 'sdlc' as const, level: i.level, path: i.file, line: i.line, message: i.message })));
  }
  return { change: ref.id, valid: !issues.some((i) => i.level === 'error'), issues };
}

export async function validateCommand(opts: { change?: string; all?: boolean; json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    const refs = opts.all || (!opts.change && listActiveChanges(ctx.paths).length !== 1)
      ? listActiveChanges(ctx.paths)
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
    } else {
      for (const item of items) {
        line(`${item.valid ? c.green('✓') : c.red('✗')} ${item.change}`);
        for (const i of item.issues) {
          const tag = i.level === 'error' ? c.red(t('label.error'))
            : i.level === 'warning' ? c.yellow(t('label.warning'))
              : c.dim(t('label.info'));
          const msg = i.textKey ? t(i.textKey) : i.message;
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
      if (items.length === 0) line(t('validate.none'));
    }
    if (failed > 0) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json, { items: [] });
  }
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export interface ArchiveOptions {
  yes?: boolean;
  skipSpecs?: boolean;
  force?: boolean;
  note?: string;
  json?: boolean;
}

export async function archiveCommand(id: string | undefined, opts: ArchiveOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, id);
    const view = evaluateChange(ctx.root, ref, ctx.config);
    const open = view.gates.filter((g) => g.required && !g.satisfied);
    if (open.length > 0 && !opts.force) {
      throw new SdlcError(
      'gates_not_satisfied',
      { key: 'error.cannot_archive_x_x', params: { ref_id: ref.id, p2: open.map((g) => `${g.id} (${g.status}${g.reason ? `: ${g.reason}` : ''})`).join('; ') } },
      { key: 'fix.next_x', params: { detail: view.next.cli ?? view.next.message } }
    );
    }
    if (opts.force) {
      const agent = agentEnvironment();
      if (agent && ctx.config.enforcement.forbidAgentApprovals) {
        throw new SdlcError('agent_cannot_force', { key: 'error.archiving_past_unsatisfied_gates_is_a_human_deci' });
      }
      if (open.length > 0 && !opts.note) throw new SdlcError(
        'note_required',
        { key: 'error.force_past_open_gates_needs_note_why_for_the_aud' }
      );
    }
    const deltaErrors = checkDeltaTargets(ctx.paths, readChangeDeltas(ref.dir)).filter((i) => i.level === 'error');
    if (deltaErrors.length > 0 && !opts.skipSpecs) {
      throw new SdlcError(
      'delta_check_failed',
      { key: 'error.delta_specs_of_x_do_not_match_the_living_specs_x', params: { ref_id: ref.id, p2: deltaErrors.map((e) => `${e.file}:${e.line} ${e.message}`).join(' | ') } },
      { key: 'fix.fix_the_delta_headers_run_sdlc_validate_change_x', params: { ref_id: ref.id } }
    );
    }
    if (!opts.yes && !(await confirm(`Archive ${ref.id} and merge its delta specs into openspec/specs?`))) {
      throw new SdlcError(
      'archive_confirmation_required',
      { key: 'error.archive_needs_confirmation' },
      { key: 'fix.re_run_with_yes_sdlc_archive_x_yes', params: { ref_id: ref.id } }
    );
    }

    const before = readChangeState(ref.dir);
    const state: ChangeState = JSON.parse(JSON.stringify(before)) as ChangeState;
    const by = formatIdentity(gitIdentity(ctx.root)) ?? agentEnvironment();
    const event = open.length > 0 ? 'change.archived.forced' : 'change.archived';
    const detail = open.length > 0 ? `open gates: ${open.map((g) => g.id).join(', ')}; ${opts.note ?? ''}` : undefined;
    // Every artifact that goes into the archive records the sdlc version and license that archived it.
    const originals = new Map(changeMarkdown(ref.dir).map((f) => [f, readText(path.join(ref.dir, f)) ?? '']));
    const stamping = tryStampArtifacts(ref.dir, [...originals.keys()], ctx.stamp);
    if (stamping.error && !opts.json) warn(t('warn.provenanceNotWritten', { error: stamping.error }));
    appendHistory(state, event, by, detail, ctx.stamp);
    writeChangeState(ref.dir, state, ctx.stamp);

    const args = ['archive', ref.id, '--yes'];
    if (opts.skipSpecs) args.push('--skip-specs');
    const result = runOpenSpecJson<{ archive?: { archivedAs: string; path: string; specsUpdated: boolean; totals?: Record<string, number>; warnings?: string[] } }>(args, ctx.root);
    if (!result.ok || !result.data?.archive) {
      writeChangeState(ref.dir, before);
      for (const [file, content] of originals) {
        const target = path.join(ref.dir, file);
        if (isFile(target) && readText(target) !== content) writeTextAtomic(target, content);
      }
      throw new SdlcError(
      'openspec_archive_failed',
      { key: 'error.openspec_archive_failed_x', params: { p1: openspecFailure(result.data, result.raw) } }
    );
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
    for (const w of archive.warnings ?? []) warn(w);
    emitNextHint(ctx);
  } catch (error) {
    reportFailure(error, opts.json, { archive: null });
  }
}


/** ` [sdlc 0.1.0 · community]` for events that recorded the harness version and license. */
function stampSuffix(event: HistoryEvent): string {
  if (!event.sdlc) return '';
  const type = event.license?.split(' ')[0];
  return c.dim(` [sdlc ${event.sdlc}${type ? ` · ${type}` : ''}]`);
}


export async function auditCommand(opts: { change?: string; json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    if (opts.change) {
      const ref = resolveChange(ctx.paths, opts.change, { allowArchived: true });
      const state = readChangeState(ref.dir);
      const commits = commitsTouching(ctx.root, [path.relative(ctx.root, ref.dir)]);
      const metrics = changeMetrics(state, changeLog(readLog(ctx.root), ref.id));
      if (opts.json) {
        printJson({ change: ref.id, archived: ref.archived, kind: state.kind, risk: state.risk, track: state.track, source: state.source,
          ...(state.harness ? { recordedWith: state.harness } : {}), history: state.history, commits, metrics, harness: ctx.stamp });
        return;
      }
      line(c.bold(t('audit.trail', { change: ref.id }))
        + c.dim(t('audit.meta', { kind: state.kind, risk: state.risk, track: state.track })));
      for (const h of state.history) {
        line(`  ${h.at}  ${h.event.padEnd(26)} ${h.by ?? ''}${h.detail ? c.dim(` - ${h.detail}`) : ''}${stampSuffix(h)}`);
      }
      if (commits.length > 0) {
        line(c.bold(`  ${t('audit.commits')}`));
        for (const cm of commits) line(`  ${cm.date}  ${cm.sha.slice(0, 10)}  ${cm.author}  ${cm.subject}`);
      }
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
      return;
    }
    const refs = [...listActiveChanges(ctx.paths), ...listArchivedChanges(ctx.paths)];
    const versions = new Set<string>();
    const licenses = new Set<string>();
    const log = readLog(ctx.root);
    const rows = refs.map((ref) => {
      const state = readChangeState(ref.dir);
      for (const h of state.history) {
        if (h.sdlc) versions.add(h.sdlc);
        if (h.license) licenses.add(h.license);
      }
      const metrics = changeMetrics(state, changeLog(log, ref.id));
      return { change: ref.id, archived: ref.archived, kind: state.kind, track: state.track, ...metrics };
    });
    const aggregate = {
      changes: rows.length,
      archived: rows.filter((r) => r.archived).length,
      ...aggregateMetrics(rows),
      /** sdlc versions and licenses recorded in the change histories. */
      recordedWith: { versions: [...versions].sort(), licenses: [...licenses].sort() },
    };
    if (opts.json) return printJson({ aggregate, changes: rows, harness: ctx.stamp });
    line(c.bold(t('audit.metrics', {
      changes: aggregate.changes, archived: aggregate.archived,
    })) + c.dim(` · ${stampTextLocalized(ctx.stamp)}`));
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
    printProjectFlow(aggregate);
    if (versions.size > 0) {
      line(`  ${t('audit.recordedWith', {
        versions: [...versions].sort().join(', '),
        licenses: [...licenses].sort().join('; '),
      })}`);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

/** Prints the project log (`openspec/.sdlc/log.jsonl`), newest last. */
export async function logCommand(opts: { change?: string; limit?: string; json?: boolean }): Promise<void> {
  try {
    const ctx = loadProject();
    const limit = opts.limit === undefined ? 50 : Number(opts.limit);
    if (!Number.isInteger(limit) || limit <= 0) throw new SdlcError(
      'invalid_option',
      { key: 'error.limit_must_be_a_positive_whole_number' }
    );
    const entries = readLog(ctx.root).filter((e) => !opts.change || e.change === opts.change);
    const shown = entries.slice(-limit);
    if (opts.json) return printJson({ entries: shown, total: entries.length, harness: ctx.stamp });
    if (entries.length === 0) {
      line(ctx.config.log.enabled ? t('log.empty') : t('log.off'));
      return;
    }
    if (shown.length < entries.length) {
      line(c.dim(t('log.truncated', { shown: shown.length, total: entries.length })));
    }
    for (const e of shown) {
      const who = e.by ?? (e.agent ? `agent:${e.agent}` : '');
      line(`${e.ts}  ${e.event.padEnd(26)} ${e.change ? `${e.change} ` : ''}${who}${e.detail ? c.dim(` - ${e.detail}`) : ''}` +
        c.dim(` [sdlc ${e.sdlc ?? '?'} · ${(e.license ?? '?').split(' ')[0]}]`));
    }
  } catch (error) {
    reportFailure(error, opts.json, { entries: [] });
  }
}
