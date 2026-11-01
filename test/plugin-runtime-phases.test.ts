import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manifest } from './fixtures/plugin-modules.js';

const control = vi.hoisted(() => ({ startup: 0, cleanupHangs: false, malformed: false, executionHangs: false,
  workers: [] as Array<{ emit(event: string, ...args: unknown[]): unknown; stop(): void }> }));

vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events');
  return { Worker: class extends EventEmitter {
    private timer: ReturnType<typeof setTimeout>;
    private hangs = control.cleanupHangs;
    constructor() {
      super();
      control.workers.push(this);
      this.timer = setTimeout(() => this.emit('message', { phase: 'ready' }), control.startup);
    }
    postMessage(message: unknown) {
      if ((message as { phase?: string }).phase !== 'execute') throw new Error('Missing execute handshake');
      if (control.executionHangs) return;
      const result = control.malformed ? { phase: 'result', ok: true, result: { output: 1 }, extra: true }
        : { phase: 'result', ok: true, result: { output: 42 } };
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

beforeEach(() => {
  control.startup = 0;
  control.cleanupHangs = false;
  control.malformed = false;
  control.executionHangs = false;
  control.workers = [];
  vi.resetModules();
});

afterEach(() => {
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
  return { call };
}

describe('Independent plugin runtime phase bounds', () => {
  it('startup longer than five seconds has its own budget before a fast hook guest', async () => {
    control.startup = 5500;
    const { call } = await runtime();
    const started = performance.now();
    await expect(call()).resolves.toEqual({ output: 42 });
    expect(performance.now() - started).toBeGreaterThanOrEqual(5000);
    expect(performance.now() - started).toBeLessThan(10000);
  }, 15000);

  it('an explicitly shorter absolute caller deadline is identified separately', async () => {
    control.startup = 1000;
    const { call } = await runtime();
    const started = performance.now();
    await expect(call({ deadline: started + 100 })).rejects.toMatchObject({
      code: 'plugin_timeout', message: expect.stringMatching(/caller preparation/),
    });
    expect(performance.now() - started).toBeLessThan(600);
  }, 3000);

  it('expires the ten-second startup phase with its own diagnostic before a readiness message', async () => {
    control.startup = 20000;
    const { call } = await runtime();
    const started = performance.now();
    await expect(call()).rejects.toMatchObject({
      code: 'plugin_timeout', message: expect.stringMatching(/startup/),
    });
    expect(performance.now() - started).toBeGreaterThanOrEqual(9900);
    expect(performance.now() - started).toBeLessThan(13000);
  }, 20000);

  it('expires the ordinary five-second execution phase after readiness with its own diagnostic', async () => {
    control.executionHangs = true;
    const { call } = await runtime();
    const started = performance.now();
    await expect(call({ hook: false })).rejects.toMatchObject({
      code: 'plugin_timeout', message: expect.stringMatching(/execution/),
    });
    expect(performance.now() - started).toBeGreaterThanOrEqual(4900);
    expect(performance.now() - started).toBeLessThan(8000);
  }, 12000);

  it('queue waiting has its own five-second bound while two workers are still starting', async () => {
    control.startup = 6000;
    const { call } = await runtime();
    const running = Promise.allSettled([call(), call()]);
    const started = performance.now();
    try {
      await expect(call()).rejects.toMatchObject({ code: 'plugin_timeout', message: expect.stringMatching(/queue/i) });
      expect(performance.now() - started).toBeGreaterThanOrEqual(4500);
      expect(performance.now() - started).toBeLessThan(8000);
      expect(control.workers).toHaveLength(2);
    } finally {
      await running;
    }
  }, 15000);

  it('malformed worker messages are refused without producing a guest result', async () => {
    control.malformed = true;
    const { call } = await runtime();
    await expect(call()).rejects.toMatchObject({ code: expect.stringMatching(/^plugin_(runtime|invalid)$/) });
  });

  it('bounded cleanup releases logical capacity and finite quarantine refuses admission until actual exit', async () => {
    control.cleanupHangs = true;
    const { call } = await runtime();
    for (let index = 0; index < 2; index++) {
      await expect(call()).rejects.toMatchObject({
        code: 'plugin_timeout', message: expect.stringMatching(/cleanup/),
      });
    }
    const started = performance.now();
    await expect(call()).rejects.toMatchObject({ code: 'plugin_busy' });
    expect(performance.now() - started).toBeLessThan(300);
    expect(control.workers).toHaveLength(2);
    control.workers[0].stop();
    control.cleanupHangs = false;
    await expect(call()).resolves.toEqual({ output: 42 });
    expect(control.workers).toHaveLength(3);
  }, 10000);

  it('a completed worker releases its logical slot exactly once across repeated calls', async () => {
    const { call } = await runtime();
    for (let index = 0; index < 8; index++) await expect(call()).resolves.toEqual({ output: 42 });
    expect(control.workers).toHaveLength(8);
    control.startup = 50;
    const concurrent = Promise.all([call(), call(), call(), call()]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(control.workers).toHaveLength(10);
    await concurrent;
    expect(control.workers).toHaveLength(12);
  });
});
