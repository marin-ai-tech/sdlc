import { loadProject, recordChangeEvent } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { agentEnvironment } from '../core/agent-env.js';
import { readChangeState, TRACKS, type Track } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';

interface TrackOptions { change: string; note?: string; json?: boolean }

export async function trackSetCommand(trackArg: string, opts: TrackOptions): Promise<void> {
  try {
    if (!(TRACKS as readonly string[]).includes(trackArg)) {
      throw new SdlcError('invalid_track', `Track must be one of: ${TRACKS.join(', ')}.`);
    }
    const agent = agentEnvironment();
    if (agent) throw new SdlcError('agent_cannot_set_track', `An agent session (${agent}) cannot set the track.`,
      'Run this command yourself in a terminal outside the agent.');
    const ctx = loadProject();
    const ref = resolveChange(ctx.paths, opts.change);
    const state = readChangeState(ref.dir);
    if (state.gates.plan?.approvals?.length) {
      throw new SdlcError('plan_already_approved', 'The track cannot change after the plan gate is approved.');
    }
    const previous = state.track;
    const track = trackArg as Track;
    state.track = track;
    delete state.track_suggestion;
    recordChangeEvent(ctx, ref, state, 'track.set', formatIdentity(gitIdentity(ctx.root)),
      `${previous} → ${track}${opts.note ? `: ${opts.note}` : ''}`);
    const next = resolveNext(ctx, ref.id);
    if (opts.json) printJson({ change: ref.id, track, previous, harness: ctx.stamp, ...(next ? { next } : {}) });
    else {
      line(`Track for ${ref.id}: ${previous} → ${track}`);
      emitNextHint(ctx, ref.id);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
