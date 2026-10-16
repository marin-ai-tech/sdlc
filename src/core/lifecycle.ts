import * as path from 'node:path';
import type { GateId, SdlcConfig } from './config.js';
import {
  readChangeState,
  type ApprovalRecord,
  type ChangeState,
  type TakeoverRecord,
} from './change-state.js';
import { t, type MessageParams } from './i18n.js';
import type { ChangeRef } from './changes.js';
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
import type { FindingSummary } from './review.js';
import { parseTasks, type TaskProgress } from './tasks.js';
import { nameApprovers, type NamedApprover } from './named-approvers.js';
import { effectiveGates, markReworks, revisedGates } from './rework.js';
import { markAutoWaived, withAutoWaive } from './auto-waive.js';
import { reworkLimitNext } from './rework-limit.js';
import { questionsNext } from './questions-next.js';
import { draftIntentNext } from './draft-intent-next.js';
import { debateNext } from './debate-next.js';
import { judgeNext } from './judge-gate.js';
import { evaluateQaGate } from './qa-gate.js';
import { verifyBehaviourNext } from './verify-behaviour.js';
import { codeDigest, lr } from './approval-gate.js';
import { evaluatePlanningGates } from './planning-gates.js';
import { evaluateVerifyGate } from './verify-gate.js';
import { evaluateReviewGate } from './review-gate.js';
import { evaluateReleaseGate } from './release-gate.js';
import { nextAction } from './next-action.js';
import { markOpenRejections, openRejectionNotes } from './open-rejections.js';
import { STAGE_TITLES, type StageId } from './stages.js';

export { STAGES, STAGE_TITLES, GATE_STAGE } from './stages.js';
export type { StageId } from './stages.js';
export { approveCli } from './next-action.js';

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
    /** A gate reached `rework.max_cycles` (B61): a person takes the change over or reviews its scope. */
    | 'review-scope'
    /** Open questions of the intent or spec gate wait for a person's answer (B62): `sdlc answer`. */
    | 'answer-questions'
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
  rejectionNotes?: string;
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
  /** Show the qa gate even when the project does not require it (the qa decisions: approve, reject, rework). */
  withQa?: boolean;
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
  const decided = ref.archived ? effectiveGates(state) : withAutoWaive(effectiveGates(state), state, config);
  const schemaName = resolveChangeSchemaName(ref.dir, root);
  const schema = loadSchemaInfo(schemaName, root);
  const artifacts = computeArtifactStates(schema, ref.dir);
  const mapping = gateArtifacts(schema, config);

  // Task progress follows the schema's apply.tracks file (tasks.md by default).
  const tracks = schema.apply?.tracks ?? 'tasks.md';
  const tasksFile = path.join(ref.dir, tracks);
  const taskProgress = isFile(tasksFile) ? parseTasks(readText(tasksFile) ?? '') : undefined;
  const tasks = taskProgress
    ? { total: taskProgress.total, complete: taskProgress.complete, remaining: taskProgress.remaining, file: tracks }
    : { total: 0, complete: 0, remaining: 0 };

  const gates: GateEvaluation[] = [];
  // Freshness only matters for active work; an archived change keeps its recorded results.
  const skip = options.skipFingerprint || ref.archived;
  const fingerprint = skip
    ? undefined
    : options.fingerprint !== undefined
      ? options.fingerprint ?? undefined
      : isGitRepo(root) ? worktreeFingerprint(root, FINGERPRINT_EXCLUDES) : undefined;

  // Planning gates: intent, spec, plan (planning-gates.ts).
  const planning = evaluatePlanningGates(ref, config, state, decided, schema, mapping, artifacts, tracks);
  gates.push(...planning.gates);
  let upstreamOpen = planning.upstreamOpen;

  // Verify gate: deterministic evidence from `sdlc verify`, bound to the worktree fingerprint.
  const verifyGate = evaluateVerifyGate({
    ref, config, state, decided: decided.verify, fingerprint,
    skipFingerprint: options.skipFingerprint, schema, tracks, taskProgress,
    remaining: tasks.remaining, upstreamOpen,
  });
  gates.push(verifyGate.evaluation);
  upstreamOpen = verifyGate.upstreamOpen;

  // QA gate (B110): optional; a person accepts the verification evidence (qa-gate.ts).
  const qaEval = evaluateQaGate(ref, config, state, decided.qa, upstreamOpen, options);
  if (qaEval) gates.push(qaEval);
  if (qaEval && !qaEval.satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: 'qa' });

  // Fast readers cannot check freshness. Keep recorded approvals provisional, while still honoring current blockers.
  const trustRecorded = ref.archived || options.skipFingerprint === true;
  const digestFor = (extra: string[]): string | undefined =>
    options.skipFingerprint ? undefined : codeDigest(ref.dir, fingerprint, extra);

  // Review gate: findings in review.md + human code-owner approval bound to code + review record.
  const reviewGate = evaluateReviewGate(root, ref.dir, config, state, decided.review,
    digestFor(['review.md']), upstreamOpen, trustRecorded, ref.archived);
  gates.push(reviewGate.evaluation);
  if (!reviewGate.evaluation.satisfied && !upstreamOpen) upstreamOpen = lr('gate.waitingOn', { gate: 'review' });

  const releaseEval = evaluateReleaseGate(config, state, decided.release,
    digestFor(['review.md', 'release.md']), upstreamOpen, trustRecorded, ref.archived);
  gates.push(releaseEval);

  if (!fingerprint && !options.skipFingerprint && !ref.archived) {
    warnings.push('not a git repository: verification and review freshness cannot be checked');
  }

  const evaluated = markOpenRejections(
    markAutoWaived(markReworks(revisedGates(gates, state, config), state), state, config), state,
  );
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
    ...(reviewGate.review ? { review: reviewGate.review } : {}),
    verification: verifyGate.verification,
    testsLocked: state.tests_locked === true,
    ...(state.takeover ? { takeover: state.takeover } : {}),
    next: { actor: 'none', action: 'none', message: '' },
    warnings: state.track_suggestion
      ? [...warnings, `Track ${state.track_suggestion.track} suggested; confirm with \`${config.cli} track set ${state.track_suggestion.track} --change ${ref.id}\`.`]
      : warnings,
  };
  // A change a person has taken over waits for them; otherwise the next step names the people who may act.
  const held = ref.archived ? undefined : takeoverNext(state, ref.id);
  const limit = held ? undefined : reworkLimitNext(root, config, view, state, options.skipPeople);
  const advice = nextAction(view, config, mapping, state);
  const next = held ?? limit ?? questionsNext(view, config, state,
    judgeNext(view, config, state,
      debateNext(view, config, draftIntentNext(view, verifyBehaviourNext(view, advice)))));
  view.next = held || options.skipPeople ? next : nameApprovers(root, config, view, state, next);
  // A rejection at the current stage is already in the hint itself; only the others are added.
  const inHint = (note: string) => view.next.message.includes(note.slice(note.indexOf(': ') + 2));
  const rejectionNotes = openRejectionNotes(evaluated).filter((note) => !inHint(note));
  if (rejectionNotes.length) {
    view.next.rejectionNotes = rejectionNotes.join('; ');
    view.next.message += ` ${t('next.openRejections', { notes: view.next.rejectionNotes }, 'en')}`;
  }
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
  if (open.id === 'qa') return 'test';
  return 'deploy';
}
