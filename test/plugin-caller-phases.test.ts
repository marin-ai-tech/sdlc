import * as fs from 'node:fs';
import * as path from 'node:path';
import type { WorkerOptions } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readBoard, updateBoard } from '../dist/core/board-store.js';
import { assertHook, consumeExtensions, declareOperation, isPreparation,
  runPrepared } from '../dist/plugins/evaluation.js';
import { evaluateHooks } from '../dist/plugins/hooks.js';
import { validateExtensions } from '../dist/plugins/runtime.js';
import { pluginProject } from './fixtures/plugin-project.js';

interface Observation { created: number; execute?: number; result?: number; hook: boolean; validation: boolean }
const control = vi.hoisted(() => ({ startup: 5200, observations: [] as Observation[],
  workers: [] as Array<{ terminate(): Promise<number> }> }));

// Only readiness delivery is delayed. Compilation, schema checks, ABI calls, results and termination are native.
vi.mock('node:worker_threads', async () => {
  const native = await vi.importActual<typeof import('node:worker_threads')>('node:worker_threads');
  const { EventEmitter } = await import('node:events');
  return { ...native, Worker: class extends EventEmitter {
    private worker: InstanceType<typeof native.Worker>;
    private ready?: ReturnType<typeof setTimeout>;
    private observation: Observation;

    constructor(file: string | URL, options: WorkerOptions) {
      super();
      this.observation = { created: performance.now(), hook: options.workerData.hook === true,
        validation: options.workerData.validate !== undefined };
      control.observations.push(this.observation);
      control.workers.push(this);
      this.worker = new native.Worker(file, options);
      this.worker.on('message', (message: { phase?: string }) => this.message(message));
      this.worker.on('error', (error) => this.emit('error', error));
      this.worker.on('exit', (code) => {
        clearTimeout(this.ready);
        this.emit('exit', code);
      });
    }

    private message(message: { phase?: string }): void {
      if (message.phase === 'ready') {
        const remaining = this.observation.created + control.startup - performance.now();
        this.ready = setTimeout(() => this.emit('message', message), Math.max(1, remaining));
      } else {
        this.observation.result = performance.now();
        this.emit('message', message);
      }
    }

    postMessage(message: unknown): void {
      this.observation.execute = performance.now();
      this.worker.postMessage(message);
    }

    terminate(): Promise<number> {
      clearTimeout(this.ready);
      return this.worker.terminate();
    }

    unref(): this {
      this.worker.unref();
      return this;
    }
  } };
});

beforeEach(() => {
  control.startup = 5200;
  control.observations = [];
  control.workers = [];
});

afterEach(async () => {
  await Promise.all(control.workers.map((worker) => worker.terminate()));
});

function completedCalls(): void {
  expect(control.observations.length).toBeGreaterThan(0);
  for (const observed of control.observations) {
    expect(observed.execute! - observed.created).toBeGreaterThanOrEqual(5000);
    expect(observed.result! - observed.execute!).toBeGreaterThanOrEqual(0);
    expect(observed.result! - observed.execute!).toBeLessThan(observed.hook ? 1000 : 5000);
  }
}

type Project = Awaited<ReturnType<typeof pluginProject>>;
function boardWork(p: Project, extended = false, changed?: () => void) {
  const ext = { economy: { ready: true } };
  const args = { task: 'demo#1.1', ...(extended ? { ext } : {}) };
  const binding = { operation: 'claim', args, actor: p.actor, board: true };
  const work = () => {
    declareOperation(p.root, p.config, 'claim', args);
    return updateBoard(p.root, (board) => {
      if (extended) consumeExtensions(p.root, 'taskExt', ext);
      assertHook(p.root, p.config, 'claim', { task: args.task });
      if (!isPreparation(p.root)) changed?.();
      return board.version;
    });
  };
  return { binding, work };
}

describe('Actual plugin callers retain independent startup and shared preparation', () => {
  it.each(['file_edit', 'stop'] as const)('direct %s succeeds after5.2s startup before a fast hook', async (hook) => {
    const p = await pluginProject({ output: { decision: 'pass' } }, { hooks: { [hook]: 'read' } });
    const started = performance.now();
    const result = await evaluateHooks(p.root, p.config, hook, { file: 'src/example.ts' }, p.actor);
    expect(result.verdict).toEqual({ decision: 'pass' });
    expect(performance.now() - started).toBeLessThan(30000);
    expect(control.observations).toHaveLength(1);
    completedCalls();
  }, 20000);

  it('extension preflight succeeds after5.2s startup within its aggregate30s preparation budget', async () => {
    const p = await pluginProject();
    const started = performance.now();
    const ext = { economy: { ready: true } };
    await expect(validateExtensions([p.snapshot], 'taskExt', ext)).resolves.toEqual(ext);
    expect(performance.now() - started).toBeLessThan(30000);
    expect(control.observations).toHaveLength(1);
    expect(control.observations[0].validation).toBe(true);
    completedCalls();
  }, 20000);

  it('runPrepared reaches real board finalization after5.2s hook startup without an old caller clamp', async () => {
    const p = await pluginProject({ output: { decision: 'pass' } }, { hooks: { claim: 'read' } });
    const { binding, work } = boardWork(p);
    const started = performance.now();
    await expect(runPrepared(p.root, p.config, binding, work)).resolves.toBe(1);
    expect(performance.now() - started).toBeLessThan(30000);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/board.json'))).toBe(true);
    expect(readBoard(p.root).version).toBe(1);
    expect(control.observations).toHaveLength(1);
    completedCalls();
  }, 20000);

  it('direct hooks identify a deliberately shorter caller deadline separately from guest execution', async () => {
    const p = await pluginProject({ output: { decision: 'pass' } }, { hooks: { file_edit: 'read' } });
    const started = performance.now();
    await expect(evaluateHooks(p.root, p.config, 'file_edit', {}, p.actor, undefined, started + 100))
      .rejects.toMatchObject({ code: 'plugin_timeout', message: expect.stringMatching(/caller preparation/) });
    expect(performance.now() - started).toBeLessThan(1000);
    expect(control.observations).toHaveLength(1);
    expect(control.observations[0].execute).toBeUndefined();
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/board.json'))).toBe(false);
  }, 10000);

  it('runPrepared shares one30s ceiling across native extension/hook work and actual stale retries', async () => {
    const p = await pluginProject({ output: { decision: 'pass' } }, { hooks: { claim: 'read' } });
    let changed = 0;
    const { binding, work } = boardWork(p, true, () => {
      fs.writeFileSync(path.join(p.root, 'AGENTS.md'), `External fixture edit ${++changed}\n`);
    });
    const started = performance.now();
    await expect(runPrepared(p.root, p.config, binding, work))
      .rejects.toMatchObject({ code: 'plugin_timeout', message: expect.stringMatching(/caller preparation/) });
    expect(performance.now() - started).toBeGreaterThanOrEqual(29000);
    expect(performance.now() - started).toBeLessThan(34000);
    expect(changed).toBeGreaterThanOrEqual(1);
    expect(control.observations.length).toBeGreaterThanOrEqual(4);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/board.json'))).toBe(false);
  }, 45000);
});
