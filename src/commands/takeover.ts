import { loadProject, recordChangeEvent, type ProjectContext } from '../cli/context.js';
import { resolveNext } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { readChangeState, type ChangeState } from '../core/change-state.js';
import { resolveChange, type ChangeRef } from '../core/changes.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { t } from '../core/i18n.js';
import { RELEASED_EVENT, TAKEOVER_EVENT } from '../core/takeover.js';
import { assertHuman } from './gates.js';

/**
 * `sdlc takeover` and `sdlc release-control`: a person takes a change away from the agent for a while and hands
 * it back with a note. Both record a human decision, so they refuse to run in an agent session.
 */
export interface TakeoverOptions {
  change?: string;
  note?: string;
  json?: boolean;
}

interface Start {
  ctx: ProjectContext;
  ref: ChangeRef;
  state: ChangeState;
  note: string;
  by: string;
}

function requireNote(action: string, note: string | undefined): string {
  if (note !== undefined && note.trim() !== '') {
    return note;
  }
  throw new SdlcError('note_required', { key: 'error.takeover_note_required', params: { action } });
}

function identity(root: string): string {
  const who = formatIdentity(gitIdentity(root));
  if (who) {
    return who;
  }
  throw new SdlcError(
    'no_identity',
    { key: 'error.cannot_tell_who_is_deciding_git_user_name_user_e' },
    { key: 'fix.set_them_with_git_config_user_email_you_example_' },
  );
}

/** What both commands check first: a person, a note, the change and who decides. */
function start(action: string, opts: TakeoverOptions): Start {
  const ctx = loadProject();
  assertHuman(ctx.config, action);
  const note = requireNote(action, opts.note);
  const ref = resolveChange(ctx.paths, opts.change);
  const state = readChangeState(ref.dir);
  return { ctx, ref, state, note, by: identity(ctx.root) };
}

export async function takeoverCommand(opts: TakeoverOptions): Promise<void> {
  try {
    const { ctx, ref, state, note, by } = start('takeover', opts);
    if (state.takeover) {
      const params = { change: ref.id, by: state.takeover.by };
      throw new SdlcError('invalid_transition', { key: 'error.change_x_is_already_taken_over', params });
    }
    state.takeover = { by, at: new Date().toISOString(), note };
    recordChangeEvent(ctx, ref, state, TAKEOVER_EVENT, by, note);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, takeover: state.takeover, ...(next ? { next } : {}) });
      return;
    }
    line(c.yellow(t('takeover.taken', { change: ref.id, by, note })));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export async function releaseControlCommand(opts: TakeoverOptions): Promise<void> {
  try {
    const { ctx, ref, state, note, by } = start('release-control', opts);
    if (!state.takeover) {
      const params = { change: ref.id };
      throw new SdlcError('invalid_transition', { key: 'error.change_x_is_not_taken_over', params });
    }
    const held = state.takeover;
    delete state.takeover;
    recordChangeEvent(ctx, ref, state, RELEASED_EVENT, by, note);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) {
      printJson({ change: ref.id, released: held, by, note, ...(next ? { next } : {}) });
      return;
    }
    line(c.green(t('takeover.released', { change: ref.id, by, note })));
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
