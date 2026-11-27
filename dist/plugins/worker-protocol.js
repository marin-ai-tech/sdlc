import { LIMITS, fail, keys, object } from './api.js';
import { responseEnvelope } from './response.js';
let active = 0;
const quarantined = new Set();
const QUARANTINE_LIMIT = 2;
export async function acquireWorker(deadline) {
    const queuedUntil = Math.min(deadline, performance.now() + LIMITS.queueMs);
    while (true) {
        if (quarantined.size >= QUARANTINE_LIMIT)
            fail('plugin_busy', 'Plugin worker quarantine is exhausted');
        if (performance.now() >= queuedUntil) {
            const phase = queuedUntil === deadline ? 'caller preparation' : 'worker queue';
            fail('plugin_timeout', `Plugin ${phase} deadline exceeded`);
        }
        // Reserve a quarantine place for every admitted worker; failed termination cannot exceed the cap.
        if (active < Math.min(LIMITS.workers, QUARANTINE_LIMIT - quarantined.size))
            break;
        await new Promise((resolve) => setTimeout(resolve, 5));
    }
    active++;
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        active--;
    };
}
export function observeWorker(worker) {
    const state = { exited: false };
    worker.on('error', () => { });
    worker.once('exit', () => {
        state.exited = true;
        quarantined.delete(worker);
    });
    return state;
}
export async function closeWorker(worker, state, release) {
    let timer;
    try {
        if (!state.exited) {
            await Promise.race([worker.terminate().catch(() => undefined), new Promise((resolve) => {
                    timer = setTimeout(resolve, LIMITS.cleanupMs);
                })]);
        }
    }
    catch {
        // Failed termination is quarantined just like an elapsed cleanup budget.
    }
    finally {
        if (timer)
            clearTimeout(timer);
        if (!state.exited) {
            quarantined.add(worker);
            worker.unref();
        }
        release();
    }
    return state.exited;
}
function workerResult(raw, input) {
    const message = object(raw, 'worker message');
    if (message.phase === 'ready') {
        keys(message, ['phase'], 'worker ready');
        return 'ready';
    }
    keys(message, ['phase', 'ok', 'result', 'code', 'detail'], 'worker result');
    if (message.phase !== 'result')
        fail('plugin_runtime', 'Unknown plugin worker phase');
    if (message.ok === false && typeof message.code === 'string' && typeof message.detail === 'string'
        && !Object.hasOwn(message, 'result'))
        fail(message.code, message.detail);
    if (message.ok !== true || !Object.hasOwn(message, 'result')
        || Object.hasOwn(message, 'code') || Object.hasOwn(message, 'detail')) {
        fail('plugin_runtime', 'Invalid plugin worker result');
    }
    if (input.preflight || input.validate) {
        if (message.result !== null)
            fail('plugin_invalid', 'Validation-only worker must return null');
        return null;
    }
    return object(message.result, 'worker plugin response');
}
export function exchangeWorker(worker, input, deadline, manifest, startupDeadline) {
    return new WorkerExchange(worker, input, deadline, manifest, startupDeadline).start();
}
class WorkerExchange {
    worker;
    input;
    deadline;
    manifest;
    startupDeadline;
    executing = false;
    settled = false;
    phase = 'startup';
    until = 0;
    timer;
    resolve;
    reject;
    constructor(worker, input, deadline, manifest, startupDeadline) {
        this.worker = worker;
        this.input = input;
        this.deadline = deadline;
        this.manifest = manifest;
        this.startupDeadline = startupDeadline;
    }
    start() {
        return new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
            this.worker.on('message', this.message);
            this.worker.once('error', this.errorEvent);
            this.worker.once('exit', this.exitEvent);
            this.arm('startup', this.startupDeadline);
        });
    }
    finish(error, result = null) {
        if (this.settled)
            return;
        this.settled = true;
        clearTimeout(this.timer);
        this.worker.off('message', this.message);
        this.worker.off('error', this.errorEvent);
        this.worker.off('exit', this.exitEvent);
        if (error)
            this.reject(error);
        else
            this.resolve(result);
    }
    checkTime() {
        if (performance.now() < this.until)
            return;
        const label = performance.now() >= this.deadline ? 'caller preparation' : this.phase;
        fail('plugin_timeout', `Plugin ${label} deadline exceeded`);
    }
    arm(phase, until) {
        clearTimeout(this.timer);
        this.phase = phase;
        this.until = Math.min(this.deadline, until);
        this.timer = setTimeout(() => {
            try {
                this.checkTime();
            }
            catch (error) {
                this.finish(error);
            }
            if (!this.settled)
                this.arm(phase, this.until);
        }, Math.max(1, this.until - performance.now()));
    }
    runtimeFailure(detail) {
        try {
            fail('plugin_runtime', detail);
        }
        catch (error) {
            this.finish(error);
        }
    }
    errorEvent = () => this.runtimeFailure('Plugin worker failed');
    exitEvent = () => this.runtimeFailure('Plugin worker exited before its result');
    message = (raw) => {
        try {
            this.checkTime();
            const result = workerResult(raw, this.input);
            if (result === 'ready') {
                if (this.executing)
                    fail('plugin_runtime', 'Duplicate plugin readiness');
                this.executing = true;
                this.arm('execution', performance.now() + (this.input.hook ? LIMITS.hookMs : LIMITS.operationMs));
                this.worker.postMessage({ phase: 'execute' });
            }
            else {
                if (!this.executing)
                    fail('plugin_runtime', 'Plugin result preceded execution');
                const response = result === null ? null
                    : responseEnvelope(result, this.manifest, this.input.operation ?? '', this.input.hook);
                this.checkTime();
                this.finish(undefined, response);
            }
        }
        catch (error) {
            this.finish(error);
        }
    };
}
