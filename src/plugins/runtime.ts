import { Worker } from 'node:worker_threads';
import { LIMITS, fail, parseExtensions, type Extensions, type Json,
  type PackageSnapshot, type PluginResponse } from './api.js';
import { acquireWorker, closeWorker, exchangeWorker, observeWorker } from './worker-protocol.js';

export interface Invocation {
  operation?: string;
  input?: Json;
  config?: Json;
  state?: Json;
  revision?: number;
  context?: Json;
  hook?: boolean;
  preflight?: boolean;
  validate?: { kind: 'taskExt' | 'bidExt' | 'config' | 'state'; value: Json };
  timeoutMs?: number;
  /** Absolute trusted host preparation deadline; never sent to the guest. */
  deadline?: number;
}

/** The caller supplies only accepted, enabled immutable captures from its operation context. */
export async function validateExtensions(snapshots: Iterable<PackageSnapshot>, kind: 'taskExt' | 'bidExt',
  raw: unknown, timeoutMs: number = LIMITS.preparationMs): Promise<Extensions | undefined> {
  const started = performance.now();
  const value = parseExtensions(raw);
  if (value === undefined) return undefined;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('plugin_timeout', 'Invalid extension validation deadline');
  const deadline = started + Math.min(timeoutMs, LIMITS.preparationMs);
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
    await invoke(snapshot, { preflight: true, validate: { kind, value: data }, deadline });
  }
  if (performance.now() >= deadline) fail('plugin_timeout', 'Extension validation deadline exceeded');
  return value;
}

function preparationDeadline(input: Invocation): number {
  if (input.timeoutMs !== undefined && (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0)) {
    fail('plugin_timeout', 'Invalid plugin caller budget');
  }
  if (input.deadline !== undefined && !Number.isFinite(input.deadline)) {
    fail('plugin_timeout', 'Invalid caller deadline');
  }
  return Math.min(performance.now() + Math.min(input.timeoutMs ?? LIMITS.preparationMs, LIMITS.preparationMs),
    input.deadline ?? Infinity);
}

export async function invoke(snapshot: PackageSnapshot, input: Invocation): Promise<PluginResponse | null> {
  const deadline = preparationDeadline(input);
  const release = await acquireWorker(deadline);
  const startupDeadline = Math.min(deadline, performance.now() + LIMITS.startupMs);
  let worker: Worker;
  try {
    const { timeoutMs: _timeout, deadline: _deadline, ...request } = input;
    worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData: { ...request, manifest: snapshot.manifest, files: [...snapshot.files] },
      resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
  } catch (error) {
    release();
    throw error;
  }
  const state = observeWorker(worker);
  let result: PluginResponse | null = null;
  let failure: unknown;
  try { result = await exchangeWorker(worker, input, deadline, snapshot.manifest, startupDeadline); }
  catch (error) { failure = error; }
  const closed = await closeWorker(worker, state, release);
  if (failure) throw failure;
  if (!closed) fail('plugin_timeout', 'Plugin cleanup deadline exceeded');
  if (performance.now() >= deadline) fail('plugin_timeout', 'Plugin caller preparation deadline exceeded');
  return result;
}
