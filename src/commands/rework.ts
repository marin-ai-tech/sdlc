import * as path from 'node:path';
import { loadProject, recordChangeEvent, type ProjectContext } from '../cli/context.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { provenance, readChangeState, STATE_FILE, type ChangeState } from '../core/change-state.js';
import { resolveChange, type ChangeRef } from '../core/changes.js';
import {
  assertNoLinks, checkpointRef, checkpointScope, dirtyFiles, restoreFromCheckpoint, type CheckpointScope,
} from '../core/checkpoint.js';
import { nextSeq } from '../core/decision-order.js';
import { SdlcError } from '../core/errors.js';
import { isFile, readText } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { stripProvenance } from '../core/license.js';
import { evaluateChange } from '../core/lifecycle.js';
import { assertReworkReason, filesThatChange, gateReached, REWORK_GATES, type ReworkGateId } from '../core/rework.js';
import { nextCycle } from '../core/rework-limit.js';
import { readRolesFile } from '../core/roles.js';
import { approvalIdentity, assertHuman, parseGate, roleDecision } from './gates.js';

/**
 * `sdlc rework <gate>`: a person sends the change back to the gate's stage with a reason category
 * and a note; with `--reset`, the files the plan covers and the change folder go back to the gate's
 * checkpoint. A human decision, so it refuses to run inside an agent session.
 */
export interface ReworkOptions {
  change?: string;
  reason?: string;
  note?: string;
  as?: string;
  reset?: boolean;
  json?: boolean;
}

interface Rework {
  gate: ReworkGateId;
  reason: string;
  note: string;
  by: string;
  from: string;
  role?: string;
}

function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

/**
 * What `--reset` restores; refuses when there is no plan, no checkpoint, a path through a link, or uncommitted
 * edits in those files. Every check runs here, before the rework is recorded, so a refused reset records nothing.
 */
function resetScope(ctx: ProjectContext, ref: ChangeRef, gate: ReworkGateId): CheckpointScope {
  const planFile = path.join(ref.dir, 'plan.md');
  if (!isFile(planFile)) {
    throw new SdlcError('no_plan', { key: 'error.rework_no_plan', params: { change: ref.id } });
  }
  const files = filesThatChange(stripProvenance(readText(planFile) ?? ''));
  const dir = toPosix(path.relative(ctx.root, ref.dir));
  const refName = checkpointRef(ref.id, gate);
  const scope = checkpointScope(ctx.root, refName, files, dir, [`${dir}/${STATE_FILE}`]);
  if (!scope) {
    throw new SdlcError('no_checkpoint', { key: 'error.rework_no_checkpoint', params: { gate, ref: refName } });
  }
  assertNoLinks(scope);
  const dirty = dirtyFiles(scope);
  if (dirty.length > 0) {
    throw new SdlcError('dirty_worktree', { key: 'error.rework_dirty_files', params: { files: dirty.join(', ') } });
  }
  return scope;
}

function recordRework(ctx: ProjectContext, ref: ChangeRef, state: ChangeState, rework: Rework): void {
  const previous = state.gates[rework.gate]?.rework;
  state.gates[rework.gate] = {
    ...(state.gates[rework.gate] ?? {}),
    rework: {
      ...(rework.role ? { role: rework.role } : {}),
      by: rework.by,
      at: new Date().toISOString(),
      seq: nextSeq(state),
      reason: rework.reason,
      note: rework.note,
      from: rework.from,
      cycle: nextCycle(previous),
      ...provenance(ctx.stamp),
    },
  };
  recordChangeEvent(ctx, ref, state, `gate.${rework.gate}.rework`, rework.by, `${rework.reason}: ${rework.note}`);
}

function printRework(ctx: ProjectContext, ref: ChangeRef, rework: Rework, restored: string[] | undefined): void {
  line(c.yellow(t('gate.reworkLine', { gate: rework.gate, identity: rework.by, reason: rework.reason,
    note: rework.note })));
  if (restored) {
    line(restored.length > 0
      ? t('rework.restored', { gate: rework.gate })
      : t('rework.nothingRestored', { gate: rework.gate }));
    for (const file of restored) line(`  ${file}`);
    line(c.yellow(t('rework.externalNotUndone')));
  }
  emitNextHint(ctx, ref.id);
}

function report(ctx: ProjectContext, ref: ChangeRef, rework: Rework, restored: string[] | undefined,
  json: boolean | undefined): void {
  if (!json) return printRework(ctx, ref, rework, restored);
  const stage = evaluateChange(ctx.root, ref, ctx.config).stage;
  const next = resolveNext(ctx, ref.id);
  printJson({
    change: ref.id, gate: rework.gate, status: 'rejected', reason: rework.reason, note: rework.note,
    by: rework.by, from: rework.from, stage, ...(restored ? { restored } : {}), ...(next ? { next } : {}),
  });
}

/** Refuses an unknown reason, a gate not reached yet and, with roles.yaml, a person without an approving role. */
function decide(
  ctx: ProjectContext, gate: ReworkGateId, opts: ReworkOptions, state: ChangeState,
): Omit<Rework, 'from'> {
  const reason = assertReworkReason(ctx.config, opts.reason);
  if (!gateReached(state, gate)) {
    throw new SdlcError('invalid_transition', { key: 'error.rework_gate_not_reached', params: { gate } });
  }
  const roles = readRolesFile(ctx.root);
  const by = approvalIdentity(ctx.root, roles, undefined);
  if (roles) roleDecision(ctx.root, ctx.config, roles, gate, state, opts.as, false);
  return { gate, reason, note: opts.note ?? '', by, ...(opts.as ? { role: opts.as } : {}) };
}

export async function reworkCommand(gateArg: string, opts: ReworkOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, REWORK_GATES) as ReworkGateId;
    assertHuman(ctx.config, 'rework');
    if (!opts.note) throw new SdlcError('note_required', { key: 'error.rework_needs_note' });
    const ref = resolveChange(ctx.paths, opts.change);
    const state = readChangeState(ref.dir);
    const decision = decide(ctx, gate, opts, state);
    const scope = opts.reset ? resetScope(ctx, ref, gate) : undefined;
    const rework = { ...decision, from: evaluateChange(ctx.root, ref, ctx.config).stage };
    recordRework(ctx, ref, state, rework);
    const restored = scope ? restoreFromCheckpoint(scope) : undefined;
    report(ctx, ref, rework, restored, opts.json);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
