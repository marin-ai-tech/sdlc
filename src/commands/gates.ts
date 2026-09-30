import { loadProject, recordChangeEvent } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { agentEnvironment } from '../core/agent-env.js';
import { provenance, readChangeState, type GateState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { ALL_GATES, APPROVAL_GATES, type ApprovalGateId, type GateId, type SdlcConfig } from '../core/config.js';
import { baseDigests, readChangeDeltas } from '../core/deltas.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { evaluateChange, type LifecycleView } from '../core/lifecycle.js';
import { changeMarkdown, tryStampArtifacts } from '../core/stamp.js';

/**
 * Gate decisions: approve, reject, waive, and the test lock. These record
 * human judgment, so they refuse to run inside an agent session (separation of
 * duties: "the agent that wrote the code has no way to approve it").
 */
export function assertHuman(config: SdlcConfig, action: string): void {
  const agent = agentEnvironment();
  if (agent && config.enforcement.forbidAgentApprovals) {
    throw new SdlcError(
      'agent_cannot_approve',
      `\`sdlc ${action}\` records a human decision and cannot run inside an agent session (${agent}).`,
      'Run it yourself in a terminal outside the agent.'
    );
  }
}

function resolveIdentity(root: string, by: string | undefined): string {
  const identity = by ?? formatIdentity(gitIdentity(root));
  if (!identity) {
    throw new SdlcError('no_identity', 'Cannot tell who is deciding: git user.name/user.email are not set.',
      'Set them with `git config user.email you@example.com`, or pass --by "<name <email>>".');
  }
  return identity;
}

function assertRoleMember(config: SdlcConfig, role: string, identity: string): void {
  const members = config.roles[role];
  if (!members || members.length === 0) return;
  const lower = identity.toLowerCase();
  const ok = members.some((m) => lower.includes(m.toLowerCase()));
  if (!ok) {
    throw new SdlcError('not_in_role', `${identity} is not listed under roles.${role} in openspec/sdlc.yaml.`,
      `Ask one of: ${members.join(', ')}.`);
  }
}

function parseGate(value: string, allowed: readonly string[]): GateId {
  if (!allowed.includes(value)) {
    throw new SdlcError('invalid_gate', `Unknown gate '${value}'. Gates: ${allowed.join(', ')}.`);
  }
  return value as GateId;
}

/** Top-level markdown files a gate approval covers (delta specs are never stamped). */
function approvedFiles(view: LifecycleView, gate: ApprovalGateId, changeDir: string): string[] {
  if (gate === 'review') return ['review.md'];
  if (gate === 'release') return ['review.md', 'release.md'];
  const covered = view.gates.find((g) => g.id === gate)?.artifacts ?? [];
  const topLevel = new Set(changeMarkdown(changeDir));
  return view.artifacts.filter((a) => covered.includes(a.id)).flatMap((a) => a.files).filter((f) => topLevel.has(f));
}

export interface DecisionOptions {
  change?: string;
  as?: string;
  note?: string;
  by?: string;
  json?: boolean;
}

export async function approveCommand(gateArg: string, opts: DecisionOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, APPROVAL_GATES) as ApprovalGateId;
    assertHuman(ctx.config, 'approve');
    const ref = resolveChange(ctx.paths, opts.change);
    const view = evaluateChange(ctx.root, ref, ctx.config);
    const evaluation = view.gates.find((g) => g.id === gate)!;
    if (evaluation.status === 'blocked') {
      throw new SdlcError('gate_blocked', `The ${gate} gate cannot be approved yet: ${evaluation.reason}.`);
    }
    if (!evaluation.digest) {
      throw new SdlcError('gate_not_ready', `Nothing to approve for the ${gate} gate yet.`);
    }
    const gateConfig = ctx.config.gates[gate];
    const allowedRoles = [...gateConfig.approvers, ...gateConfig.highRiskApprovers];
    const role = opts.as ?? evaluation.missingRoles.map((r) => r.split(' | ')[0]).find((r) => allowedRoles.includes(r)) ?? gateConfig.approvers[0] ?? 'approver';
    if (allowedRoles.length > 0 && !allowedRoles.includes(role)) {
      throw new SdlcError('invalid_role', `Role '${role}' does not approve the ${gate} gate (roles: ${allowedRoles.join(', ')}).`);
    }
    const identity = resolveIdentity(ctx.root, opts.by);
    assertRoleMember(ctx.config, role, identity);

    const state = readChangeState(ref.dir);
    const current: GateState = state.gates[gate] ?? {};
    const approvals = (current.approvals ?? []).filter((a) => a.role !== role);
    approvals.push({
      role,
      by: identity,
      at: new Date().toISOString(),
      digest: evaluation.digest,
      ...(opts.note ? { note: opts.note } : {}),
      ...(gate === 'spec' ? { base: baseDigests(ctx.paths, readChangeDeltas(ref.dir)) } : {}),
      ...provenance(ctx.stamp),
    });
    state.gates[gate] = { ...current, approvals };
    recordChangeEvent(ctx, ref, state, `gate.${gate}.approved`, identity, `role ${role}${opts.note ? `: ${opts.note}` : ''}`);
    // The approved artifacts record which scdl version and license approved them.
    const stamping = tryStampArtifacts(ref.dir, approvedFiles(view, gate, ref.dir), ctx.stamp);
    if (stamping.error && !opts.json) warn(`approval recorded, but the provenance line was not written: ${stamping.error}`);

    const after = evaluateChange(ctx.root, ref, ctx.config);
    const status = after.gates.find((g) => g.id === gate)!;
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, gate, role, by: identity, status: status.status, missingRoles: status.missingRoles, ...(next ? { next } : {}) });
      return;
    }
    line(`${c.green('✓')} ${gate} gate: ${identity} approved as ${role} ${c.dim(`(${evaluation.digest.slice(7, 19)})`)}`);
    if (status.status !== 'approved') line(`  still needed: ${status.missingRoles.join(', ')}`);
    emitNextHint(ctx, ref.id);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function rejectCommand(gateArg: string, opts: DecisionOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, APPROVAL_GATES) as ApprovalGateId;
    assertHuman(ctx.config, 'reject');
    if (!opts.note) throw new SdlcError('note_required', 'A rejection needs --note "<why>" so the author knows what to change.');
    const ref = resolveChange(ctx.paths, opts.change);
    const identity = resolveIdentity(ctx.root, opts.by);
    const state = readChangeState(ref.dir);
    state.gates[gate] = {
      ...(state.gates[gate] ?? {}),
      rejection: {
        ...(opts.as ? { role: opts.as } : {}),
        by: identity,
        at: new Date().toISOString(),
        note: opts.note,
        ...provenance(ctx.stamp),
      },
    };
    recordChangeEvent(ctx, ref, state, `gate.${gate}.rejected`, identity, opts.note);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, gate, status: 'rejected', by: identity, note: opts.note, ...(next ? { next } : {}) });
      return;
    }
    line(`${c.red('✗')} ${gate} gate rejected by ${identity}: ${opts.note}`);
    emitNextHint(ctx, ref.id);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function waiveCommand(gateArg: string, opts: DecisionOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, ALL_GATES);
    assertHuman(ctx.config, 'waive');
    if (!opts.note) throw new SdlcError('note_required', 'A waiver needs --note "<why>"; it is part of the audit trail.');
    const ref = resolveChange(ctx.paths, opts.change);
    const identity = resolveIdentity(ctx.root, opts.by);
    const state = readChangeState(ref.dir);
    const key = gate as keyof typeof state.gates;
    state.gates[key] = {
      ...(state.gates[key] ?? {}),
      waived: { by: identity, at: new Date().toISOString(), note: opts.note, ...provenance(ctx.stamp) },
    };
    recordChangeEvent(ctx, ref, state, `gate.${gate}.waived`, identity, opts.note);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, gate, status: 'waived', by: identity, note: opts.note, ...(next ? { next } : {}) });
      return;
    }
    line(`${c.yellow('~')} ${gate} gate waived by ${identity}: ${opts.note}`);
    emitNextHint(ctx, ref.id);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

