import { t } from '../core/i18n.js';
import { loadProject, recordChangeEvent, type ProjectContext } from '../cli/context.js';
import { c, line, printJson, reportFailure, warn } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { agentEnvironment } from '../core/agent-env.js';
import {
  provenance, readChangeState, type ApprovalRecord, type ChangeState, type GateState, type ReleaseCheckRecord,
} from '../core/change-state.js';
import { resolveChange, type ChangeRef } from '../core/changes.js';
import { ALL_GATES, APPROVAL_GATES, type ApprovalGateId, type GateId, type SdlcConfig } from '../core/config.js';
import { nextSeq } from '../core/decision-order.js';
import { baseDigests, readChangeDeltas } from '../core/deltas.js';
import { SdlcError } from '../core/errors.js';
import { humanCommandFix } from '../core/human-command.js';
import { defaultBaseRef, formatIdentity, gitIdentity } from '../core/git.js';
import { approvalEmails, changeAuthors, checkApproval, readRolesFile, type RolesFile } from '../core/roles.js';
import { assertByAllowed, sameApprover, stillNeeded } from '../core/approval-quorum.js';
import { evaluateChange, type LifecycleView } from '../core/lifecycle.js';
import { recordAwaiting } from '../core/awaiting.js';
import { changeMarkdown, tryStampArtifacts } from '../core/stamp.js';
import { recordCheckpoint } from '../core/checkpoint.js';
import { approvalChecks } from '../mcp/release-checks.js';

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
      { key: 'error.sdlc_x_records_a_human_decision_and_cannot_run_i', params: { action: action, agent: agent } },
      humanCommandFix(action, config.cli)
    );
  }
}

function resolveIdentity(root: string, by: string | undefined): string {
  const identity = by ?? formatIdentity(gitIdentity(root));
  if (!identity) {
    throw new SdlcError(
      'no_identity',
      { key: 'error.cannot_tell_who_is_deciding_git_user_name_user_e' },
      { key: 'fix.set_them_with_git_config_user_email_you_example_' }
    );
  }
  return identity;
}

function assertRoleMember(config: SdlcConfig, role: string, identity: string): void {
  const members = config.roles[role];
  if (!members || members.length === 0) return;
  const lower = identity.toLowerCase();
  const ok = members.some((m) => lower.includes(m.toLowerCase()));
  if (!ok) {
    throw new SdlcError(
      'not_in_role',
      { key: 'error.x_is_not_listed_under_roles_x_in_openspec_sdlc_y', params: { identity: identity, role: role } },
      { key: 'fix.ask_one_of_x', params: { p1: members.join(', ') } }
    );
  }
}

export function roleDecision(root: string, config: SdlcConfig, roles: RolesFile, gate: ApprovalGateId,
  state: ReturnType<typeof readChangeState>, requested: string | undefined, separation: boolean) {
  const email = gitIdentity(root).email ?? '';
  const accepted = [...config.gates[gate].approvers, ...config.gates[gate].highRiskApprovers];
  const held = accepted.filter((role) => roles.roles[role]?.some((id) => roles.people.some((p) => p.id === id
    && p.emails.includes(email.toLowerCase()))));
  const role = requested ?? held[0] ?? accepted[0] ?? 'approver';
  const approvals = separation ? approvalEmails(state) : {};
  const authors = separation ? changeAuthors(root, config.review.base ?? defaultBaseRef(root)) : [];
  const check = checkApproval(roles, { gate, roles: requested ? [requested] : accepted, email, authors,
    approvals });
  if (requested && !accepted.includes(requested)) {
    throw new SdlcError(
      'missing_role',
      { key: 'error.role_x_cannot_approve_x', params: { requested: requested, gate: gate } }
    );
  }
  if (!check.allowed) {
    const eligible = roles.people.filter((person) => checkApproval(roles, { gate, roles: accepted,
      email: person.emails[0], authors, approvals }).allowed).map((person) => person.name);
    throw new SdlcError(
      check.refusals[0].rule,
      { key: 'error.refusal_detail', params: { detail: check.refusals.map((r) => r.ref) } },
      { key: 'fix.ask_one_of_x', params: { p1: eligible.length ? eligible.join(', ') : { key: 'roles.noEligible' } } }
    );
  }
  return { role, person: check.person!.id };
}

