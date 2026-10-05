import { createHash } from 'node:crypto';
import * as path from 'node:path';
import type { ApprovalGateId, GateId, SdlcConfig } from './config.js';
import {
  readChangeState,
  type ApprovalRecord,
  type ChangeState,
  type GateState,
  type TakeoverRecord,
} from './change-state.js';
import { t, type MessageParams } from './i18n.js';
import type { ChangeRef } from './changes.js';
import { digestFiles, withoutCheckboxState } from './digest.js';
import { readDeferred } from './deferred.js';
import { isFile, readText } from './fs-utils.js';
import { isGitRepo, worktreeFingerprint } from './git.js';
import {
  computeArtifactStates,
  loadSchemaInfo,
  resolveChangeSchemaName,
  type ArtifactState,
  type SchemaInfo,
} from './openspec-schema.js';
import { takeoverNext } from './takeover.js';
import { checkCoverage, parseCoverage, parseFindings, summarizeFindings, type FindingSummary } from './review.js';
import { parseTasks, type TaskProgress } from './tasks.js';
import { awaitedRoles, awaitingReason, quorum } from './approval-quorum.js';
import { nameApprovers, type NamedApprover } from './named-approvers.js';
import { effectiveGates, markReworks } from './rework.js';

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
  /** Approval gates: how many different people must approve (`min_approvals`, default 1). */
  minApprovals?: number;
  reason?: string;
  /** Catalog key for localized status text; reason stays English. */
  reasonKey?: string;
  /** Params for the catalog key (locale-independent). */
  reasonParams?: Record<string, string | number>;
  /** The rework that sent the change back to this gate, while it holds (`sdlc rework`). */
  rework?: { reason: string; note: string; by: string; at: string };
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
    /** No active change: start the first ready backlog item (`sdlc backlog start`). */
    | 'start-backlog-item'
    /** A person took the change over (`sdlc takeover`); it is theirs until `sdlc release-control`. */
    | 'taken-over'
    | 'none';
  /** Workflow id of the skill/command that performs the action (e.g. `spec`). */
  workflow?: string;
  gate?: GateId;
  artifact?: string;
  /** Exact CLI invocation, when the action is a CLI call. */
  cli?: string;
  message: string;
  /** Catalog key for localized Next text; message stays English. */
  key?: string;
  /** Params for the catalog key (locale-independent). */
  params?: MessageParams;
  /** With openspec/roles.yaml, an approve-gate step: the people who may take the decision now. */
  people?: NamedApprover[];
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
  trackSuggestion?: ChangeState['track_suggestion'];
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
  /** Set while a person holds the change (`sdlc takeover`). */
  takeover?: TakeoverRecord;
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

interface LocalizedReason {
  reason: string;
  reasonKey: string;
  reasonParams?: Record<string, string | number>;
}

function lr(key: string, params: Record<string, string | number> = {}): LocalizedReason {
  return {
    reason: t(key, params, 'en'),
    reasonKey: key,
    ...(Object.keys(params).length > 0 ? { reasonParams: params } : {}),
  };
}

function withLocalizedReason<T extends object>(base: T, info: LocalizedReason): T & LocalizedReason {
  return { ...base, ...info };
}

