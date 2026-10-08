/**
 * `sdlc approve <gate> --change <id> --preview`: what an approval would cover, before it is given. The gate's
 * artifacts, the files that changed since the last approval of the gate (against the checkpoint recorded at that
 * approval, `refs/sdlc/<change>/<gate>`), the approvals so far and how many are needed, and whether the person may
 * approve: the checks `sdlc approve` runs (by-allowed, readiness, roles and separation, identity), in its order,
 * collected instead of thrown. It writes nothing: no record, no log entry, no checkpoint.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { unchangedSinceRework } from './approval-hygiene.js';
import { assertQuestionsAnswered, unansweredQuestions, type UnansweredQuestion } from './answers.js';
import { assertDebateRecorded } from './debate.js';
import { approverKey, assertByAllowed } from './approval-quorum.js';
import { readChangeState, type ChangeState } from './change-state.js';
import type { ChangeRef } from './changes.js';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { checkpointRef } from './checkpoint.js';
import { defaultBaseRef, formatIdentity, git, gitIdentity } from './git.js';
import { t } from './i18n.js';
import { stripProvenance } from './license.js';
import { evaluateChange, type GateEvaluation, type LifecycleView } from './lifecycle.js';
import { approvalEmails, changeAuthors, checkApproval, type Refusal, type RolesFile, readRolesFile } from './roles.js';

export interface PreviewRefusal {
  rule: string;
  /** English (JSON). */
  message: string;
  /** In the current locale (text output). */
  text: string;
}

export interface PreviewArtifact {
  name: string;
  /** Relative to the change folder. */
  path: string;
}

export interface ApprovePreview {
  change: string;
  gate: ApprovalGateId;
  gateStatus: string;
  allowed: boolean;
  refusals: PreviewRefusal[];
  /** Different people with a valid approval of the gate now. */
  approvals: number;
  /** People the gate needs (`min_approvals`, default 1). */
  needed: number;
  artifacts: PreviewArtifact[];
  changedSinceApproval: string[];
  /** After a rework of the gate, the digest is the one approved before it (B56): approving needs `--note`. */
  unchangedSinceRework: boolean;
  /** Intent and spec gates with questions that have no recorded answer (B62); absent when there are none. */
  openQuestions?: UnansweredQuestion[];
  openFindings?: Array<{ id?: string; title: string; severity: string }>;
  verification?: { status: string; at?: string; fresh: boolean };
}

export interface PreviewInput {
  root: string;
  config: SdlcConfig;
  ref: ChangeRef;
  gate: ApprovalGateId;
  /** `--as <role>`. */
  as?: string;
  /** `--by <identity>`. */
  by?: string;
}

/** The preview of approving `input.gate` of `input.ref` as the current git identity. */
export function previewApproval(input: PreviewInput): ApprovePreview {
  const view = evaluateChange(input.root, input.ref, input.config);
  const evaluation = view.gates.find((item) => item.id === input.gate)!;
  const state = readChangeState(input.ref.dir);
  const refusals = approvalRefusals(input, evaluation, state, readRolesFile(input.root));
  const artifacts = gateArtifacts(view, input.gate);
  const approvedBefore = (state.gates[input.gate]?.approvals ?? []).length > 0;
  return {
    change: input.ref.id,
    gate: input.gate,
    gateStatus: evaluation.status,
    allowed: refusals.length === 0,
    refusals,
    approvals: new Set(evaluation.approvals.map(approverKey)).size,
    needed: evaluation.minApprovals ?? input.config.gates[input.gate].minApprovals ?? 1,
    artifacts,
    changedSinceApproval: approvedBefore ? changedSinceCheckpoint(input, artifacts) : [],
    unchangedSinceRework: unchangedSinceRework(state, input.gate, evaluation.digest),
    ...openQuestionsFact(input, state),
    ...codeGateFacts(view, input.gate),
  };
}

