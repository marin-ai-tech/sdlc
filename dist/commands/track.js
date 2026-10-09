import { loadProject, recordChangeEvent } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { emitNextHint, resolveNext } from '../cli/next-hint.js';
import { agentEnvironment } from '../core/agent-env.js';
import { readChangeState, TRACKS } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { humanCommandFix } from '../core/human-command.js';
import { t } from '../core/i18n.js';
export async function trackSetCommand(trackArg, opts) {
    try {
        if (!TRACKS.includes(trackArg)) {
            throw new SdlcError('invalid_track', { key: 'error.track_must_be_one_of_x', params: { p1: TRACKS.join(', ') } });
        }
        const agent = agentEnvironment();
        if (agent)
            throw new SdlcError('agent_cannot_set_track', { key: 'error.an_agent_session_x_cannot_set_the_track', params: { agent: agent } }, humanCommandFix(`track set ${trackArg} --change ${opts.change}`));
        const ctx = loadProject();
        const ref = resolveChange(ctx.paths, opts.change);
        const state = readChangeState(ref.dir);
        if (state.gates.plan?.approvals?.length) {
            throw new SdlcError('plan_already_approved', { key: 'error.the_track_cannot_change_after_the_plan_gate_is_a' });
        }
        const previous = state.track;
        const track = trackArg;
        state.track = track;
        delete state.track_suggestion;
        recordChangeEvent(ctx, ref, state, 'track.set', formatIdentity(gitIdentity(ctx.root)), `${previous} → ${track}${opts.note ? `: ${opts.note}` : ''}`);
        const next = resolveNext(ctx, ref.id);
        if (opts.json)
            printJson({ change: ref.id, track, previous, harness: ctx.stamp, ...(next ? { next } : {}) });
        else {
            line(t('track.set', { change: ref.id, previous, track }));
            emitNextHint(ctx, ref.id);
        }
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
