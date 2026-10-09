import * as path from 'node:path';
import { loadProject, recordChangeEvent } from '../cli/context.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { provenance, readChangeState, STATE_FILE } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { assertNoLinks, checkpointRef, checkpointScope, dirtyFiles, restoreFromCheckpoint, } from '../core/checkpoint.js';
import { nextSeq } from '../core/decision-order.js';
import { SdlcError } from '../core/errors.js';
import { isFile, readText } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { stripProvenance } from '../core/license.js';
import { evaluateChange } from '../core/lifecycle.js';
import { assertReworkReason, filesThatChange, gateReached, REWORK_GATES } from '../core/rework.js';
import { nextCycle } from '../core/rework-limit.js';
import { readRolesFile } from '../core/roles.js';
import { approvalIdentity, assertHuman, parseGate, roleDecision } from './gates.js';
function toPosix(file) {
    return file.split(path.sep).join('/');
}
/**
 * What `--reset` restores; refuses when there is no plan, no checkpoint, a path through a link, or uncommitted
 * edits in those files. Every check runs here, before the rework is recorded, so a refused reset records nothing.
 */
function resetScope(ctx, ref, gate) {
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
function recordRework(ctx, ref, state, rework) {
    const cycle = nextCycle(state, rework.gate);
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
            cycle,
            ...provenance(ctx.stamp),
        },
    };
    recordChangeEvent(ctx, ref, state, `gate.${rework.gate}.rework`, rework.by, `${rework.reason}: ${rework.note}`);
}
function printRework(ctx, ref, rework, restored) {
    line(c.yellow(t('gate.reworkLine', { gate: rework.gate, identity: rework.by, reason: rework.reason,
        note: rework.note })));
    if (restored) {
        line(restored.length > 0
            ? t('rework.restored', { gate: rework.gate })
            : t('rework.nothingRestored', { gate: rework.gate }));
        for (const file of restored)
            line(`  ${file}`);
        line(c.yellow(t('rework.externalNotUndone')));
    }
    emitNextHint(ctx, ref.id);
}
function report(ctx, ref, rework, restored, json) {
    if (!json)
        return printRework(ctx, ref, rework, restored);
    const stage = evaluateChange(ctx.root, ref, ctx.config).stage;
    const next = resolveNext(ctx, ref.id);
    printJson({
        change: ref.id, gate: rework.gate, status: 'rejected', reason: rework.reason, note: rework.note,
        by: rework.by, from: rework.from, stage, ...(restored ? { restored } : {}), ...(next ? { next } : {}),
    });
}
/** Refuses an unknown reason, a gate not reached yet and, with roles.yaml, a person without an approving role. */
function decide(ctx, gate, opts, state) {
    const reason = assertReworkReason(ctx.config, opts.reason);
    if (!gateReached(state, gate)) {
        throw new SdlcError('invalid_transition', { key: 'error.rework_gate_not_reached', params: { gate } });
    }
    const roles = readRolesFile(ctx.root);
    const by = approvalIdentity(ctx.root, roles, undefined);
    if (roles)
        roleDecision(ctx.root, ctx.config, roles, gate, state, opts.as, false);
    return { gate, reason, note: opts.note ?? '', by, ...(opts.as ? { role: opts.as } : {}) };
}
export async function reworkCommand(gateArg, opts) {
    try {
        const ctx = loadProject();
        const gate = parseGate(gateArg, REWORK_GATES);
        assertHuman(ctx.config, 'rework');
        if (!opts.note)
            throw new SdlcError('note_required', { key: 'error.rework_needs_note' });
        const ref = resolveChange(ctx.paths, opts.change);
        const state = readChangeState(ref.dir);
        const decision = decide(ctx, gate, opts, state);
        const scope = opts.reset ? resetScope(ctx, ref, gate) : undefined;
        const rework = { ...decision, from: evaluateChange(ctx.root, ref, ctx.config).stage };
        recordRework(ctx, ref, state, rework);
        const restored = scope ? restoreFromCheckpoint(scope) : undefined;
        report(ctx, ref, rework, restored, opts.json);
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