function evaluateApprovalGate(
  id: ApprovalGateId,
  config: SdlcConfig,
  state: ChangeState,
  gateState: GateState | undefined,
  digest: string | undefined,
  blocked: LocalizedReason | undefined,
  artifacts: string[],
  trustRecorded = false
): GateEvaluation {
  const required = config.gates[id].required && !(state.track === 'lite' && (id === 'intent' || id === 'spec'));
  const all = gateState?.approvals ?? [];
  const valid = trustRecorded ? all : digest ? all.filter((a) => a.digest === digest) : [];
  const q = quorum(valid, config.gates[id]);
  const base = { id, stage: GATE_STAGE[id], required, artifacts, minApprovals: q.min, ...(digest ? { digest } : {}) };
  const stale = trustRecorded ? [] : digest ? all.filter((a) => a.digest !== digest) : all;
  const roles = requiredRoles(config, id, state);
  const validRoles = new Set(valid.map((a) => a.role));
  const anySatisfied = roles.anyOf.length === 0 ? valid.length > 0 : roles.anyOf.some((r) => validRoles.has(r));
  const missingRoles = [
    ...(anySatisfied ? [] : roles.anyOf.length > 0 ? [roles.anyOf.join(' | ')] : ['any approver']),
    ...roles.allOf.filter((r) => !validRoles.has(r)),
  ];

  const open = { approvals: valid, staleApprovals: stale, missingRoles };
  if (gateState?.waived) {
    const info = lr('gate.waived', { by: gateState.waived.by, note: gateState.waived.note });
    return withLocalizedReason(
      { ...base, status: 'waived' as const, satisfied: true, ...open, missingRoles: [] },
      info,
    );
  }
  if (blocked && !(trustRecorded && valid.length > 0)) {
    return withLocalizedReason(
      { ...base, status: 'blocked' as const, satisfied: !required, ...open },
      blocked,
    );
  }
  const rejection = gateState?.rejection;
  const lastApproval = latestTime(valid);
  if (rejection && (!lastApproval || rejection.at > lastApproval)) {
    const info = rejection.note
      ? lr('gate.rejectedNote', { by: rejection.by, note: rejection.note })
      : lr('gate.rejected', { by: rejection.by });
    return withLocalizedReason(
      { ...base, status: 'rejected' as const, satisfied: !required, ...open },
      info,
    );
  }
  if (missingRoles.length === 0 && q.met) {
    return { ...base, status: 'approved', satisfied: true, ...open };
  }
  if (stale.length > 0 && valid.length === 0) {
    return withLocalizedReason(
      { ...base, status: 'stale' as const, satisfied: !required, ...open },
      lr('gate.stale'),
    );
  }
  const awaiting = lr(...awaitingReason(missingRoles, q));
  return withLocalizedReason(
    { ...base, status: 'pending' as const, satisfied: !required, ...open },
    awaiting,
  );
}

