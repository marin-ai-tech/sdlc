import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { ApprovalGateId, GateId, SdlcConfig } from './config.js';
import {
  readChangeState,
  type ApprovalRecord,
  type ChangeState,
  type GateState,
} from './change-state.js';
import type { ChangeRef } from './changes.js';
import { digestFiles, withoutCheckboxState } from './digest.js';
import { isFile, readText } from './fs-utils.js';
import { isGitRepo, worktreeFingerprint } from './git.js';
import {
  computeArtifactStates,
  loadSchemaInfo,
  resolveChangeSchemaName,
  type ArtifactState,
  type SchemaInfo,
} from './openspec-schema.js';
import { parseFindings, summarizeFindings, type FindingSummary } from './review.js';
import { parseTasks, type TaskProgress } from './tasks.js';

/**
 * The six stages of Anthropic's AI-native SDLC playbook, plus the two terminal
 * states a change can be in. A change's stage is derived from its artifacts
 * and gate records every time; nothing stores "current stage", so a hand edit
 * or a git revert can never leave the recorded stage out of sync.
 */
export const STAGES = ['plan', 'design', 'build', 'test', 'deploy', 'maintain'] as const;
export type StageId = (typeof STAGES)[number] | 'done' | 'archived';

export const STAGE_TITLES: Record<StageId, string> = {
  plan: 'Plan (intent)',
  design: 'Design (requirements + design spec)',
  build: 'Build (plan + implementation)',
  test: 'Test (verification evidence)',
  deploy: 'Deploy (review + release)',
  maintain: 'Maintain (close the loop)',
  done: 'Done (ready to archive)',
  archived: 'Archived',
};

export const GATE_STAGE: Record<GateId, StageId> = {
  intent: 'plan',
  spec: 'design',
  plan: 'build',
  verify: 'test',
  review: 'deploy',
  release: 'deploy',
};

/** Files outside the planning home that do not invalidate verification or review. */
export const FINGERPRINT_EXCLUDES = ['openspec/'];

export type GateStatus =
  | 'n/a'
  | 'blocked'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'stale'
  | 'waived'
  | 'passed'
  | 'failed';

export interface GateEvaluation {
  id: GateId;
  stage: StageId;
  required: boolean;
  status: GateStatus;
  /** True when this gate does not hold the change back (approved, passed, waived, n/a, or optional). */
  satisfied: boolean;
  artifacts: string[];
  digest?: string;
  approvals: ApprovalRecord[];
  staleApprovals: ApprovalRecord[];
  missingRoles: string[];
  reason?: string;
}

export interface NextAction {
  actor: 'agent' | 'human' | 'none';
  action:
    | 'write-artifact'
    | 'revise-artifact'
    | 'validate'
    | 'approve-gate'
    | 'implement'
    | 'verify'
    | 'review'
    | 'fix-findings'
    | 'release'
    | 'archive'
    | 'none';
  /** Workflow id of the skill/command that performs the action (e.g. `spec`). */
  workflow?: string;
  gate?: GateId;
  artifact?: string;
  /** Exact CLI invocation, when the action is a CLI call. */
  cli?: string;
  message: string;
}

export interface LifecycleView {
  change: string;
  dir: string;
  archived: boolean;
  archivedAs?: string;
  schema: string;
  schemaSource: SchemaInfo['source'];
  kind: ChangeState['kind'];
  risk: ChangeState['risk'];
  track: ChangeState['track'];
  source?: ChangeState['source'];
  stage: StageId;
  stageTitle: string;
  artifacts: ArtifactState[];
  tasks: Omit<TaskProgress, 'tasks'> & { file?: string };
  gates: GateEvaluation[];
  review?: Omit<FindingSummary, 'blocking'> & { blocking: Array<{ id?: string; title: string; severity: string }> };
  verification?: {
    status: 'passed' | 'failed' | 'stale' | 'never';
    at?: string;
    commit?: string;
  };
  testsLocked: boolean;
  next: NextAction;
  warnings: string[];
}

/** Built-in artifact -> gate mapping, overridable per gate in sdlc.yaml. */
export function gateArtifacts(schema: SchemaInfo, config: SdlcConfig): Record<'intent' | 'spec' | 'plan', string[]> {
  const ids = schema.artifacts.map((a) => a.id);
  const pick = (gate: 'intent' | 'spec' | 'plan', fallback: string[]) =>
    (config.gates[gate].artifacts ?? fallback).filter((id) => ids.includes(id));
  const intent = pick('intent', ['intent']);
  const plan = pick('plan', ['plan', 'tasks']);
  const claimed = new Set([...intent, ...plan]);
  const spec = pick('spec', ids.filter((id) => !claimed.has(id)));
  return { intent, spec, plan };
}

