import { Worker } from 'node:worker_threads';
import { LIMITS, fail, parseExtensions } from './api.js';
import { acquireWorker, closeWorker, exchangeWorker, observeWorker } from './worker-protocol.js';
/** The caller supplies only accepted, enabled immutable captures from its operation context. */
export async function validateExtensions(snapshots, kind, raw, timeoutMs = LIMITS.preparationMs) {
    const started = performance.now();
    const value = parseExtensions(raw);
    if (value === undefined)
        return undefined;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        fail('plugin_timeout', 'Invalid extension validation deadline');
    const deadline = started + Math.min(timeoutMs, LIMITS.preparationMs);
    const available = new Map();
    for (const snapshot of snapshots) {
        if (available.size >= LIMITS.plugins || available.has(snapshot.manifest.name)) {
            fail('plugin_namespace', 'Ambiguous or excessive extension namespace catalog');
        }
        available.set(snapshot.manifest.name, snapshot);
    }
    for (const [name, data] of Object.entries(value)) {
        const snapshot = available.get(name);
        if (!snapshot)
            fail('plugin_namespace', 'Extension namespace is not enabled and accepted');
        if (snapshot.manifest.schemas[kind] === undefined)
            fail('plugin_schema', 'Missing extension schema');
        // Judged before each call: the time a worker takes to close after its result is not validation time (B259).
        if (performance.now() >= deadline)
            fail('plugin_timeout', 'Extension validation deadline exceeded');
        await invoke(snapshot, { preflight: true, validate: { kind, value: data }, deadline });
    }
    return value;
}
function preparationDeadline(input) {
    if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
        fail('plugin_timeout', 'Invalid plugin caller budget');
    }
    if (input.deadline !== undefined && !Number.isFinite(input.deadline)) {
        fail('plugin_timeout', 'Invalid caller deadline');
    }
    return Math.min(performance.now() + Math.min(input.timeoutMs ?? LIMITS.preparationMs, LIMITS.preparationMs), input.deadline ?? Infinity);
}
export async function invoke(snapshot, input) {
    const deadline = preparationDeadline(input);
    const release = await acquireWorker(deadline);
    const startupDeadline = Math.min(deadline, performance.now() + LIMITS.startupMs);
    let worker;
    try {
        const { timeoutMs: _timeout, deadline: _deadline, ...request } = input;
        worker = new Worker(new URL('./worker.js', import.meta.url), {
            workerData: { ...request, manifest: snapshot.manifest, files: [...snapshot.files] },
            resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
        });
    }
    catch (error) {
        release();
        throw error;
    }
    const state = observeWorker(worker);
    let result = null;
    let failure;
    try {
        result = await exchangeWorker(worker, input, deadline, snapshot.manifest, startupDeadline);
    }
    catch (error) {
        failure = error;
    }
    // The exchange judged the caller deadline when the result arrived; a slow close only quarantines the worker.
    const closed = await closeWorker(worker, state, release);
    if (!closed)
        reportSlowClose(snapshot.manifest.name, input);
    if (failure)
        throw failure;
    return result;
}
function operationLabel(input) {
    if (input.operation !== undefined)
        return input.operation;
    if (input.validate)
        return `validate ${input.validate.kind}`;
    return input.preflight ? 'preflight' : 'unnamed';
}
/** A finished result survives a slow close; the worker stays quarantined and the close is reported once. */
function reportSlowClose(plugin, input) {
    const names = `plugin ${JSON.stringify(plugin)}, operation ${JSON.stringify(operationLabel(input))}`;
    const detail = 'the worker did not exit within the cleanup budget and stays quarantined';
    process.stderr.write(`plugin_slow_close: ${names}: ${detail}\n`);
}