export interface EvaluateOptions {
  /** Skip git fingerprinting (hooks call this on every edit and must stay fast). */
  skipFingerprint?: boolean;
  /**
   * A worktree fingerprint the caller already computed (null = not a git repo),
   * so evaluating many changes in one command indexes the worktree only once.
   */
  fingerprint?: string | null;
  /** Leave out the names of the people who may take the next decision (the hook does not show them). */
  skipPeople?: boolean;
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
  const decided = effectiveGates(state);
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
  let upstreamOpen: LocalizedReason | undefined;
  for (const id of ['intent', 'spec', 'plan'] as const) {
    const covered = mapping[id];
    if (covered.length === 0) {
      gates.push(withLocalizedReason(
        { id, stage: GATE_STAGE[id], required: false, status: 'n/a' as const, satisfied: true,
          artifacts: [], approvals: [], staleApprovals: [], missingRoles: [] },
        lr('gate.noArtifacts', { schema: schema.name }),
      ));
      continue;
    }
    const missing = missingOf(covered);
    const blocked = missing.length > 0
      ? lr('gate.missingArtifacts', { artifacts: missing.join(', ') })
      : upstreamOpen;
    const digest = missing.length === 0
      ? digestFiles(ref.dir, coveredFiles(covered), (rel, content) => (rel === tracks ? withoutCheckboxState(content) : content))
      : undefined;
    const evaluation = evaluateApprovalGate(id, config, state, decided[id], digest, blocked, covered, ref.archived);
    gates.push(evaluation);
    if (!evaluation.satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: id });
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
    let info: LocalizedReason | undefined;
    const waiver = decided.verify?.waived;
    if (waiver) {
      status = 'waived';
      info = lr('gate.waived', { by: waiver.by, note: waiver.note });
    } else if (upstreamOpen) {
      status = 'blocked';
      info = upstreamOpen;
    } else if (!taskProgress && schema.apply) {
      status = 'blocked';
      info = lr('gate.noTasksFile', { file: tracks });
    } else if (tasks.remaining > 0) {
      status = 'blocked';
      info = lr('gate.tasksOpen', { remaining: tasks.remaining, file: tracks });
    } else if (verification.status === 'passed') {
      status = 'passed';
    } else if (verification.status === 'stale') {
      status = 'stale';
      info = lr('gate.verifyStale');
    } else if (verification.status === 'failed') {
      status = 'failed';
      info = lr('gate.verifyFailed');
    } else {
      status = 'pending';
      info = config.verify.commands.length === 0
        ? lr('gate.verifyNoCommands')
        : lr('gate.verifyRun');
    }
    const satisfied = status === 'passed' || status === 'waived' || !verifyRequired;
    const verifyBase = {
      id: 'verify' as const, stage: 'test' as const, required: verifyRequired, status, satisfied,
      artifacts: [] as string[], approvals: [], staleApprovals: [], missingRoles: [] as string[],
    };
    gates.push(info ? withLocalizedReason(verifyBase, info) : verifyBase);
    if (!satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: 'verify' });
  }

  // Review gate: findings in review.md + human code-owner approval bound to code + review record.
  const reviewFile = path.join(ref.dir, 'review.md');
  let review: LifecycleView['review'];
  let reviewBlocked: LocalizedReason | undefined = upstreamOpen;
  if (isFile(reviewFile)) {
    const content = readText(reviewFile) ?? '';
    const findings = parseFindings(content);
    const summary = summarizeFindings(findings, config.review.blockOn);
    review = {
      total: summary.total,
      open: summary.open,
      bySeverity: summary.bySeverity,
      byPass: summary.byPass,
      blocking: summary.blocking.map((f) => ({ ...(f.id ? { id: f.id } : {}), title: f.title, severity: f.severity })),
    };
    if (!reviewBlocked && summary.blocking.length > 0) {
      reviewBlocked = lr('gate.reviewBlocking', { count: summary.blocking.length });
    }
    const coverage = checkCoverage(findings, parseCoverage(content), [...config.review.passes, ...config.review.lenses]);
    if (!reviewBlocked && config.review.requireLensCoverage && (coverage.missing.length || coverage.unchecked.length)) {
      reviewBlocked = lr('gate.reviewCoverage', {
        missing: coverage.missing.join(', '),
        unchecked: coverage.unchecked.join(', '),
      });
    }
    const knownDeferred = new Set(readDeferred(root).map((item) => item.id));
    const missingDeferred = findings
      .filter((finding) => finding.deferredTo && !knownDeferred.has(finding.deferredTo))
      .map((finding) => finding.deferredTo);
    if (!reviewBlocked && missingDeferred.length) {
      reviewBlocked = lr('gate.missingDeferred', { ids: missingDeferred.join(', ') });
    }
  } else if (!reviewBlocked) {
    reviewBlocked = lr('gate.noReview');
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
  const fastModeReason = options.skipFingerprint ? lr('gate.fastMode') : undefined;
  const reviewEval = evaluateApprovalGate('review', config, state, decided.review,
    codeDigest(['review.md']), fastModeReason ?? reviewBlocked, [], ref.archived);
  gates.push(reviewEval);
  if (!reviewEval.satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: 'review' });

  const releaseEval = evaluateApprovalGate('release', config, state, decided.release,
    codeDigest(['review.md', 'release.md']), fastModeReason ?? upstreamOpen, [], ref.archived);
  gates.push(releaseEval);

  if (!fingerprint && !options.skipFingerprint && !ref.archived) {
    warnings.push('not a git repository: verification and review freshness cannot be checked');
  }

  const evaluated = markReworks(gates, state);
  const stage = deriveStage(ref, evaluated, tasks);
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
    ...(state.track_suggestion ? { trackSuggestion: state.track_suggestion } : {}),
    ...(state.source ? { source: state.source } : {}),
    stage,
    stageTitle: STAGE_TITLES[stage],
    artifacts,
    tasks,
    gates: evaluated,
    ...(review ? { review } : {}),
    verification,
    testsLocked: state.tests_locked === true,
    ...(state.takeover ? { takeover: state.takeover } : {}),
    next: { actor: 'none', action: 'none', message: '' },
    warnings: state.track_suggestion
      ? [...warnings, `Track ${state.track_suggestion.track} suggested; confirm with \`${config.cli} track set ${state.track_suggestion.track} --change ${ref.id}\`.`]
      : warnings,
  };
  // A change a person has taken over waits for them; otherwise the next step names the people who may act.
  const held = ref.archived ? undefined : takeoverNext(state, ref.id);
  const next = held ?? nextAction(view, config, mapping);
  view.next = held || options.skipPeople ? next : nameApprovers(root, config, view, state, next);
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
  const withKey = (
    action: Omit<NextAction, 'message' | 'key' | 'params'>,
    key: string,
    params: Record<string, string | number> = {},
  ): NextAction => ({
    ...action,
    key,
    params,
    message: t(key, params, 'en'),
  });

  if (view.archived) return withKey({ actor: 'none', action: 'none' }, 'next.archived');
  const art = new Map(view.artifacts.map((a) => [a.id, a]));
  const firstMissing = (ids: string[]) =>
    ids.map((id) => art.get(id)).find((a) => a && a.status !== 'done' && a.status !== 'skipped');

  for (const id of ['intent', 'spec', 'plan'] as const) {
    const g = gate(view, id);
    if (g.satisfied) continue;
    const workflow = id;
    const missing = firstMissing(mapping[id]);
    if (missing) {
      return withKey(
        {
          actor: 'agent', action: 'write-artifact', workflow, artifact: missing.id,
          cli: `sdlc instructions ${missing.id} --change ${view.change} --json`,
        },
        'next.writeArtifact',
        { artifact: missing.id, file: missing.generates, gate: id },
      );
    }
    if (g.status === 'rejected') {
      return withKey(
        { actor: 'agent', action: 'revise-artifact', workflow, gate: id },
        'next.reviseArtifact',
        { gate: id, reason: g.reason ?? '', artifacts: mapping[id].join(', ') },
      );
    }
    const awaited = awaitedRoles(g.missingRoles, config.gates[id]);
    const role = awaited[0]?.split(' | ')[0];
    const who = g.status === 'stale' ? withArticle(awaited) : capitalize(withArticle(awaited));
    return withKey(
      {
        actor: 'human', action: 'approve-gate', gate: id, workflow,
        cli: approveCli(view.change, id, role && role !== 'any approver' ? role : undefined),
      },
      g.status === 'stale' ? 'next.reapprove' : 'next.approve',
      // `who` is English with an article; `roles` is the bare list other languages build their own sentence from.
      { gate: id, who, roles: awaited.join(', '), artifacts: mapping[id].join(', ') },
    );
  }

  const verify = gate(view, 'verify');
  if (!verify.satisfied) {
    if (view.tasks.remaining > 0 || view.tasks.total === 0) {
      if (view.tasks.total === 0) {
        return withKey(
          { actor: 'agent', action: 'implement', workflow: 'build' },
          'next.implementNone',
        );
      }
      return withKey(
        { actor: 'agent', action: 'implement', workflow: 'build' },
        'next.implementRemain',
        { remaining: view.tasks.remaining, total: view.tasks.total },
      );
    }
    const verifyKey = verify.status === 'failed'
      ? 'next.verifyFailed'
      : verify.status === 'stale'
        ? 'next.verifyStale'
        : 'next.verifyRun';
    return withKey(
      { actor: 'agent', action: 'verify', workflow: 'verify', cli: `sdlc verify --change ${view.change}` },
      verifyKey,
    );
  }

  const review = gate(view, 'review');
  if (!review.satisfied) {
    if (!view.review) {
      return withKey(
        { actor: 'agent', action: 'review', workflow: 'review' },
        'next.reviewRun',
      );
    }
    if (view.review.blocking.length > 0) {
      return withKey(
        { actor: 'agent', action: 'fix-findings', workflow: 'review' },
        'next.fixFindings',
        { count: view.review.blocking.length },
      );
    }
    return withKey(
      {
        actor: 'human', action: 'approve-gate', gate: 'review', workflow: 'review',
        cli: approveCli(view.change, 'review'),
      },
      review.status === 'stale' ? 'next.reviewReapprove' : 'next.reviewApprove',
    );
  }

  const release = gate(view, 'release');
  if (config.gates.release.required && !release.satisfied) {
    if (!isFile(path.join(view.dir, 'release.md'))) {
      return withKey(
        { actor: 'agent', action: 'release', workflow: 'release' },
        'next.releasePrepare',
      );
    }
    return withKey(
      {
        actor: 'human', action: 'approve-gate', gate: 'release', workflow: 'release',
        cli: approveCli(view.change, 'release'),
      },
      'next.releaseApprove',
    );
  }

  return withKey(
    {
      actor: 'agent', action: 'archive', workflow: 'archive',
      cli: `sdlc archive ${view.change} --yes`,
    },
    'next.archive',
  );
}
