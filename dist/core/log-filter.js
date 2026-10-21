function escapeRegExp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** A test for event names: `*` matches any text, every other character only itself (no regex from the user). */
export function eventMatcher(pattern) {
    const parts = pattern.split('*').map(escapeRegExp);
    const regex = new RegExp(`^${parts.join('.*')}$`, 's');
    return (event) => regex.test(event);
}
function eventCheck(pattern) {
    const matches = eventMatcher(pattern);
    return (entry) => matches(entry.event);
}
function sinceCheck(since) {
    const start = Date.parse(since);
    return (entry) => {
        const at = Date.parse(entry.ts);
        return Number.isFinite(at) && at >= start;
    };
}
function checksOf(filter) {
    const checks = [];
    const change = filter.change;
    if (change)
        checks.push((entry) => entry.change === change);
    if (filter.event !== undefined)
        checks.push(eventCheck(filter.event));
    if (filter.since !== undefined)
        checks.push(sinceCheck(filter.since));
    return checks;
}
/** The entries that match the filter, in log order. */
export function filterLog(entries, filter) {
    const checks = checksOf(filter);
    return entries.filter((entry) => checks.every((check) => check(entry)));
}