export function approvalIdentity(root: string, roles: RolesFile | undefined, by: string | undefined): string {
  if (!roles) return resolveIdentity(root, by);
  const email = gitIdentity(root).email;
  if (!email) throw new SdlcError('no_identity', { key: 'error.git_user_email_is_required_with_roles_yaml' });
  if (by) {
    const claimed = /<([^>]+)>/.exec(by)?.[1] ?? by;
    if (claimed.toLowerCase() !== email.toLowerCase()) {
      throw new SdlcError('by_mismatch', { key: 'error.by_email_must_match_git_user_email' });
    }
  }
  const person = roles.people.find((candidate) => candidate.emails.includes(email.toLowerCase()));
  if (!person) throw new SdlcError('unknown_person', { key: 'error.x_is_not_in_roles_yaml', params: { email: email } });
  return `${person.name} <${email}>`;
}

export function parseGate(value: string, allowed: readonly string[]): GateId {
  if (!allowed.includes(value)) {
    throw new SdlcError(
      'invalid_gate',
      { key: 'error.unknown_gate_x_gates_x', params: { value: value, p2: allowed.join(', ') } }
    );
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

function approvalRole(
  config: SdlcConfig, roles: RolesFile | undefined, root: string,
  gate: ApprovalGateId, state: ReturnType<typeof readChangeState>,
  requested: string | undefined, missing: string[],
): { role: string; person?: string } {
  const gateConfig = config.gates[gate];
  const allowed = [...gateConfig.approvers, ...gateConfig.highRiskApprovers];
  const decided = roles ? roleDecision(root, config, roles, gate, state, requested, true) : undefined;
  const suggested = missing.map((value) => value.split(' | ')[0]).find((value) => allowed.includes(value));
  const role = decided?.role ?? requested ?? suggested ?? gateConfig.approvers[0] ?? 'approver';
  if (allowed.length && !allowed.includes(role)) {
    throw new SdlcError(
      'invalid_role',
      { key: 'error.role_x_does_not_approve_the_x_gate_roles_x', params: { role: role, gate: gate, p3: allowed.join(', ') } }
    );
  }
  return { role, person: decided?.person };
}

interface ApprovalFields {
  role: string;
  person: string | undefined;
  identity: string;
  digest: string;
  note?: string;
  /** The release checks that passed (release gate with `release.mcp` only). */
  checks?: ReleaseCheckRecord[];
}

/** The approval as recorded: who, in which role, what they signed, and its place in the record's decision order. */
function approvalRecord(
  ctx: ProjectContext, ref: ChangeRef, state: ChangeState, gate: ApprovalGateId, fields: ApprovalFields,
): ApprovalRecord {
  return {
    role: fields.role,
    by: fields.identity,
    ...(fields.person ? { person: fields.person } : {}),
    at: new Date().toISOString(),
    seq: nextSeq(state),
    digest: fields.digest,
    ...(fields.note ? { note: fields.note } : {}),
    ...(fields.checks ? { checks: fields.checks } : {}),
    ...(gate === 'spec' ? { base: baseDigests(ctx.paths, readChangeDeltas(ref.dir)) } : {}),
    ...provenance(ctx.stamp),
  };
}

export async function approveCommand(gateArg: string, opts: DecisionOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const gate = parseGate(gateArg, APPROVAL_GATES) as ApprovalGateId;
    assertHuman(ctx.config, 'approve');
    assertByAllowed(ctx.config.gates[gate], readRolesFile(ctx.root) !== undefined, opts.by);
    const ref = resolveChange(ctx.paths, opts.change);
    const view = evaluateChange(ctx.root, ref, ctx.config);
    recordAwaiting(ctx.root, ctx.config, view, ctx.stamp);
    const evaluation = view.gates.find((g) => g.id === gate)!;
    if (evaluation.status === 'blocked') {
      throw new SdlcError(
      'gate_blocked',
      { key: 'error.the_x_gate_cannot_be_approved_yet_x', params: { gate: gate, evaluation_reason: evaluation.reason ?? '' } }
    );
    }
    if (!evaluation.digest) {
      throw new SdlcError(
        'gate_not_ready',
        { key: 'error.nothing_to_approve_for_the_x_gate_yet', params: { gate: gate } }
      );
    }
    const roles = readRolesFile(ctx.root);
    const state = readChangeState(ref.dir);
    const { role, person } = approvalRole(
      ctx.config, roles, ctx.root, gate, state, opts.as, evaluation.missingRoles,
    );
    const identity = approvalIdentity(ctx.root, roles, opts.by);
    if (!roles) assertRoleMember(ctx.config, role, identity);
    // B47: the release checks run after every other check and before anything is written.
    const checks = gate === 'release' ? await approvalChecks(ctx.config, ctx.root, ref.id) : undefined;

    recordCheckpoint(ctx.root, ref.id, gate);
    const current: GateState = state.gates[gate] ?? {};
    // A person approving again replaces only their own approval; other people's approvals stay.
    const approvals = (current.approvals ?? []).filter((a) => !sameApprover(a, identity, person));
    const fields = { role, person, identity, digest: evaluation.digest, note: opts.note, checks };
    approvals.push(approvalRecord(ctx, ref, state, gate, fields));
    state.gates[gate] = { ...current, approvals };
    recordChangeEvent(
      ctx, ref, state, `gate.${gate}.approved`, identity, `role ${role}${opts.note ? `: ${opts.note}` : ''}`,
    );
    // The approved artifacts record which sdlc version and license approved them.
    const stamping = tryStampArtifacts(ref.dir, approvedFiles(view, gate, ref.dir), ctx.stamp);
    if (stamping.error && !opts.json) {
      warn(t('warn.approvalProvenance', { error: stamping.error }));
    }

    const after = evaluateChange(ctx.root, ref, ctx.config);
    const status = after.gates.find((g) => g.id === gate)!;
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({
        change: ref.id, gate, role, by: identity, status: status.status,
        missingRoles: status.missingRoles, ...(checks ? { checks } : {}), ...(next ? { next } : {}),
      });
      return;
    }
    line(`${c.green(t('gate.approvedLine', { gate, identity, role }))} `
      + c.dim(`(${evaluation.digest.slice(7, 19)})`));
    if (status.status !== 'approved') {
      line(`  ${t('gate.stillNeeded', { roles: stillNeeded(status) })}`);
    }
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
    if (!opts.note) {
      throw new SdlcError('note_required', { key: 'error.a_rejection_needs_note_why_so_the_author_knows_w' });
    }
    const ref = resolveChange(ctx.paths, opts.change);
    const state = readChangeState(ref.dir);
    const roles = readRolesFile(ctx.root);
    const identity = approvalIdentity(ctx.root, roles, opts.by);
    if (roles) roleDecision(ctx.root, ctx.config, roles, gate, state, opts.as, false);
    state.gates[gate] = {
      ...(state.gates[gate] ?? {}),
      rejection: {
        ...(opts.as ? { role: opts.as } : {}),
        by: identity,
        at: new Date().toISOString(),
        seq: nextSeq(state),
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
    line(c.red(t('gate.rejectedLine', { gate, identity, note: opts.note })));
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
    if (!opts.note) {
      throw new SdlcError('note_required', { key: 'error.a_waiver_needs_note_why_it_is_part_of_the_audit_' });
    }
    const ref = resolveChange(ctx.paths, opts.change);
    const state = readChangeState(ref.dir);
    const roles = readRolesFile(ctx.root);
    const identity = approvalIdentity(ctx.root, roles, opts.by);
    if (roles && gate !== 'verify') {
      roleDecision(ctx.root, ctx.config, roles, gate as ApprovalGateId, state, opts.as, false);
    }
    const key = gate as keyof typeof state.gates;
    state.gates[key] = {
      ...(state.gates[key] ?? {}),
      waived: {
        by: identity, at: new Date().toISOString(), seq: nextSeq(state), note: opts.note, ...provenance(ctx.stamp),
      },
    };
    recordChangeEvent(ctx, ref, state, `gate.${gate}.waived`, identity, opts.note);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, gate, status: 'waived', by: identity, note: opts.note, ...(next ? { next } : {}) });
      return;
    }
    line(c.yellow(t('gate.waivedLine', { gate, identity, note: opts.note })));
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
export async function testsCommand(
  action: string, opts: { change?: string; json?: boolean; by?: string },
): Promise<void> {
  try {
    if (action !== 'lock' && action !== 'unlock') {
      throw new SdlcError('invalid_action', { key: 'error.use_sdlc_tests_lock_or_sdlc_tests_unlock' });
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
      ? c.green(t('tests.locked', { change: ref.id }))
      : c.green(t('tests.unlocked', { change: ref.id })));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
