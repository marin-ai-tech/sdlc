import type { ChangeRef } from './changes.js';
import { readChangeState, type HistoryEvent } from './change-state.js';
import type { ApprovalGateId, GateId, SdlcConfig } from './config.js';
import { t, type MessageRef } from './i18n.js';
import {
  approveCli,
  evaluateChange,
  type GateEvaluation,
  type LifecycleView,
  type NextAction,
} from './lifecycle.js';
import { awaitedRoles } from './approval-quorum.js';

/**
 * `sdlc explain --change <id>` (0.11.3, B53): why a change is where it is. It reads the lifecycle view (stage,
 * the first open gate and its reason, the next action with the people from roles.yaml) and the change history,
 * and records nothing: no record, no log entry, no awaiting entry, no event.
 */

export interface ExplainGate {
  id: string;
  status: string;
  reason: string;
  rework?: { reason: string; note: string; by: string; at: string };
}

export interface ExplainWaiting {
  actor: NextAction['actor'];
  roles?: string[];
  people?: Array<{ id: string; name: string; role: string }>;
  what: string;
}

export interface ExplainStep {
  actor: NextAction['actor'];
  action: string;
  cli?: string;
  text: string;
}

export interface ExplainEvent {
  at: string;
  event: string;
  by?: string;
  detail?: string;
}

/** The JSON of `sdlc explain --json` (English). */
export interface Explanation {
  change: string;
  stage: string;
  stageTitle: string;
  gate: ExplainGate | null;
  waitingFor: ExplainWaiting;
  unblock: ExplainStep[];
  recent: ExplainEvent[];
}

/** The explanation before it is rendered: localizable parts stay catalog references. */
export interface ExplainDraft {
  view: LifecycleView;
  gate?: GateEvaluation;
  next: MessageRef;
  facts: MessageRef[];
  roles: string[];
  steps: DraftStep[];
  recent: ExplainEvent[];
}

const RECENT_EVENTS = 5;

export function draftExplanation(root: string, ref: ChangeRef, config: SdlcConfig): ExplainDraft {
  const view = evaluateChange(root, ref, config);
  const gate = view.gates.find((item) => !item.satisfied);
  const history = readChangeState(ref.dir).history;
  const next = nextRef(view.next, gate);
  const first: DraftStep = { actor: view.next.actor, action: view.next.action, text: next };
  if (view.next.cli) {
    first.cli = view.next.cli;
  }
  return {
    view,
    gate,
    next,
    facts: explainFacts(view, gate),
    roles: waitingRoles(view.next, gate, config),
    steps: [first, ...followingSteps(view)],
    recent: history.slice(-RECENT_EVENTS).map(recentEvent),
  };
}

/**
 * The next action as a catalog reference. A revision names the gate's own reason as a reference too, so the
 * reason reads in the reader's language instead of the English text the lifecycle keeps.
 */
function nextRef(next: NextAction, gate: GateEvaluation | undefined): MessageRef {
  if (!next.key) {
    return { key: 'explain.literal', params: { text: next.message } };
  }
  const params = { ...(next.params ?? {}) };
  if (next.action === 'revise-artifact' && gate?.reasonKey) {
    params.reason = { key: gate.reasonKey, params: gate.reasonParams ?? {} };
  }
  return { key: next.key, params };
}

/** The roles an approval waits for; none when the next step is not an approval. */
function waitingRoles(next: NextAction, gate: GateEvaluation | undefined, config: SdlcConfig): string[] {
  if (next.action !== 'approve-gate' || !gate || gate.id === 'verify') {
    return [];
  }
  const awaited = awaitedRoles(gate.missingRoles, config.gates[gate.id as ApprovalGateId]);
  const roles = awaited.flatMap((entry) => entry.split(' | '));
  return roles.filter((role) => role !== 'any approver');
}

function recentEvent(event: HistoryEvent): ExplainEvent {
  const out: ExplainEvent = { at: event.at, event: event.event };
  if (event.by) {
    out.by = event.by;
  }
  if (event.detail) {
    out.detail = event.detail;
  }
  return out;
}

/** A catalog reference in English, for the JSON. */
function english(ref: MessageRef): string {
  return t(ref.key, ref.params, 'en');
}

function gateJson(gate: GateEvaluation | undefined): ExplainGate | null {
  if (!gate) {
    return null;
  }
  const out: ExplainGate = { id: gate.id, status: gate.status, reason: gate.reason ?? '' };
  if (gate.rework) {
    out.rework = { ...gate.rework };
  }
  return out;
}

function waitingJson(draft: ExplainDraft): ExplainWaiting {
  const what = [draft.next, ...draft.facts].map(english).join(' ');
  const out: ExplainWaiting = { actor: draft.view.next.actor, what };
  if (draft.roles.length > 0) {
    out.roles = draft.roles;
  }
  const people = draft.view.next.people;
  if (people && people.length > 0) {
    out.people = people.map((person) => ({ id: person.id, name: person.name, role: person.role }));
  }
  return out;
}

function stepJson(step: DraftStep): ExplainStep {
  const out: ExplainStep = { actor: step.actor, action: step.action, text: english(step.text) };
  if (step.cli) {
    out.cli = step.cli;
  }
  return out;
}

export function explanationJson(draft: ExplainDraft): Explanation {
  return {
    change: draft.view.change,
    stage: draft.view.stage,
    stageTitle: draft.view.stageTitle,
    gate: gateJson(draft.gate),
    waitingFor: waitingJson(draft),
    unblock: draft.steps.map(stepJson),
    recent: draft.recent,
  };
}

// What unblocks the change after its next step.

