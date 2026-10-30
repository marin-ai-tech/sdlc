import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { readBacklog, setBacklogStatus } from '../core/backlog.js';
import { appendHistory, copyKeptApprovals, readChangeState, writeChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { SdlcError } from '../core/errors.js';
import { formatIdentity, gitIdentity } from '../core/git.js';
import { t } from '../core/i18n.js';
import { appendLog } from '../core/log.js';
import { assertHuman } from './gates.js';
export function dropCommand(id, opts) {
    try {
        const ctx = loadProject();
        assertHuman(ctx.config, 'drop');
        const note = opts.note?.trim();
        if (!note)
            throw new SdlcError('note_required', { key: 'error.note_is_required' });
        const ref = resolveChange(ctx.paths, id);
        const before = readChangeState(ref.dir);
        const state = structuredClone(before);
        copyKeptApprovals(before, state);
        const by = formatIdentity(gitIdentity(ctx.root));
        if (!by)
            throw new SdlcError('no_identity', { key: 'error.cannot_tell_who_is_deciding_git_user_name_user_e' });
        const folder = `${new Date().toISOString().slice(0, 10)}-${id}`;
        const target = path.join(ctx.paths.archiveDir, folder);
        if (fs.existsSync(target))
            throw new SdlcError('archive_exists', { key: 'error.archivedChangeId', params: { id, folder } });
        const source = state.source;
        const item = source?.type === 'backlog' && source.ref
            ? readBacklog(ctx.root).items.find((entry) => entry.id === source.ref) : undefined;
        state.dropped = { by, at: new Date().toISOString(), note };
        appendHistory(state, 'change.dropped', by, note, ctx.stamp);
        writeChangeState(ref.dir, state, ctx.stamp);
        fs.mkdirSync(ctx.paths.archiveDir, { recursive: true });
        try {
            fs.renameSync(ref.dir, target);
        }
        catch (error) {
            writeChangeState(ref.dir, before);
            throw error;
        }
        appendLog(ctx.root, ctx.config, { event: 'change.dropped', change: id, by, detail: note }, ctx.stamp);
        if (item?.status === 'in-progress' && item.change === id) {
            setBacklogStatus(ctx.root, item.id, 'open');
        }
        if (opts.json)
            printJson({ change: id, dropped: state.dropped, archivedAs: folder });
        else
            line(t('drop.done', { id, folder }));
    }
    catch (error) {
        reportFailure(error, opts.json);
    }
}