/**
 * Bug-fix protocol: after the reproducing test is committed, lock test files so
 * the fix has to change the code. Locking only restricts the agent, so the
 * agent may do it; unlocking is a human decision.
 */
export async function testsCommand(action: string, opts: { change?: string; json?: boolean; by?: string }): Promise<void> {
  try {
    if (action !== 'lock' && action !== 'unlock') {
      throw new SdlcError('invalid_action', 'Use `sdlc tests lock` or `sdlc tests unlock`.');
    }
    const ctx = loadProject();
    if (action === 'unlock') assertHuman(ctx.config, 'tests unlock');
    const ref = resolveChange(ctx.paths, opts.change);
    const state = readChangeState(ref.dir);
    const identity = opts.by ?? formatIdentity(gitIdentity(ctx.root)) ?? agentEnvironment() ?? 'unknown';
    state.tests_locked = action === 'lock';
    recordChangeEvent(ctx, ref, state, `tests.${action}ed`, identity);
    if (opts.json) return printJson({ change: ref.id, testsLocked: state.tests_locked });
    line(action === 'lock'
      ? `${c.green('✓')} tests locked for ${ref.id}: edits to test files (enforcement.test_paths) are blocked until a person runs \`sdlc tests unlock --change ${ref.id}\`.`
      : `${c.green('✓')} tests unlocked for ${ref.id}.`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
