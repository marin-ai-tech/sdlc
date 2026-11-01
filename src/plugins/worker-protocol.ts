import type { Worker } from 'node:worker_threads';
import { LIMITS, fail, keys, object, type PluginResponse } from './api.js';
import { responseEnvelope } from './response.js';
import type { Invocation } from './runtime.js';

let active = 0;
const quarantined = new Set<Worker>();
const QUARANTINE_LIMIT = 2;

export async function acquireWorker(deadline: number): Promise<() => void> {
  const queuedUntil = Math.min(deadline, performance.now() + LIMITS.queueMs);
  while (true) {
    if (quarantined.size >= QUARANTINE_LIMIT) fail('plugin_busy', 'Plugin worker quarantine is exhausted');
    if (performance.now() >= queuedUntil) {
      const phase = queuedUntil === deadline ? 'caller preparation' : 'worker queue';
      fail('plugin_timeout', `Plugin ${phase} deadline exceeded`);
    }
    // Reserve a quarantine place for every admitted worker; failed termination cannot exceed the cap.
    if (active < Math.min(LIMITS.workers, QUARANTINE_LIMIT - quarantined.size)) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  active++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active--;
  };
}

export function observeWorker(worker: Worker): { exited: boolean } {
  const state = { exited: false };
  worker.on('error', () => {});
  worker.once('exit', () => {
    state.exited = true;
    quarantined.delete(worker);
  });
  return state;
}

export async function closeWorker(worker: Worker, state: { exited: boolean }, release: () => void): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!state.exited) {
      await Promise.race([worker.terminate().catch(() => undefined), new Promise<void>((resolve) => {
        timer = setTimeout(resolve, LIMITS.cleanupMs);
      })]);
    }
  } catch {
    // Failed termination is quarantined just like an elapsed cleanup budget.
  } finally {
    if (timer) clearTimeout(timer);
    if (!state.exited) {
      quarantined.add(worker);
      worker.unref();
    }
    release();
  }
  return state.exited;
}

function workerResult(raw: unknown, input: Invocation): PluginResponse | null | 'ready' {
  const message = object(raw, 'worker message');
  if (message.phase === 'ready') {
    keys(message, ['phase'], 'worker ready');
    return 'ready';
  }
  keys(message, ['phase', 'ok', 'result', 'code', 'detail'], 'worker result');
  if (message.phase !== 'result') fail('plugin_runtime', 'Unknown plugin worker phase');
  if (message.ok === false && typeof message.code === 'string' && typeof message.detail === 'string'
    && !Object.hasOwn(message, 'result')) fail(message.code, message.detail);
  if (message.ok !== true || !Object.hasOwn(message, 'result')
    || Object.hasOwn(message, 'code') || Object.hasOwn(message, 'detail')) {
    fail('plugin_runtime', 'Invalid plugin worker result');
  }
  if (input.preflight || input.validate) {
    if (message.result !== null) fail('plugin_invalid', 'Validation-only worker must return null');
    return null;
  }
  return object(message.result, 'worker plugin response') as unknown as PluginResponse;
}

export function exchangeWorker(worker: Worker, input: Invocation, deadline: number,
  manifest: Parameters<typeof responseEnvelope>[1], startupDeadline: number): Promise<PluginResponse | null> {
  return new WorkerExchange(worker, input, deadline, manifest, startupDeadline).start();
}

class WorkerExchange {
  private executing = false;
  private settled = false;
  private phase = 'startup';
  private until = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private resolve!: (result: PluginResponse | null) => void;
  private reject!: (error: unknown) => void;

  constructor(private worker: Worker, private input: Invocation, private deadline: number,
    private manifest: Parameters<typeof responseEnvelope>[1], private startupDeadline: number) {}

  start(): Promise<PluginResponse | null> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.worker.on('message', this.message);
      this.worker.once('error', this.errorEvent);
      this.worker.once('exit', this.exitEvent);
      this.arm('startup', this.startupDeadline);
    });
  }

  private finish(error?: unknown, result: PluginResponse | null = null): void {
    if (this.settled) return;
    this.settled = true;
    clearTimeout(this.timer);
    this.worker.off('message', this.message);
    this.worker.off('error', this.errorEvent);
    this.worker.off('exit', this.exitEvent);
    if (error) this.reject(error);
    else this.resolve(result);
  }

  private checkTime(): void {
    if (performance.now() < this.until) return;
    const label = performance.now() >= this.deadline ? 'caller preparation' : this.phase;
    fail('plugin_timeout', `Plugin ${label} deadline exceeded`);
  }

  private arm(phase: string, until: number): void {
    clearTimeout(this.timer);
    this.phase = phase;
    this.until = Math.min(this.deadline, until);
    this.timer = setTimeout(() => {
      try { this.checkTime(); }
      catch (error) { this.finish(error); }
      if (!this.settled) this.arm(phase, this.until);
    }, Math.max(1, this.until - performance.now()));
  }

  private runtimeFailure(detail: string): void {
    try { fail('plugin_runtime', detail); }
    catch (error) { this.finish(error); }
  }

  private errorEvent = (): void => this.runtimeFailure('Plugin worker failed');
  private exitEvent = (): void => this.runtimeFailure('Plugin worker exited before its result');

  private message = (raw: unknown): void => {
    try {
      this.checkTime();
      const result = workerResult(raw, this.input);
      if (result === 'ready') {
        if (this.executing) fail('plugin_runtime', 'Duplicate plugin readiness');
        this.executing = true;
        this.arm('execution', performance.now() + (this.input.hook ? LIMITS.hookMs : LIMITS.operationMs));
        this.worker.postMessage({ phase: 'execute' });
      } else {
        if (!this.executing) fail('plugin_runtime', 'Plugin result preceded execution');
        const response = result === null ? null
          : responseEnvelope(result, this.manifest, this.input.operation ?? '', this.input.hook);
        this.checkTime();
        this.finish(undefined, response);
      }
    } catch (error) { this.finish(error); }
  };
}
