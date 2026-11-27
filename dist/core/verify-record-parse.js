/**
 * The verify record of a change's state, parsed at the boundary: every optional field is dropped unless well-formed
 * (B282 per-result binding, B183 reuse, B252 remote checks). Moved out of change-state.ts unchanged.
 */
function validReusedFrom(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return false;
    const from = value;
    return typeof from.change === 'string' && from.change !== ''
        && typeof from.run_id === 'string' && from.run_id !== '';
}
function validDigest(value) {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
function optionalVerifyFields(value) {
    const fields = { ...value };
    if (typeof fields.fingerprint !== 'string')
        delete fields.fingerprint;
    if (typeof fields.run_id !== 'string')
        delete fields.run_id;
    if (typeof fields.args_digest !== 'string')
        delete fields.args_digest;
    if (typeof fields.timeout_seconds !== 'number' || !Number.isFinite(fields.timeout_seconds)
        || fields.timeout_seconds < 0) {
        delete fields.timeout_seconds;
    }
    if (typeof fields.attempt !== 'number' || !Number.isSafeInteger(fields.attempt) || fields.attempt < 1) {
        delete fields.attempt;
    }
    return fields;
}
const COMMAND_REASONS = [
    'remote_dirty', 'remote_no_commit', 'remote_unavailable', 'remote_no_answer',
];
/** The only shape of a kept log path: one file under `verification/remote/` of the change. */
const LOG_PATH = /^verification\/remote\/[A-Za-z0-9._-]+\.log$/;
/** The remote fields of a command result, each dropped unless well-formed. */
function remoteCommandFields(value) {
    const fields = { ...value };
    if (fields.remote !== true)
        delete fields.remote;
    if (!COMMAND_REASONS.includes(fields.reason))
        delete fields.reason;
    if (typeof fields.log !== 'string' || !LOG_PATH.test(fields.log))
        delete fields.log;
    if (fields.answer_failed !== true)
        delete fields.answer_failed;
    return fields;
}
export function verifyOf(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const raw = optionalVerifyFields(value);
    if (!validReusedFrom(raw.reused_from))
        delete raw.reused_from;
    if (!validDigest(raw.unstable_digest))
        delete raw.unstable_digest;
    const clean = (items) => Array.isArray(items)
        ? items.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
            .map((item) => optionalVerifyFields(item)) : [];
    const results = clean(raw.results).map(remoteCommandFields);
    return { verify: { ...raw, results, mcp: clean(raw.mcp) } };
}