function requiredRoles(config: SdlcConfig, gate: ApprovalGateId, state: ChangeState): {
  anyOf: string[];
  allOf: string[];
} {
  const g = config.gates[gate];
  return { anyOf: g.approvers, allOf: state.risk === 'high' ? g.highRiskApprovers : [] };
}

function latestTime(records: Array<{ at: string }>): string | undefined {
  return records.map((r) => r.at).sort().at(-1);
}

/**
 * Evaluates an approval gate against the digest of what it covers. Approvals
 * whose digest no longer matches are "stale": the approver signed off on
 * content that has since changed, so the gate needs a fresh approval.
 */
function evaluateApprovalGate(
  id: ApprovalGateId,
  config: SdlcConfig,
  state: ChangeState,
  gateState: GateState | undefined,
  digest: string | undefined,
  blockedReason: string | undefined,
  artifacts: string[],
  trustRecorded = false
): GateEvaluation {
  const required = config.gates[id].required && !(state.track === 'lite' && (id === 'intent' || id === 'spec'));
  const base = {
    id,
    stage: GATE_STAGE[id],
    required,
    artifacts,
    ...(digest ? { digest } : {}),
  };
  const all = gateState?.approvals ?? [];
  const valid = trustRecorded ? all : digest ? all.filter((a) => a.digest === digest) : [];
  const stale = trustRecorded ? [] : digest ? all.filter((a) => a.digest !== digest) : all;
  const roles = requiredRoles(config, id, state);
  const validRoles = new Set(valid.map((a) => a.role));
  const anySatisfied = roles.anyOf.length === 0 ? valid.length > 0 : roles.anyOf.some((r) => validRoles.has(r));
  const missingRoles = [
    ...(anySatisfied ? [] : roles.anyOf.length > 0 ? [roles.anyOf.join(' | ')] : ['any approver']),
    ...roles.allOf.filter((r) => !validRoles.has(r)),
  ];

  if (gateState?.waived) {
    return { ...base, status: 'waived', satisfied: true, approvals: valid, staleApprovals: stale, missingRoles: [],
      reason: `waived by ${gateState.waived.by}: ${gateState.waived.note}` };
  }
  if (blockedReason && !(trustRecorded && valid.length > 0)) {
    return { ...base, status: 'blocked', satisfied: !required, approvals: valid, staleApprovals: stale,
      missingRoles, reason: blockedReason };
  }
  const rejection = gateState?.rejection;
  const lastApproval = latestTime(valid);
  if (rejection && (!lastApproval || rejection.at > lastApproval)) {
    return { ...base, status: 'rejected', satisfied: !required, approvals: valid, staleApprovals: stale,
      missingRoles, reason: `rejected by ${rejection.by}${rejection.note ? `: ${rejection.note}` : ''}` };
  }
  if (missingRoles.length === 0) {
    return { ...base, status: 'approved', satisfied: true, approvals: valid, staleApprovals: stale, missingRoles };
  }
  if (stale.length > 0 && valid.length === 0) {
    return { ...base, status: 'stale', satisfied: !required, approvals: valid, staleApprovals: stale, missingRoles,
      reason: 'content changed after approval; re-approval needed' };
  }
  return { ...base, status: 'pending', satisfied: !required, approvals: valid, staleApprovals: stale, missingRoles,
    reason: `awaiting approval (${missingRoles.join(', ')})` };
}

export interface EvaluateOptions {
  /** Skip git fingerprinting (hooks call this on every edit and must stay fast). */
  skipFingerprint?: boolean;
  /**
   * A worktree fingerprint the caller already computed (null = not a git repo),
   * so evaluating many changes in one command indexes the worktree only once.
   */
  fingerprint?: string | null;
}

/** Computes the fingerprint once for callers that evaluate several changes. */
export function sharedFingerprint(root: string): string | null {
  return isGitRepo(root) ? worktreeFingerprint(root, FINGERPRINT_EXCLUDES) ?? null : null;
}

