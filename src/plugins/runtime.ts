import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { LIMITS, fail, keys, object, parseExtensions, type Extensions, type Json,
  type PackageSnapshot, type PluginResponse } from './api.js';
import { responseEnvelope } from './response.js';

let active = 0;
export interface Invocation {
  operation?: string; input?: Json; config?: Json; state?: Json; revision?: number; context?: Json; hook?: boolean; preflight?: boolean;
  validate?: { kind: 'taskExt' | 'bidExt' | 'config' | 'state'; value: Json };
  timeoutMs?: number;
}

/** The caller supplies only accepted, enabled immutable captures from its operation context. */
export async function validateExtensions(snapshots: Iterable<PackageSnapshot>, kind: 'taskExt' | 'bidExt',
  raw: unknown, timeoutMs: number = LIMITS.operationMs): Promise<Extensions | undefined> {
  const started = performance.now();
  const value = parseExtensions(raw);
  if (value === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('plugin_timeout', 'Invalid extension validation deadline');
  const deadline = started + Math.min(timeoutMs, LIMITS.operationMs);
  const available = new Map<string, PackageSnapshot>();
  for (const snapshot of snapshots) {
    if (available.size >= LIMITS.plugins || available.has(snapshot.manifest.name)) {
      fail('plugin_namespace', 'Ambiguous or excessive extension namespace catalog');
    }
    available.set(snapshot.manifest.name, snapshot);
  }
  for (const [name, data] of Object.entries(value)) {
    const snapshot = available.get(name);
    if (!snapshot) fail('plugin_namespace', 'Extension namespace is not enabled and accepted');
    if (snapshot.manifest.schemas[kind] === undefined) fail('plugin_schema', 'Missing extension schema');
    const remaining = deadline - performance.now();
    if (remaining <= 0) fail('plugin_timeout', 'Extension validation deadline exceeded');
    await invoke(snapshot, { preflight: true, validate: { kind, value: data }, timeoutMs: remaining });
  }
  if (performance.now() >= deadline) fail('plugin_timeout', 'Extension validation deadline exceeded');
  return value;
}

async function slot(deadline: number): Promise<void> {
  while (active >= LIMITS.workers) {
    if (performance.now() >= deadline) fail('plugin_timeout', 'Plugin worker queue deadline exceeded');
    await delay(5);
  }
  if (performance.now() >= deadline) fail('plugin_timeout', 'Plugin invocation deadline exceeded');
  active++;
}

export async function invoke(snapshot: PackageSnapshot, input: Invocation): Promise<PluginResponse | null> {
  const max = input.hook ? LIMITS.hookMs : LIMITS.operationMs;
  const deadline = performance.now() + Math.min(max, Math.max(1, input.timeoutMs ?? max));
  await slot(deadline);
  let worker: Worker | undefined;
  let exited = false;
  try {
    const { timeoutMs: _timeout, ...request } = input;
    worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { ...request, manifest: snapshot.manifest, files: [...snapshot.files] },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    worker.once('exit', () => { exited = true; });
    return await new Promise<PluginResponse | null>((resolve, reject) => {
      const timer = setTimeout(() => rejectPlugin('plugin_timeout', 'Plugin execution deadline exceeded'),
        Math.max(1, deadline - performance.now()));
      const rejectPlugin = (code: string, detail: string): void => {
        clearTimeout(timer);
        try { fail(code, detail); } catch (error) { reject(error); }
      };
      worker!.once('error', () => rejectPlugin('plugin_runtime', 'Plugin worker failed'));
      worker!.once('exit', (code) => {
        if (code !== 0) rejectPlugin('plugin_runtime', 'Plugin worker exited unexpectedly');
      });
      worker!.once('message', (raw: unknown) => {
        clearTimeout(timer);
        if (performance.now() >= deadline) return rejectPlugin('plugin_timeout', 'Late plugin response was discarded');
        try {
          const message = object(raw, 'worker message');
          keys(message, ['ok', 'result', 'code', 'detail'], 'worker message');
          if (message.ok !== true) {
            if (message.ok !== false || typeof message.code !== 'string' || typeof message.detail !== 'string'
              || Object.hasOwn(message, 'result')) fail('plugin_runtime', 'Invalid plugin worker response');
            return rejectPlugin(message.code, message.detail);
          }
          if (!Object.hasOwn(message, 'result') || Object.hasOwn(message, 'code') || Object.hasOwn(message, 'detail')) {
            fail('plugin_runtime', 'Invalid plugin worker response');
          }
          let result: PluginResponse | null;
          if (input.preflight || input.validate) {
            if (message.result !== null) fail('plugin_invalid', 'Validation-only worker must return null');
            result = null;
          } else result = responseEnvelope(message.result, snapshot.manifest, input.operation ?? '', input.hook);
          if (performance.now() >= deadline) return rejectPlugin('plugin_timeout', 'Late plugin response was discarded');
          resolve(result);
        } catch (error) { reject(error); }
      });
    });
  } finally {
    if (worker) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([worker.terminate(), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Plugin worker did not terminate')), LIMITS.cleanupMs);
        })]);
        exited = true;
      } finally {
        if (timer) clearTimeout(timer);
        if (!exited) worker.unref();
        if (exited) active--;
      }
    } else active--;
  }
}
