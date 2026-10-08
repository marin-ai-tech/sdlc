import { loadProject } from '../cli/context.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { resolveChange } from '../core/changes.js';
import {
  draftExplanation,
  explanationJson,
  type DraftStep,
  type ExplainDraft,
  type ExplainEvent,
} from '../core/explain.js';
import { t, type MessageRef } from '../core/i18n.js';

/**
 * `sdlc explain --change <id> [--json]`: why a change is where it is and what unblocks it. Anyone may run it,
 * agents too: it only reads. Without --change it explains the only active change, as `sdlc status --change` does.
 */
export interface ExplainOptions {
  change?: string;
  json?: boolean;
}

export async function explainCommand(opts: ExplainOptions): Promise<void> {
  try {
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change, { allowArchived: true });
    const draft = draftExplanation(ctx.root, ref, ctx.config);
    if (opts.json) {
      printJson(explanationJson(draft));
      return;
    }
    printExplanation(draft);
  } catch (error) {
    reportFailure(error, opts.json, { change: null });
  }
}

/** The text in the reader's language: a short paragraph per section. */
function printExplanation(draft: ExplainDraft): void {
  line(c.bold(t('explain.title', { change: draft.view.change, stage: t(`stage.${draft.view.stage}`) })));
  line(gateText(draft));
  line();
  line(waitingText(draft));
  line();
  line(c.bold(t('explain.unblock')));
  draft.steps.forEach((step, index) => printStep(step, index));
  line();
  line(c.bold(t('explain.recent')));
  printRecent(draft.recent);
}

function gateText(draft: ExplainDraft): string {
  const gate = draft.gate;
  if (!gate) {
    return t('explain.noGate');
  }
  const reason = gate.reasonKey ? t(gate.reasonKey, gate.reasonParams) : gate.reason ?? '';
  const status = t(`gateStatus.${gate.status}`);
  if (reason === '') {
    return t('explain.gateNoReason', { gate: gate.id, status });
  }
  return t('explain.gate', { gate: gate.id, status, reason });
}

/** Who the change waits for, and the facts of the open gate; the next step itself is the first unblock step. */
function waitingText(draft: ExplainDraft): string {
  const actor = actorText(draft.view.next.actor);
  const who = waitingWho(draft);
  const head = who ? t('explain.waitingWho', { actor, who }) : t('explain.waiting', { actor });
  return [head, ...draft.facts.map(localized)].join(' ');
}

/** The people who may act now (from roles.yaml), else the roles an approval waits for. */
function waitingWho(draft: ExplainDraft): string {
  const people = draft.view.next.people ?? [];
  if (people.length > 0) {
    return people.map((person) => `${person.name}, ${person.role}`).join('; ');
  }
  return draft.roles.join(', ');
}

function printStep(step: DraftStep, index: number): void {
  line(`  ${index + 1}. ${actorText(step.actor)}: ${localized(step.text)}`);
  if (step.cli) {
    line(c.cyan(`     $ ${step.cli}`));
  }
}

function printRecent(recent: ExplainEvent[]): void {
  if (recent.length === 0) {
    line(`  ${t('explain.noRecent')}`);
    return;
  }
  for (const event of recent) {
    const by = event.by ? `  ${event.by}` : '';
    const detail = event.detail ? `: ${event.detail}` : '';
    line(`  ${c.dim(event.at)}  ${event.event}${by}${detail}`);
  }
}

function actorText(actor: string): string {
  if (actor === 'human') {
    return t('actor.person');
  }
  if (actor === 'agent') {
    return t('actor.agent');
  }
  return t('actor.none');
}

function localized(ref: MessageRef): string {
  return t(ref.key, ref.params);
}