export function evaluateChange(
  root: string,
  ref: ChangeRef,
  config: SdlcConfig,
  options: EvaluateOptions = {}
): LifecycleView {
  const warnings: string[] = [];
  const state = readChangeState(ref.dir);
  const schemaName = resolveChangeSchemaName(ref.dir, root);
  const schema = loadSchemaInfo(schemaName, root);
  const artifacts = computeArtifactStates(schema, ref.dir);
  const byId = new Map(artifacts.map((a) => [a.id, a]));
  const mapping = gateArtifacts(schema, config);

  // Task progress follows the schema's apply.tracks file (tasks.md by default).
  const tracks = schema.apply?.tracks ?? 'tasks.md';
  const tasksFile = path.join(ref.dir, tracks);
  const taskProgress = isFile(tasksFile) ? parseTasks(readText(tasksFile) ?? '') : undefined;
  const tasks = taskProgress
    ? { total: taskProgress.total, complete: taskProgress.complete, remaining: taskProgress.remaining, file: tracks }
    : { total: 0, complete: 0, remaining: 0 };

  const coveredFiles = (ids: string[]) => ids.flatMap((id) => byId.get(id)?.files ?? []);
  const missingOf = (ids: string[]) => ids.filter((id) => {
    const s = byId.get(id)?.status;
    return s !== 'done' && s !== 'skipped';
  });

  const gates: GateEvaluation[] = [];
  // Freshness only matters for active work; an archived change keeps its recorded results.
  const skip = options.skipFingerprint || ref.archived;
  const fingerprint = skip
    ? undefined
    : options.fingerprint !== undefined
      ? options.fingerprint ?? undefined
      : isGitRepo(root) ? worktreeFingerprint(root, FINGERPRINT_EXCLUDES) : undefined;

  // Planning gates: intent, spec, plan.
  let upstreamOpen: string | undefined;
  for (const id of ['intent', 'spec', 'plan'] as const) {
    const covered = mapping[id];
    if (covered.length === 0) {
      gates.push({ id, stage: GATE_STAGE[id], required: false, status: 'n/a', satisfied: true,
        artifacts: [], approvals: [], staleApprovals: [], missingRoles: [],
        reason: `schema '${schema.name}' has no artifacts for this gate` });
      continue;
    }
    const missing = missingOf(covered);
    const blockedReason = missing.length > 0
      ? `missing artifacts: ${missing.join(', ')}`
      : upstreamOpen;
    const digest = missing.length === 0
      ? digestFiles(ref.dir, coveredFiles(covered), (rel, content) => (rel === tracks ? withoutCheckboxState(content) : content))
      : undefined;
    const evaluation = evaluateApprovalGate(id, config, state, state.gates[id], digest, blockedReason, covered, ref.archived);
    gates.push(evaluation);
    if (!evaluation.satisfied && !upstreamOpen) upstreamOpen = `waiting on the ${id} gate`;
  }

  // Verify gate: deterministic evidence from `sdlc verify`, bound to the worktree fingerprint.
  const verifyRequired = config.gates.verify.required;
  let verification: LifecycleView['verification'] = { status: 'never' };
  if (state.verify) {
    const fresh = ref.archived || !fingerprint || !state.verify.fingerprint || state.verify.fingerprint === fingerprint;
    verification = {
      status: state.verify.status === 'passed' ? (fresh ? 'passed' : 'stale') : 'failed',
      at: state.verify.at,
      ...(state.verify.commit ? { commit: state.verify.commit } : {}),
    };
    // Fast mode cannot fingerprint the worktree; trust the last recorded result.
    if (options.skipFingerprint && state.verify.status === 'passed') verification.status = 'passed';
  }
  {
    let status: GateStatus;
    let reason: string | undefined;
    const waiver = state.gates.verify?.waived;
    if (waiver) {
      status = 'waived';
      reason = `waived by ${waiver.by}: ${waiver.note}`;
    } else if (upstreamOpen) {
      status = 'blocked';
      reason = upstreamOpen;
    } else if (!taskProgress && schema.apply) {
      status = 'blocked';
      reason = `no ${tracks} to track implementation`;
    } else if (tasks.remaining > 0) {
      status = 'blocked';
      reason = `${tasks.remaining} task(s) still open in ${tracks}`;
    } else if (verification.status === 'passed') {
      status = 'passed';
    } else if (verification.status === 'stale') {
      status = 'stale';
      reason = 'code changed since the last passing `sdlc verify`';
    } else if (verification.status === 'failed') {
      status = 'failed';
      reason = 'last `sdlc verify` run failed';
    } else {
      status = 'pending';
      reason = config.verify.commands.length === 0
        ? 'no verification commands configured (verify.commands in openspec/sdlc.yaml)'
        : 'run `sdlc verify`';
    }
    const satisfied = status === 'passed' || status === 'waived' || !verifyRequired;
    gates.push({ id: 'verify', stage: 'test', required: verifyRequired, status, satisfied, artifacts: [],
      approvals: [], staleApprovals: [], missingRoles: [], ...(reason ? { reason } : {}) });
    if (!satisfied && !upstreamOpen) upstreamOpen = 'waiting on the verify gate';
  }

  // Review gate: findings in review.md + human code-owner approval bound to code + review record.
  const reviewFile = path.join(ref.dir, 'review.md');
  let review: LifecycleView['review'];
  let reviewBlocked: string | undefined = upstreamOpen;
  if (isFile(reviewFile)) {
    const summary = summarizeFindings(parseFindings(readText(reviewFile) ?? ''), config.review.blockOn);
    review = {
      total: summary.total,
      open: summary.open,
      bySeverity: summary.bySeverity,
      byPass: summary.byPass,
      blocking: summary.blocking.map((f) => ({ ...(f.id ? { id: f.id } : {}), title: f.title, severity: f.severity })),
    };
    if (!reviewBlocked && summary.blocking.length > 0) {
      reviewBlocked = `${summary.blocking.length} open blocking finding(s) in review.md`;
    }
  } else if (!reviewBlocked) {
    reviewBlocked = 'no review.md yet (run the review workflow)';
  }
  // Review and release approvals are bound to the code under review (worktree
  // fingerprint) plus the record files, so any later code change makes them stale.
  const codeDigest = (extra: string[]): string | undefined => {
    if (options.skipFingerprint) return undefined;
    const files = extra.filter((f) => isFile(path.join(ref.dir, f)));
    return `sha256:${createHash('sha256')
      .update(fingerprint ?? 'no-git')
      .update('\0')
      .update(digestFiles(ref.dir, files))
      .digest('hex')}`;
  };
  const fastModeReason = options.skipFingerprint ? 'not evaluated in fast mode' : undefined;
  const reviewEval = evaluateApprovalGate('review', config, state, state.gates.review,
    codeDigest(['review.md']), fastModeReason ?? reviewBlocked, [], ref.archived);
  gates.push(reviewEval);
  if (!reviewEval.satisfied && !upstreamOpen) upstreamOpen = 'waiting on the review gate';

  const releaseEval = evaluateApprovalGate('release', config, state, state.gates.release,
    codeDigest(['review.md', 'release.md']), fastModeReason ?? upstreamOpen, [], ref.archived);
  gates.push(releaseEval);

  if (!fingerprint && !options.skipFingerprint && !ref.archived) {
    warnings.push('not a git repository: verification and review freshness cannot be checked');
  }

  const stage = deriveStage(ref, gates, tasks);
  const view: LifecycleView = {
    change: ref.id,
    dir: ref.dir,
    archived: ref.archived,
    ...(ref.archivedAs ? { archivedAs: ref.archivedAs } : {}),
    schema: schema.name,
    schemaSource: schema.source,
    kind: state.kind,
    risk: state.risk,
    track: state.track,
    ...(state.source ? { source: state.source } : {}),
    stage,
    stageTitle: STAGE_TITLES[stage],
    artifacts,
    tasks,
    gates,
    ...(review ? { review } : {}),
    verification,
    testsLocked: state.tests_locked === true,
    next: { actor: 'none', action: 'none', message: '' },
    warnings,
  };
  view.next = nextAction(view, config, mapping);
  return view;
}

