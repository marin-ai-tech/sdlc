import { readLog } from './log.js';
/** Agent share of project log entries, with the same period and change filter as audit. */
export function agentEvents(root, since, change) {
    const entries = readLog(root).filter((entry) => (!since || entry.ts >= since)
        && (!change || entry.change === change));
    const byAgent = {};
    for (const entry of entries) {
        if (entry.agent)
            byAgent[entry.agent] = (byAgent[entry.agent] ?? 0) + 1;
    }
    return { agent: Object.values(byAgent).reduce((total, count) => total + count, 0),
        total: entries.length, byAgent };
}
