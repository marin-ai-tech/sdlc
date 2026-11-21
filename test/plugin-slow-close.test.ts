import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manifest } from './fixtures/plugin-modules.js';

/**
 * B259 (E25): a plugin operation that finished is not refused because its worker closes after the cleanup budget
 * (CI run 41783101535, attempt 1, Linux Node 24: "Plugin cleanup deadline exceeded"). The finished result is
 * returned; the worker stays quarantined and the slow close is reported with its own code, plugin_slow_close; a full
 * quarantine still refuses; a failed operation keeps its own failure. Same worker double as
 * test/plugin-runtime-phases.test.ts.
 */

const control = vi.hoisted(() => ({ cleanupHangs: false, malformed: false,
  workers: [] as Array<{ emit(event: string, ...args: unknown[]): unknown; stop(): void }> }));

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    private timer: ReturnType<typeof setTimeout>;
    private hangs = control.cleanupHangs;
    private validates: boolean;
    constructor(_url: unknown, options?: { workerData?: { validate?: unknown } }) {
      super();
      this.validates = options?.workerData?.validate !== undefined;
      control.workers.push(this);
      this.timer = setTimeout(() => this.emit('message', { phase: 'ready' }), 0);
    }
    postMessage(message: unknown) {
      if ((message as { phase?: string }).phase !== 'execute') throw new Error('Missing execute handshake');
      // A validation-only worker answers null, as the real worker does.
      const result = control.malformed ? { phase: 'result', ok: true, result: { output: 1 }, extra: true }
        : { phase: 'result', ok: true, result: this.validates ? null : { output: 42 } };
      this.emit('message', result);
    }
    stop() {
      clearTimeout(this.timer);
      this.emit('exit', 0);
    }
    terminate(): Promise<number> {
      clearTimeout(this.timer);
      if (this.hangs) return new Promise(() => {});
      this.stop();
      return Promise.resolve(0);
    }
    unref() { return this; }
  } };
});

let errors: string[] = [];

beforeEach(() => {
  control.cleanupHangs = false;
  control.malformed = false;
  control.workers = [];
  errors = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    errors.push(String(chunk));
    return true;
  });
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const worker of control.workers) worker.stop();
});

async function runtime() {
  const { parseManifest } = await import('../dist/plugins/manifest.js');
  const { invoke } = await import('../dist/plugins/runtime.js');
  const snapshot = { source: 'packages/economy', digest: `sha256:${'a'.repeat(64)}`,
    files: new Map(), manifest: parseManifest(manifest()) };
  const call = (extra: Record<string, unknown> = {}) => invoke(snapshot, {
    operation: 'read', input: {}, config: {}, state: {}, hook: true, ...extra,
  });
  return { call, snapshot };
}

describe('B259: a finished result survives a slow worker close', () => {
  it('S1: the result is returned and the slow close is reported as plugin_slow_close', async () => {
    control.cleanupHangs = true;
    const { call } = await runtime();
    await expect(call()).resolves.toEqual({ output: 42 });
    const text = errors.join('');
    expect(text).toContain('plugin_slow_close');
    expect(text).not.toMatch(/plugin_timeout/);
  }, 10000);

  it('S2: the slow-closed workers stay quarantined, and a full quarantine still refuses at once', async () => {
    control.cleanupHangs = true;
    const { call } = await runtime();
    await expect(call()).resolves.toEqual({ output: 42 });
    await expect(call()).resolves.toEqual({ output: 42 });
    const started = performance.now();
    await expect(call()).rejects.toMatchObject({ code: 'plugin_busy' });
    expect(performance.now() - started).toBeLessThan(300);
    expect(control.workers).toHaveLength(2);
  }, 10000);

  it('S3: a slow close after the caller deadline passed still returns the result that came in time', async () => {
    control.cleanupHangs = true;
    const { call } = await runtime();
    await expect(call({ deadline: performance.now() + 400 })).resolves.toEqual({ output: 42 });
  }, 10000);

  it('negative S4: a failed operation with a slow close keeps its own failure, not a result or a timeout', async () => {
    control.cleanupHangs = true;
    control.malformed = true;
    const { call } = await runtime();
    await expect(call()).rejects.toMatchObject({ code: expect.stringMatching(/^plugin_(runtime|invalid)$/) });
  }, 10000);

  it('S4b (review F3): a failed operation with a slow close also reports plugin_slow_close', async () => {
    control.cleanupHangs = true;
    control.malformed = true;
    const { call } = await runtime();
    await expect(call()).rejects.toMatchObject({ code: expect.stringMatching(/^plugin_(runtime|invalid)$/) });
    expect(errors.join('')).toContain('plugin_slow_close');
  }, 10000);

  it('S6 (review F1): extension validation that finished in time survives the last worker\'s slow close', async () => {
    control.cleanupHangs = true;
    const { snapshot } = await runtime();
    const { validateExtensions } = await import('../dist/plugins/runtime.js');
    await expect(validateExtensions([snapshot], 'taskExt', { economy: { points: 1 } }, 400))
      .resolves.toEqual({ economy: { points: 1 } });
    expect(errors.join('')).toContain('plugin_slow_close');
  }, 10000);

  it('negative S6b: extension validation that starts after its deadline is still refused', async () => {
    const { snapshot } = await runtime();
    const { validateExtensions } = await import('../dist/plugins/runtime.js');
    const now = performance.now;
    let calls = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now.call(performance) + (calls++ > 0 ? 10_000 : 0));
    await expect(validateExtensions([snapshot], 'taskExt', { economy: { points: 1 } }, 400))
      .rejects.toMatchObject({ code: 'plugin_timeout' });
  }, 10000);

  it('negative S5: a worker that closes in time reports nothing', async () => {
    const { call } = await runtime();
    await expect(call()).resolves.toEqual({ output: 42 });
    expect(errors.join('')).not.toContain('plugin_slow_close');
  });
});
