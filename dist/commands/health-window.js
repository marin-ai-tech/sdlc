import { SdlcError } from '../core/errors.js';
import { DAY_MS } from '../core/health/context.js';
import { parseSince } from '../report/model.js';
function invalid(key) {
    return new SdlcError('invalid_option', { key });
}
function parseDays(value) {
    if (!/^[1-9]\d*$/.test(value))
        throw invalid('error.days_must_be_a_positive_whole_number');
    return Number(value);
}
function checked(window) {
    if (!Number.isFinite(new Date(window.since).getTime())) {
        throw invalid('error.days_must_be_a_positive_whole_number');
    }
    return window;
}
/** The last `days` days before now. */
export function daysWindow(days, now) {
    return checked({ since: now.getTime() - days * DAY_MS, days });
}
/** From `since` (ISO) to now; days are the whole days in between, rounded down (0 for a moment ahead of now). */
function sinceWindow(since, now) {
    const start = Date.parse(since);
    const days = Math.max(0, Math.floor((now.getTime() - start) / DAY_MS));
    return { since: start, days };
}
/** A one-off window from `--since` or `--days` (never both); undefined when neither is given. */
export function requestedWindow(opts, now) {
    if (opts.since !== undefined && opts.days !== undefined)
        throw invalid('error.health_since_or_days');
    const since = parseSince(opts.since);
    if (since !== undefined)
        return sinceWindow(since, now);
    if (opts.days !== undefined)
        return daysWindow(parseDays(opts.days), now);
    return undefined;
}
/** The window as the JSON reports it. */
export function windowJson(window) {
    return { since: new Date(window.since).toISOString(), days: window.days };
}
