import { awaitedGate } from '../core/awaiting.js';
import { resolveChange } from '../core/changes.js';
import { projectPaths } from '../core/project.js';
import { evaluateChange } from '../core/lifecycle.js';
import { readLog } from '../core/log.js';
import { waitId, settleQueued } from './outbox.js';
const WAIT = /^gate\.([^.]+)\.(awaiting|overdue)$/;
/** Older queue files have no digest field; recover it from the matching log entry. */
function digestOf(root, config, queued) {
    if (queued.item.waitDigest)
        return queued.item.waitDigest;
    const event = queued.item.event;
    return readLog(root).find((entry) => entry.change === event.change && entry.event === event.event
        && entry.detail && waitId(config.project?.name, entry, event.gate) === event.id)?.detail;
}
/** A wait survives only while the same change awaits the same gate and artifact digest. */
export function dropStaleWaits(root, config, queued) {
    const paths = projectPaths(root);
    return queued.filter((item) => {
        const event = item.item.event;
        const match = WAIT.exec(event.event);
        if (!match)
            return true;
        let current;
        try {
            const ref = resolveChange(paths, event.change);
            current = awaitedGate(evaluateChange(root, ref, config));
        }
        catch {
            current = undefined;
        }
        const digest = digestOf(root, config, item);
        if (current?.gate === match[1] && current.digest === digest)
            return true;
        settleQueued(item, [...item.item.receivers]);
        return false;
    });
}