/** The refusals `sdlc approve` would raise, in the order it checks; one per rule. */
function approvalRefusals(input: PreviewInput, evaluation: GateEvaluation, state: ChangeState,
  roles: RolesFile | undefined): PreviewRefusal[] {
  const found: PreviewRefusal[] = [];
  attempt(found, () => assertByAllowed(input.config.gates[input.gate], roles !== undefined, input.by));
  attempt(found, () => assertReady(input.gate, evaluation));
  found.push(...(roles ? rolesRefusals(input, state, roles) : configRefusals(input, evaluation)));
  attempt(found, () => assertQuestionsAnswered(input.config, input.ref.id, input.ref.dir, state, input.gate));
  attempt(found, () => assertDebateRecorded(input.config, input.ref.dir, input.gate));
  return found.filter((item, index) => found.findIndex((other) => other.rule === item.rule) === index);
}

function attempt(found: PreviewRefusal[], check: () => void): void {
  try {
    check();
  } catch (error) {
    if (!(error instanceof SdlcError)) throw error;
    found.push(refusalOf(error));
  }
}

function refusalOf(error: SdlcError): PreviewRefusal {
  return { rule: error.code, message: error.message, text: error.localizedMessage() };
}

function fromRefusal(refusal: Refusal): PreviewRefusal {
  return { rule: refusal.rule, message: refusal.message, text: t(refusal.ref.key, refusal.ref.params) };
}

/** `gate_blocked` / `gate_not_ready`, as `sdlc approve` raises them. */
function assertReady(gate: ApprovalGateId, evaluation: GateEvaluation): void {
  if (evaluation.status === 'blocked') {
    // The reason as a catalog reference: English in JSON (the text `sdlc approve` gives), localized in text output.
    const reason = evaluation.reasonKey ? { key: evaluation.reasonKey, params: evaluation.reasonParams } : undefined;
    const params = { gate, evaluation_reason: reason ?? evaluation.reason ?? '' };
    throw new SdlcError('gate_blocked', { key: 'error.the_x_gate_cannot_be_approved_yet_x', params });
  }
  if (!evaluation.digest) {
    throw new SdlcError('gate_not_ready', { key: 'error.nothing_to_approve_for_the_x_gate_yet', params: { gate } });
  }
}

/** With roles.yaml: the requested role, every role and separation rule, then the identity checks. */
function rolesRefusals(input: PreviewInput, state: ChangeState, roles: RolesFile): PreviewRefusal[] {
  const { root, config, gate } = input;
  const email = gitIdentity(root).email ?? '';
  const accepted = [...config.gates[gate].approvers, ...config.gates[gate].highRiskApprovers];
  const authors = changeAuthors(root, config.review.base ?? defaultBaseRef(root));
  const check = checkApproval(roles, { gate, roles: input.as ? [input.as] : accepted, email, authors,
    approvals: approvalEmails(state) });
  const found: PreviewRefusal[] = [];
  if (input.as && !accepted.includes(input.as)) {
    const params = { requested: input.as, gate };
    found.push(refusalOf(new SdlcError('missing_role', { key: 'error.role_x_cannot_approve_x', params })));
  }
  found.push(...check.refusals.map(fromRefusal));
  attempt(found, () => assertRolesIdentity(root, input.by));
  return found;
}

/** The identity rules of an approval with roles.yaml: a git email, and `--by` naming that same email. */
function assertRolesIdentity(root: string, by: string | undefined): void {
  const email = gitIdentity(root).email;
  if (!email) throw new SdlcError('no_identity', { key: 'error.git_user_email_is_required_with_roles_yaml' });
  const claimed = by ? /<([^>]+)>/.exec(by)?.[1] ?? by : email;
  if (claimed.toLowerCase() !== email.toLowerCase()) {
    throw new SdlcError('by_mismatch', { key: 'error.by_email_must_match_git_user_email' });
  }
}

/** Without roles.yaml: the role must approve this gate, a decider must be known and listed under the role. */
function configRefusals(input: PreviewInput, evaluation: GateEvaluation): PreviewRefusal[] {
  const gateConfig = input.config.gates[input.gate];
  const allowed = [...gateConfig.approvers, ...gateConfig.highRiskApprovers];
  const suggested = evaluation.missingRoles.map((value) => value.split(' | ')[0])
    .find((value) => allowed.includes(value));
  const role = input.as ?? suggested ?? gateConfig.approvers[0] ?? 'approver';
  const found: PreviewRefusal[] = [];
  if (allowed.length && !allowed.includes(role)) {
    const params = { role, gate: input.gate, p3: allowed.join(', ') };
    const key = 'error.role_x_does_not_approve_the_x_gate_roles_x';
    found.push(refusalOf(new SdlcError('invalid_role', { key, params })));
  }
  const identity = input.by ?? formatIdentity(gitIdentity(input.root));
  attempt(found, () => assertKnownDecider(input.config, role, identity));
  return found;
}

