import { loadProject } from '../cli/context.js';
import { withCliPrefix } from '../cli/next-hint.js';
import { c, line, printJson, reportFailure } from '../cli/output.js';
import { listActiveChanges, resolveChange } from '../core/changes.js';
import { t } from '../core/i18n.js';
import { myQueue } from '../core/my-queue.js';
export async function nextMeCommand(opts) {
    try {
        const ctx = loadProject();
        const refs = opts.change ? [resolveChange(ctx.paths, opts.change)] : listActiveChanges(ctx.paths);
        const queue = myQueue({ root: ctx.root, config: ctx.config, refs });
        const items = queue.items.map((item) => ({ ...item, cli: withCliPrefix(item.cli, ctx.config.cli) }));
        if (opts.json)
            return printJson({ ...queue, items, root: { path: ctx.root } });
        printQueue({ ...queue, items });
    }
    catch (error) {
        reportFailure(error, opts.json, { me: null, items: [] });
    }
}
function printQueue(queue) {
    if (queue.reason === 'not_in_roles') {
        line(queue.me.email ? t('queue.notInRoles', { email: queue.me.email }) : t('queue.noEmail'));
        return;
    }
    if (queue.items.length === 0) {
        line(t('queue.empty'));
        return;
    }
    const header = queue.anyone ? 'queue.headerAnyone' : 'queue.header';
    line(c.bold(t(header, { count: queue.items.length })));
    for (const item of queue.items) {
        line(t('queue.item', { change: item.change, gate: item.gate, cmd: item.cli }));
    }
}
