/**
 * `sdlc next --me`: my queue. Every gate, across the active changes (or the one given), that waits for a person and
 * that I may take now, with the command to run. "I" is the git identity; with `openspec/roles.yaml` it must be a
 * person there, and a gate is mine when the next step names me among its people (`next.people`, the same evaluation
 * as `sdlc roles who`). Without roles.yaml anyone may act, so every gate waiting for a person is listed.
 * Read-only: it evaluates the changes and writes nothing (no record, no log entry).
 */
import type { ChangeRef } from './changes.js';
import type { SdlcConfig } from './config.js';
import { gitIdentity } from './git.js';
import { approveCli, evaluateChange, sharedFingerprint, type LifecycleView } from './lifecycle.js';
import { personByEmail, readRolesFile } from './roles.js';

export interface QueueItem {
  change: string;
  gate: string;
  action: string;
  /** The exact command, `sdlc …` (the caller applies the project's CLI prefix). */
  cli: string;
  /** English; text output names the gate and the command instead. */
  message: string;
}

export interface MyQueue {
  me: { email: string | null; person: string | null };
  items: QueueItem[];
  /** True without roles.yaml: anyone may act on every listed gate. */
  anyone: boolean;
  /** Why the queue is empty when the identity is no person in roles.yaml. */
  reason?: 'not_in_roles';
}

export interface QueueScope {
  root: string;
  config: SdlcConfig;
  refs: ChangeRef[];
}

/** The queue of the current git identity over `scope.refs`. */
export function myQueue(scope: QueueScope): MyQueue {
  const roles = readRolesFile(scope.root);
  const email = gitIdentity(scope.root).email?.toLowerCase() ?? null;
  const person = roles && email ? personByEmail(roles, email)?.id ?? null : null;
  const me = { email, person };
  if (roles && !person) return { me, items: [], anyone: false, reason: 'not_in_roles' };
  const fingerprint = sharedFingerprint(scope.root);
  const items = scope.refs
    .map((ref) => evaluateChange(scope.root, ref, scope.config, { fingerprint }))
    .flatMap((view) => waitingItem(view, person))
    .sort((a, b) => (a.change < b.change ? -1 : a.change > b.change ? 1 : 0));
  return { me, items, anyone: !roles };
}

/** The change's gate when it waits for a person's approval and (with roles.yaml) that person is me. */
function waitingItem(view: LifecycleView, person: string | null): QueueItem[] {
  const next = view.next;
  if (next.actor !== 'human' || next.action !== 'approve-gate' || !next.gate || !next.cli) return [];
  const item = { change: view.change, gate: next.gate, action: next.action, cli: next.cli, message: next.message };
  if (!person) return [item];
  const named = next.people?.find((candidate) => candidate.id === person);
  if (!named) return [];
  // A planning gate's command names the role; it is the role I approve in, not the first one awaited.
  const withRole = next.cli.includes(' --as ') ? approveCli(view.change, next.gate, named.role) : next.cli;
  return [{ ...item, cli: withRole }];
}