function assertKnownDecider(config: SdlcConfig, role: string, identity: string | undefined): void {
  if (!identity) {
    throw new SdlcError('no_identity', { key: 'error.cannot_tell_who_is_deciding_git_user_name_user_e' });
  }
  const members = config.roles[role] ?? [];
  if (members.length === 0 || members.some((m) => identity.toLowerCase().includes(m.toLowerCase()))) return;
  const params = { identity, role };
  throw new SdlcError('not_in_role', { key: 'error.x_is_not_listed_under_roles_x_in_openspec_sdlc_y', params });
}

/** The gate's artifact files: the planning artifacts it covers, or the review and release records. */
function gateArtifacts(view: LifecycleView, gate: ApprovalGateId): PreviewArtifact[] {
  if (gate === 'review' || gate === 'release') {
    const records = gate === 'review' ? ['review'] : ['review', 'release'];
    return records.filter((name) => fs.existsSync(path.join(view.dir, `${name}.md`)))
      .map((name) => ({ name, path: `${name}.md` }));
  }
  const covered = view.gates.find((item) => item.id === gate)?.artifacts ?? [];
  return view.artifacts.filter((artifact) => covered.includes(artifact.id))
    .flatMap((artifact) => artifact.files.map((file) => ({ name: artifact.id, path: file.replace(/\\/g, '/') })));
}

/** For intent and spec: the questions without a recorded answer, when there are any. */
function openQuestionsFact(input: PreviewInput, state: ChangeState): Partial<ApprovePreview> {
  const open = unansweredQuestions(input.ref.dir, state, input.gate);
  return open.length > 0 ? { openQuestions: open } : {};
}

/** For review and release: the open blocking findings and the verification evidence. */
function codeGateFacts(view: LifecycleView, gate: ApprovalGateId): Partial<ApprovePreview> {
  if (gate !== 'review' && gate !== 'release') return {};
  const status = view.verification?.status ?? 'never';
  const at = view.verification?.at;
  return {
    openFindings: view.review?.blocking ?? [],
    verification: { status, ...(at ? { at } : {}), fresh: status === 'passed' },
  };
}

/** Artifact files whose content differs from the gate's checkpoint (the approval's own stamp aside). */
function changedSinceCheckpoint(input: PreviewInput, artifacts: PreviewArtifact[]): string[] {
  const repo = repoPaths(input.root);
  if (!repo) return [];
  const ref = checkpointRef(input.ref.id, input.gate);
  if (!git(repo.top, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).ok) return [];
  const folder = path.relative(input.root, input.ref.dir).split(path.sep).join('/');
  return [...new Set(artifacts.map((artifact) => artifact.path))].filter((file) => {
    const saved = savedText(repo.top, `${ref}:${repo.prefix}${folder}/${file}`);
    const current = fs.readFileSync(path.join(input.ref.dir, file), 'utf-8');
    return saved === undefined || unstamped(saved) !== unstamped(current);
  });
}

function repoPaths(root: string): { top: string; prefix: string } | undefined {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  const prefix = git(root, ['rev-parse', '--show-prefix']);
  return top.ok && prefix.ok ? { top: top.stdout, prefix: prefix.stdout } : undefined;
}

/** A file of the checkpoint as it was on disk (the checkpoint is taken without line-ending conversion). */
function savedText(top: string, object: string): string | undefined {
  const raw = ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false'];
  const blob = spawnSync('git', [...raw, 'cat-file', '--filters', object],
    { cwd: top, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return blob.status === 0 ? blob.stdout : undefined;
}

/** Text without the provenance line an approval stamps, nor the trailing blank lines the stamp trims. */
function unstamped(text: string): string {
  return stripProvenance(text).replace(/\s+$/u, '');
}
