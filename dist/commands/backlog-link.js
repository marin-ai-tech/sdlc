import { loadProject, recordChangeEvent } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { readBacklog, setBacklogStatus } from '../core/backlog.js';
import { readChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { t } from '../core/i18n.js';
export function backlogLink(id, opts) {
    try {
        const ctx = loadProject();
        if (!opts.change)
            throw new SdlcError('invalid_option', { key: 'error.change_is_required' });
        const ref = resolveChange(ctx.paths, opts.change);
        const item = readBacklog(ctx.root).items.find((entry) => entry.id === id);
        if (!item)
            throw new SdlcError('unknown_backlog_item', { key: 'error.unknown_backlog_item_x', params: { id } });
        if (item.status !== 'open' || item.change)
            throw new SdlcError('invalid_transition', { key: 'error.x_is_x', params: { id, item_status: item.status } });
        if (!item.ready)
            throw new SdlcError('backlog_item_not_ready', { key: 'error.x_is_not_ready_x', params: { id, p2: [...item.missing, ...item.blockedBy].join(', ') } });
        const state = readChangeState(ref.dir);
        if (state.source && (state.source.type !== 'backlog' || state.source.ref !== id)) {
            throw new SdlcError('source_conflict', { key: 'error.backlogSourceConflict', params: { id: state.source.ref ?? '' } });
        }
        state.source = { type: 'backlog', ref: id };
        recordChangeEvent(ctx, ref, state, 'backlog.linked', formatIdentity(gitIdentity(ctx.root)), id);
        const linked = setBacklogStatus(ctx.root, id, 'in-progress', { change: ref.id });
        if (opts.json)
            printJson({ item: linked, change: ref.id });
        else
            line(t('backlog.linked', { id, change: ref.id }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
