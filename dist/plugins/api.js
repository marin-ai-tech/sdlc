import { SdlcError, toDiagnostic } from '../core/errors.js';
export const INPUT_CONTROL_FIELDS = ['project', 'executor', 'origin', 'request'];
export const API_VERSION = '1.0.0';
export const NAME = /^[a-z][a-z0-9-]{0,23}$/;
export const HOOKS = ['claim', 'bid', 'award', 'result_accept', 'file_edit', 'stop'];
export const LIMITS = Object.freeze({
    files: 256, packageBytes: 16 * 1024 * 1024, manifestBytes: 256 * 1024,
    moduleBytes: 8 * 1024 * 1024, jsonBytes: 1024 * 1024, extBytes: 256 * 1024,
    storeBytes: 4 * 1024 * 1024, eventBytes: 64 * 1024, depth: 32, effects: 64,
    pages: 1024, initialPages: 16, plugins: 8, workers: 2, hookMs: 1000,
    operationMs: 5000, cleanupMs: 1000, receiptMs: 86_400_000,
});
export function fail(code, detail) {
    throw new SdlcError(code, { key: 'error.pluginFailure', params: { detail: detail.slice(0, 500) } }, { key: 'fix.pluginFailure' });
}
/** Public plugin boundaries never expose native filesystem/process exception details. */
export function pluginError(error) {
    if (error instanceof SdlcError)
        return error;
    return new SdlcError('plugin_unavailable', {
        key: 'error.pluginFailure',
        params: { detail: 'Plugin resources are unavailable; inspect the pinned package and storage.' },
    }, { key: 'fix.pluginFailure' });
}
export function pluginDiagnostic(error) {
    return toDiagnostic(pluginError(error));
}
export function object(value, where) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        fail('plugin_invalid', `${where} must be an object`);
    }
    return value;
}
export function keys(value, allowed, where) {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) {
            fail('plugin_invalid', `${where}: unknown field ${key}`);
        }
    }
}
export function text(value, where) {
    if (typeof value !== 'string' || !value || value.includes('\0'))
        fail('plugin_invalid', `${where} is invalid`);
    return value;
}
function normalize(value, depth, budget) {
    if (depth > LIMITS.depth || --budget.nodes < 0)
        fail('plugin_invalid', 'JSON complexity limit exceeded');
    if (value === null || typeof value === 'string' || typeof value === 'boolean')
        return value;
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (Array.isArray(value))
        return value.map((item) => normalize(item, depth + 1, budget));
    const source = object(value, 'JSON');
    const result = Object.create(null);
    for (const key of Object.keys(source).sort()) {
        if (['__proto__', 'prototype', 'constructor'].includes(key))
            fail('plugin_invalid', 'Unsafe JSON key');
        result[key] = normalize(source[key], depth + 1, budget);
    }
    return result;
}
export function canonical(value, limit = LIMITS.jsonBytes) {
    const result = JSON.stringify(normalize(value, 0, { nodes: 100_000 }));
    if (Buffer.byteLength(result) > limit)
        fail('plugin_limit', 'JSON byte limit exceeded');
    return result;
}
export function json(value, limit = LIMITS.jsonBytes) {
    return JSON.parse(canonical(value, limit));
}
/** Parse stored or new extensions; only the runtime can authorize new namespaces. */
export function parseExtensions(raw) {
    if (raw === undefined)
        return undefined;
    const value = object(raw, 'extensions');
    for (const name of Object.keys(value)) {
        if (!NAME.test(name) || INPUT_CONTROL_FIELDS.includes(name)
            || ['__proto__', 'prototype', 'constructor'].includes(name)) {
            fail('plugin_namespace', 'Extension namespace is invalid or reserved');
        }
    }
    return json(value, LIMITS.extBytes);
}
/** Transport identity is host-owned; nested plugin JSON remains plugin-owned. */
export function parsePluginInput(raw) {
    const value = json(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        if (INPUT_CONTROL_FIELDS.some((key) => Object.hasOwn(value, key))) {
            fail('plugin_input', 'Plugin input cannot override transport identity');
        }
    }
    return value;
}
export function parseJson(bytes, limit = LIMITS.jsonBytes) {
    if (bytes.byteLength > limit)
        fail('plugin_limit', 'JSON byte limit exceeded');
    try {
        return json(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), limit);
    }
    catch (error) {
        if (error instanceof SdlcError)
            throw error;
        return fail('plugin_invalid', 'Invalid UTF-8 or JSON');
    }
}
