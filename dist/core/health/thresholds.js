import { SdlcError } from '../errors.js';
/** On-disk key -> field and the kind of value it takes. */
const FIELDS = {
    window_days: { name: 'windowDays', kind: 'positive' },
    wait_hours: { name: 'waitHours', kind: 'positive' },
    stalled_days: { name: 'stalledDays', kind: 'positive' },
    deferred_days: { name: 'deferredDays', kind: 'positive' },
    first_pass_rate: { name: 'firstPassRate', kind: 'share' },
    rework_share: { name: 'reworkShare', kind: 'share' },
    waiver_share: { name: 'waiverShare', kind: 'share' },
    reapprovals: { name: 'reapprovals', kind: 'count' },
    denials: { name: 'denials', kind: 'count' },
    lock_days: { name: 'lockDays', kind: 'positive' },
};
export const HEALTH_KEYS = Object.keys(FIELDS);
export const DEFAULT_HEALTH = Object.freeze({
    windowDays: 90,
    waitHours: 48,
    stalledDays: 14,
    deferredDays: 30,
    firstPassRate: 0.5,
    reworkShare: 0.5,
    waiverShare: 0.3,
    reapprovals: 3,
    denials: 5,
    lockDays: 7,
});
function fits(value, kind) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return false;
    if (kind === 'share')
        return value >= 0 && value <= 1;
    if (kind === 'count')
        return Number.isInteger(value) && value >= 1;
    return value > 0;
}
function invalidValue(where, key, kind) {
    const params = { where: `${where}.${key}` };
    return new SdlcError('invalid_config', { key: `error.health_${kind}`, params });
}
function unknownKey(where, key) {
    const params = { where: `${where}.${key}`, keys: HEALTH_KEYS.join(', ') };
    return new SdlcError('invalid_config', { key: 'error.health_unknown_key', params });
}
/** `health` of sdlc.yaml: every threshold with its default filled in; undefined when the block is absent. */
export function parseHealth(value, where) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new SdlcError('invalid_config', { key: 'error.x_must_be_a_mapping', params: { where } });
    }
    const out = { ...DEFAULT_HEALTH };
    for (const [key, raw] of Object.entries(value)) {
        const field = FIELDS[key];
        if (!field)
            throw unknownKey(where, key);
        if (!fits(raw, field.kind))
            throw invalidValue(where, key, field.kind);
        out[field.name] = raw;
    }
    return out;
}
/** The thresholds in effect: the configured ones, or the defaults. */
export function healthThresholds(config) {
    return { ...DEFAULT_HEALTH, ...(config.health ?? {}) };
}
/** `{ health: { ... } }` with the values that differ from the defaults; `{}` when none does. */
export function serializeHealth(health) {
    if (!health)
        return {};
    const out = {};
    for (const [key, field] of Object.entries(FIELDS)) {
        const value = health[field.name];
        if (value !== DEFAULT_HEALTH[field.name])
            out[key] = value;
    }
    return Object.keys(out).length > 0 ? { health: out } : {};
}
