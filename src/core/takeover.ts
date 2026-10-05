import * as path from 'node:path';
import { readChangeState, type ChangeState, type TakeoverRecord } from './change-state.js';
import { listActiveChanges } from './changes.js';
import { toPosix } from './fs-utils.js';
import { quotedCommand } from './human-command.js';
import { t } from './i18n.js';
import type { NextAction } from './lifecycle.js';
import { matchesPlanFile, readPlanFiles } from './plan-files.js';
import type { ProjectPaths } from './project.js';
import { shellWriteTargets, simpleCommands } from './policy-shell.js';

/**
 * A person takes a change over (`sdlc takeover`) and hands it back (`sdlc release-control`). While the change is
 * held, its next step is the person's and the hook denies agent edits (rule `takeover`) in the change folder and in
 * the files of plan.md "Files that change"; a change without plan.md pauses the agent in the whole project. After
 * the hand-back the agent's session context shows the note until the change's next lifecycle event.
 *
 * The shell is held too: a write op whose target resolves to a held path is denied, and so is any `sdlc` step
 * with `--change <held id>` except the read-only ones. Heuristics on the command text, like the other shell rules:
 * a computed path (`"$FILE"`) and a step on the held change without `--change` are not followed.
 */
export const TAKEOVER_EVENT = 'change.takeover';
export const RELEASED_EVENT = 'change.released';

type TakeoverDenial = { decision: 'deny'; rule: string; reason: string };

/** A change a person holds; `files` undefined means the hold covers the whole project. */
interface HeldChange {
  id: string;
  folder: string;
  takeover: TakeoverRecord;
  files?: string[];
}

function safeState(dir: string): ChangeState | undefined {
  try {
    return readChangeState(dir);
  } catch {
    // A broken record is reported by `sdlc doctor`; it must not wedge every edit.
    return undefined;
  }
}

function heldChanges(paths: ProjectPaths): HeldChange[] {
  const held: HeldChange[] = [];
  for (const ref of listActiveChanges(paths)) {
    const takeover = safeState(ref.dir)?.takeover;
    if (!takeover) {
      continue;
    }
    const folder = toPosix(path.relative(paths.root, ref.dir)).toLowerCase();
    held.push({ id: ref.id, folder, takeover, files: readPlanFiles(ref.dir) });
  }
  return held;
}

function covers(change: HeldChange, rel: string): boolean {
  if (!change.files) {
    return true;
  }
  const file = rel.toLowerCase();
  if (file === change.folder || file.startsWith(`${change.folder}/`)) {
    return true;
  }
  return change.files.some((planned) => matchesPlanFile(planned, rel));
}

/** The hook's answer to an edit of project files (posix, relative to the root) while a person holds a change. */
export function takeoverDenial(
  paths: ProjectPaths,
  rels: string[],
  held: HeldChange[] = heldChanges(paths),
): TakeoverDenial | undefined {
  for (const change of held) {
    const hit = rels.find((rel) => covers(change, rel));
    if (hit === undefined) {
      continue;
    }
    const params = { change: change.id, by: change.takeover.by, note: change.takeover.note, path: hit };
    const reason = t(change.files ? 'hook.takeover' : 'hook.takeoverPaused', params);
    return { decision: 'deny', rule: 'takeover', reason };
  }
  return undefined;
}

/** sdlc steps that only read, allowed on a held change. */
const READ_ONLY_STEP = /^(?:status|next|trace|audit|help|instructions|validate|roles\s+who)$/i;
const CHANGE_OPTION = /--change(?:=|\s+)["']?([^\s"';&|]+)/gi;

/** The subcommand of an sdlc step: two words for the command groups (`roles who`, `tests lock`). */
function stepName(match: RegExpExecArray): string {
  return match[2] === undefined ? match[1] : `${match[1]} ${match[2]}`;
}

/** An sdlc step after the CLI prefix (binary and global options), with its one- or two-word subcommand. */
function cliStep(prefix: string): RegExp {
  return new RegExp(String.raw`${prefix}\s+([a-z][\w-]*)(?:\s+([a-z][\w-]*))?`, 'i');
}

/** True when a simple command runs an sdlc step that writes, on the change `id`. */
function writesStep(segment: string, id: string, step: RegExp): boolean {
  const match = step.exec(segment);
  if (!match || READ_ONLY_STEP.test(match[1]) || READ_ONLY_STEP.test(stepName(match))) {
    return false;
  }
  return [...segment.matchAll(CHANGE_OPTION)].some((option) => option[1].toLowerCase() === id.toLowerCase());
}

function cliDenial(change: HeldChange, command: string, step: RegExp): TakeoverDenial | undefined {
  const segment = simpleCommands(command).find((part) => writesStep(part, change.id, step));
  if (segment === undefined) {
    return undefined;
  }
  const params = { change: change.id, by: change.takeover.by, note: change.takeover.note };
  const reason = t('hook.takeoverCli', { ...params, command: quotedCommand(segment) });
  return { decision: 'deny', rule: 'takeover', reason };
}

/**
 * The hook's answer to a shell command while a person holds a change: held paths and sdlc steps on it. `cliPrefix`
 * is the regex source of the CLI as the human-command rule spells it (binary and global options).
 */
export function shellTakeoverDenial(
  paths: ProjectPaths, command: string, cwd: string, cliPrefix: string,
): TakeoverDenial | undefined {
  const held = heldChanges(paths);
  if (held.length === 0) {
    return undefined;
  }
  const written = takeoverDenial(paths, shellWriteTargets(command, paths.root, cwd), held);
  if (written) {
    return written;
  }
  const step = cliStep(cliPrefix);
  for (const change of held) {
    const denial = cliDenial(change, command, step);
    if (denial) return denial;
  }
  return undefined;
}

/** The next step of a change a person holds: theirs, until they hand it back. */
export function takeoverNext(state: ChangeState, change: string): NextAction | undefined {
  const held = state.takeover;
  if (!held) {
    return undefined;
  }
  const params = { by: held.by, note: held.note };
  return {
    actor: 'human',
    action: 'taken-over',
    cli: `sdlc release-control --change ${change} --note "<hand-back note>"`,
    key: 'next.takenOver',
    params,
    message: t('next.takenOver', params, 'en'),
  };
}

/** The hand-back note for the agent's session context, while the hand-back is the change's last event. */
export function handBackLine(changeDir: string, change: string): string | undefined {
  const last = safeState(changeDir)?.history.at(-1);
  if (!last || last.event !== RELEASED_EVENT) {
    return undefined;
  }
  return t('session.handedBack', { change, by: last.by ?? '?', note: last.detail ?? '' });
}