function deriveStage(ref: ChangeRef, gates: GateEvaluation[], tasks: { remaining: number; total: number }): StageId {
  if (ref.archived) return 'archived';
  const open = gates.find((g) => !g.satisfied);
  if (!open) return 'done';
  if (open.id === 'intent') return 'plan';
  if (open.id === 'spec') return 'design';
  if (open.id === 'plan') return 'build';
  if (open.id === 'verify') return tasks.remaining > 0 || tasks.total === 0 ? 'build' : 'test';
  return 'deploy';
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a product-owner", "an engineer" - roles read as nouns in next-step messages. */
function withArticle(roles: string[]): string {
  const text = roles.join(', ');
  return `${/^[aeiou]/i.test(text) ? 'an' : 'a'} ${text}`;
}

function gate(view: LifecycleView, id: GateId): GateEvaluation {
  return view.gates.find((g) => g.id === id)!;
}

export function approveCli(change: string, gateId: GateId, role?: string): string {
  return `sdlc approve ${gateId} --change ${change}${role ? ` --as ${role}` : ''}`;
}

function nextAction(
  view: LifecycleView,
  config: SdlcConfig,
  mapping: Record<'intent' | 'spec' | 'plan', string[]>
): NextAction {
  if (view.archived) return { actor: 'none', action: 'none', message: 'Change is archived.' };
  const art = new Map(view.artifacts.map((a) => [a.id, a]));
  const firstMissing = (ids: string[]) =>
    ids.map((id) => art.get(id)).find((a) => a && a.status !== 'done' && a.status !== 'skipped');

  for (const id of ['intent', 'spec', 'plan'] as const) {
    const g = gate(view, id);
    if (g.satisfied) continue;
    const workflow = id;
    const missing = firstMissing(mapping[id]);
    if (missing) {
      return {
        actor: 'agent', action: 'write-artifact', workflow, artifact: missing.id,
        cli: `sdlc instructions ${missing.id} --change ${view.change} --json`,
        message: `Write ${missing.id} (${missing.generates}) for the ${id} gate.`,
      };
    }
    if (g.status === 'rejected') {
      return { actor: 'agent', action: 'revise-artifact', workflow, gate: id,
        message: `The ${id} gate was ${g.reason}. Revise the ${mapping[id].join(', ')} artifact(s), then ask for approval again.` };
    }
    const role = g.missingRoles[0]?.split(' | ')[0];
    return {
      actor: 'human', action: 'approve-gate', gate: id, workflow,
      cli: approveCli(view.change, id, role && role !== 'any approver' ? role : undefined),
      message: g.status === 'stale'
        ? `The ${id} artifacts changed after approval; ${withArticle(g.missingRoles)} must re-approve.`
        : `${capitalize(withArticle(g.missingRoles))} must review and approve the ${id} gate (${mapping[id].join(', ')}).`,
    };
  }

  const verify = gate(view, 'verify');
  if (!verify.satisfied) {
    if (view.tasks.remaining > 0 || view.tasks.total === 0) {
      return { actor: 'agent', action: 'implement', workflow: 'build',
        message: view.tasks.total === 0
          ? 'Implement the approved plan (no tasks tracked yet).'
          : `Implement the approved plan: ${view.tasks.remaining} of ${view.tasks.total} task(s) remain.` };
    }
    return { actor: 'agent', action: 'verify', workflow: 'verify', cli: `sdlc verify --change ${view.change}`,
      message: verify.status === 'failed'
        ? 'Verification failed: fix the code (not the tests), then run `sdlc verify` again.'
        : verify.status === 'stale'
          ? 'Code changed since the last passing verification: run `sdlc verify` again.'
          : 'Run the verification loop and record the evidence with `sdlc verify`.' };
  }

  const review = gate(view, 'review');
  if (!review.satisfied) {
    if (!view.review) {
      return { actor: 'agent', action: 'review', workflow: 'review',
        message: 'Run the multi-pass review (bugs, security, compliance with spec and plan) and record findings in review.md.' };
    }
    if (view.review.blocking.length > 0) {
      return { actor: 'agent', action: 'fix-findings', workflow: 'review',
        message: `Address ${view.review.blocking.length} open blocking finding(s) in review.md, re-verify, and update their status.` };
    }
    return { actor: 'human', action: 'approve-gate', gate: 'review', workflow: 'review',
      cli: approveCli(view.change, 'review'),
      message: review.status === 'stale'
        ? 'Code or review.md changed after review approval. A code owner must re-approve.'
        : 'A code owner must read review.md and the diff, then approve the review gate.' };
  }

  const release = gate(view, 'release');
  if (config.gates.release.required && !release.satisfied) {
    if (!isFile(path.join(view.dir, 'release.md'))) {
      return { actor: 'agent', action: 'release', workflow: 'release',
        message: 'Prepare release.md (rollout, rollback, monitoring) for release authorization.' };
    }
    return { actor: 'human', action: 'approve-gate', gate: 'release', workflow: 'release',
      cli: approveCli(view.change, 'release'),
      message: 'A release manager must authorize the release.' };
  }

  return { actor: 'agent', action: 'archive', workflow: 'archive', cli: `sdlc archive ${view.change} --yes`,
    message: 'All gates are satisfied: archive the change to merge its delta specs into openspec/specs/.' };
}