/** One step of what unblocks a change, before it is rendered. */
export interface DraftStep {
  actor: NextAction['actor'];
  action: string;
  cli?: string;
  text: MessageRef;
}

/** What follows an approval of each gate. */
const AFTER_APPROVAL: Partial<Record<GateId, DraftStep['action']>> = {
  intent: 'write-artifact',
  spec: 'write-artifact',
  plan: 'implement',
  review: 'release',
  release: 'archive',
};

/** The steps after the next one: what the change needs once the next action is done. */
function followingSteps(view: LifecycleView): DraftStep[] {
  const next = view.next;
  switch (next.action) {
    case 'write-artifact':
    case 'revise-artifact':
      return artifactApproval(view);
    case 'approve-gate':
      return next.gate ? afterApproval(next.gate) : [];
    case 'implement':
      return [verifyStep(view.change)];
    case 'verify':
      return [agentStep('review', 'explain.then.review')];
    case 'review':
    case 'fix-findings':
      return [approvalStep(view, 'review')];
    case 'release':
      return [approvalStep(view, 'release')];
    case 'taken-over':
      return [agentStep('resume', 'explain.then.handBack')];
    default:
      return [];
  }
}

/** After writing or revising a planning artifact, a person approves its gate (the workflow names the gate). */
function artifactApproval(view: LifecycleView): DraftStep[] {
  const gate = (view.next.gate ?? view.next.workflow) as GateId | undefined;
  if (!gate) {
    return [];
  }
  return [approvalStep(view, gate)];
}

function approvalStep(view: LifecycleView, gate: GateId): DraftStep {
  return {
    actor: 'human',
    action: 'approve-gate',
    cli: approveCli(view.change, gate),
    text: { key: 'explain.then.approve', params: { gate } },
  };
}

function afterApproval(gate: GateId): DraftStep[] {
  const action = AFTER_APPROVAL[gate];
  if (!action) {
    return [];
  }
  return [agentStep(action, `explain.after.${gate}`)];
}

function verifyStep(change: string): DraftStep {
  return {
    actor: 'agent',
    action: 'verify',
    cli: `sdlc verify --change ${change}`,
    text: { key: 'explain.then.verify' },
  };
}

function agentStep(action: string, key: string): DraftStep {
  return { actor: 'agent', action, text: { key } };
}

// The facts the open gate shows.

/**
 * What `sdlc explain` adds to the next step: the facts the open gate shows. Facts the next step already says
 * (the revision reason, the takeover note, the roles of the approval it asks for) are not repeated.
 */
function explainFacts(view: LifecycleView, gate: GateEvaluation | undefined): MessageRef[] {
  const facts = takeoverFact(view);
  if (!gate) {
    return facts;
  }
  return [
    ...facts,
    ...missingFiles(view, gate),
    ...missingRoles(view, gate),
    ...staleApprovals(gate),
    ...verifyFacts(gate),
    ...blockingFindings(view, gate),
    ...reworkFact(view, gate),
  ];
}

function takeoverFact(view: LifecycleView): MessageRef[] {
  if (!view.takeover || view.next.action === 'taken-over') {
    return [];
  }
  return [{ key: 'explain.fact.takeover', params: { by: view.takeover.by, note: view.takeover.note } }];
}

function missingFiles(view: LifecycleView, gate: GateEvaluation): MessageRef[] {
  const files = view.artifacts
    .filter((artifact) => gate.artifacts.includes(artifact.id))
    .filter((artifact) => artifact.status !== 'done' && artifact.status !== 'skipped')
    .map((artifact) => artifact.generates);
  if (files.length === 0) {
    return [];
  }
  return [{ key: 'explain.fact.missingFiles', params: { files: files.join(', ') } }];
}

function missingRoles(view: LifecycleView, gate: GateEvaluation): MessageRef[] {
  const asked = view.next.action === 'approve-gate' && view.next.gate === gate.id;
  const open = gate.status === 'pending' || gate.status === 'stale';
  const roles = gate.missingRoles.filter((role) => role !== 'any approver');
  if (asked || !open || roles.length === 0) {
    return [];
  }
  return [{ key: 'explain.fact.missingRoles', params: { roles: roles.join(', ') } }];
}

function staleApprovals(gate: GateEvaluation): MessageRef[] {
  if (gate.staleApprovals.length === 0) {
    return [];
  }
  const by = [...new Set(gate.staleApprovals.map((approval) => approval.by))].join(', ');
  return [{ key: 'explain.fact.staleApprovals', params: { count: gate.staleApprovals.length, by } }];
}

function verifyFacts(gate: GateEvaluation): MessageRef[] {
  if (gate.id !== 'verify') {
    return [];
  }
  if (gate.status === 'failed') {
    return [{ key: 'explain.fact.verifyFailed' }];
  }
  if (gate.status === 'stale') {
    return [{ key: 'explain.fact.verifyStale' }];
  }
  return [];
}

function blockingFindings(view: LifecycleView, gate: GateEvaluation): MessageRef[] {
  const blocking = view.review?.blocking ?? [];
  if (gate.id !== 'review' || blocking.length === 0) {
    return [];
  }
  const list = blocking.map((finding) => (finding.id ? `${finding.id} ${finding.title}` : finding.title));
  return [{ key: 'explain.fact.findings', params: { count: blocking.length, list: list.join('; ') } }];
}

function reworkFact(view: LifecycleView, gate: GateEvaluation): MessageRef[] {
  if (!gate.rework || view.next.action === 'revise-artifact') {
    return [];
  }
  const params = { by: gate.rework.by, reason: gate.rework.reason, note: gate.rework.note };
  return [{ key: 'explain.fact.rework', params }];
}
