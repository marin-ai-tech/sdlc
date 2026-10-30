import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../dist/core/config.js';
import { LIMITS, type PackageSnapshot } from '../dist/plugins/api.js';
import { callPlugin } from '../dist/plugins/broker.js';
import { capturePackage } from '../dist/plugins/package.js';
import { responseEnvelope } from '../dist/plugins/response.js';
import { invoke, type Invocation } from '../dist/plugins/runtime.js';
import { packageFiles } from './fixtures/plugin-modules.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { tempDir } from './helpers.js';

const VALID = { output: 7, state: { count: 1 }, events: [{ name: 'sampled', data: { units: 1 } }] };
let accepted: Awaited<ReturnType<typeof pluginProject>>;

beforeAll(async () => { accepted = await pluginProject(VALID); }, 30000);
afterEach(() => vi.restoreAllMocks());

function project() {
  const root = tempDir('sdlc-response-commit-');
  fs.cpSync(accepted.root, root, { recursive: true });
  return { root, config: loadConfig(path.join(root, 'openspec/sdlc.yaml')) };
}

function durableBytes(root: string) {
  return Object.fromEntries(['plugins/state/economy/store.json', 'plugins/registry.json', 'log.jsonl', 'hook-log.jsonl']
    .map((relative) => {
      const file = path.join(root, 'openspec/.sdlc', relative);
      return [relative, fs.existsSync(file) ? fs.readFileSync(file).toString('base64') : null];
    }));
}

/** The real worker runs a valid guest; only the message delivered to the parent is replaced. */
function tamperChannel(replace: (message: { ok: boolean; result?: unknown }) => unknown): unknown[] {
  const actual: unknown[] = [];
  const once = Worker.prototype.once;
  vi.spyOn(Worker.prototype, 'once').mockImplementation(function (this: Worker, event, listener) {
    if (event !== 'message') return once.call(this, event, listener);
    return once.call(this, event, (message: { ok: boolean; result?: unknown }) => {
      if (!message.ok) return listener(message);
      actual.push(message.result);
      listener(replace(message));
    });
  });
  return actual;
}

function tamperResult(replacement: unknown): unknown[] {
  return tamperChannel((message) => ({ ...message, result: replacement }));
}

async function pureSnapshot(): Promise<{ root: string; snapshot: PackageSnapshot }> {
  const root = tempDir('sdlc-response-pure-');
  const p = await packageFiles(root, { output: 7 });
  return { root, snapshot: capturePackage(root, p.source) };
}

const INVALID: Array<{ name: string; result: unknown; code: string }> = [
  { name: 'missing output', result: { state: VALID.state, events: VALID.events }, code: 'plugin_invalid' },
  { name: 'extra transport identity', result: { ...VALID, origin: 'forged' }, code: 'plugin_invalid' },
  { name: 'primitive facts', result: { ...VALID, facts: 12 }, code: 'plugin_invalid' },
  { name: 'null facts', result: { ...VALID, facts: null }, code: 'plugin_invalid' },
  { name: 'array facts', result: { ...VALID, facts: [] }, code: 'plugin_invalid' },
  { name: 'null events', result: { ...VALID, events: null }, code: 'plugin_limit' },
  { name: 'object event batch', result: { ...VALID, events: {} }, code: 'plugin_limit' },
  { name: 'undeclared event suffix', result: { ...VALID, events: [{ name: 'other', data: {} }] }, code: 'plugin_event' },
  { name: 'foreign event namespace', result: { ...VALID, events: [{ name: 'core.approved', data: {} }] },
    code: 'plugin_event' },
  { name: 'forged event attribution', result: { ...VALID,
    events: [{ name: 'sampled', data: {}, plugin: { name: 'other' }, transaction: 'forged' }] }, code: 'plugin_invalid' },
  { name: 'missing event data', result: { ...VALID, events: [{ name: 'sampled' }] }, code: 'plugin_invalid' },
  { name: 'oversized event data', result: { ...VALID,
    events: [{ name: 'sampled', data: 'x'.repeat(LIMITS.eventBytes) }] }, code: 'plugin_limit' },
  { name: 'oversized event batch', result: { ...VALID,
    events: Array.from({ length: LIMITS.effects + 1 }, () => ({ name: 'sampled', data: {} })) }, code: 'plugin_limit' },
  { name: 'oversized complete response', result: { ...VALID, output: 'x'.repeat(LIMITS.jsonBytes) }, code: 'plugin_limit' },
];

describe('parent response contract before mutable commit', () => {
  it.each(INVALID)('refuses $name before changing store, receipts or log bytes', async ({ result, code }) => {
    const p = project();
    const before = durableBytes(p.root);
    const actual = tamperResult(result);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', {}, accepted.actor, pluginRequest()))
      .rejects.toMatchObject({ code });
    expect(actual).toEqual([VALID]);
    expect(durableBytes(p.root)).toEqual(before);
  });

  it('commits a genuine valid guest response through the same broker path', async () => {
    const p = project();
    const before = durableBytes(p.root);
    const result = await callPlugin(p.root, p.config, 'economy', 'record', {}, accepted.actor, pluginRequest());
    expect(result.output).toBe(7);
    expect(durableBytes(p.root)).not.toEqual(before);
    const store = JSON.parse(fs.readFileSync(path.join(p.root,
      'openspec/.sdlc/plugins/state/economy/store.json'), 'utf8'));
    expect(store.data).toEqual({ count: 1 });
    expect(store.receipts).toHaveLength(1);
    const log = fs.readFileSync(path.join(p.root, 'openspec/.sdlc/log.jsonl'), 'utf8');
    expect(log.split('\n').filter(Boolean).map((line) => JSON.parse(line))
      .filter((event) => event.event === 'economy.sampled')).toHaveLength(1);
  });
});

describe('parent pure-call and validation-only response modes', () => {
  it.each([
    { name: 'null', value: null }, { name: 'array', value: [] }, { name: 'missing flag', value: {} },
    { name: 'string success flag', value: { ok: 'true', result: { output: 7 } } },
    { name: 'numeric success flag', value: { ok: 1, result: { output: 7 } } },
    { name: 'failure with a result', value: { ok: false, result: { output: 7 } } },
    { name: 'missing result', value: { ok: true } },
    { name: 'forged success code', value: { ok: true, result: { output: 7 }, code: 'forged' } },
  ])('refuses malformed worker transport $name', async ({ value }) => {
    const p = await pureSnapshot();
    const actual = tamperChannel(() => value);
    const error = await invoke(p.snapshot, { operation: 'read', input: {}, config: {}, state: {} })
      .catch((error: unknown) => error);
    expect(error).toHaveProperty('code');
    expect(['plugin_runtime', 'plugin_invalid']).toContain((error as { code: string }).code);
    expect(actual).toEqual([{ output: 7 }]);
  });

  it.each([
    { name: 'read state', operation: 'read', hook: false, result: { output: 7, state: {} } },
    { name: 'read events', operation: 'read', hook: false,
      result: { output: 7, events: [{ name: 'sampled', data: {} }] } },
    { name: 'hook state', operation: 'record', hook: true, result: { output: 7, state: null } },
    { name: 'hook events', operation: 'record', hook: true,
      result: { output: 7, events: [{ name: 'sampled', data: {} }] } },
  ])('refuses tampered $name from a guest whose real response is pure', async ({ operation, hook, result }) => {
    const p = await pureSnapshot();
    const before = durableBytes(p.root);
    const actual = tamperResult(result);
    await expect(invoke(p.snapshot, { operation, hook, input: {}, config: {}, state: {} }))
      .rejects.toMatchObject({ code: 'plugin_effect' });
    expect(actual).toEqual([{ output: 7 }]);
    expect(durableBytes(p.root)).toEqual(before);
  });

  it.each<Invocation>([{ preflight: true }, { validate: { kind: 'state', value: {} } }])
    ('refuses an envelope substituted for validation-only null: %j', async (mode) => {
      const p = await pureSnapshot();
      const actual = tamperResult({ output: 7 });
      await expect(invoke(p.snapshot, mode)).rejects.toMatchObject({ code: 'plugin_invalid' });
      expect(actual).toEqual([null]);
    });

  it('preserves successful literal null validation replies and absent optional response fields', async () => {
    const { snapshot } = await pureSnapshot();
    expect(await invoke(snapshot, { preflight: true })).toBeNull();
    expect(await invoke(snapshot, { validate: { kind: 'state', value: {} } })).toBeNull();
    expect(await invoke(snapshot, { operation: 'read', input: {}, config: {}, state: {} })).toEqual({ output: 7 });
  });
});

describe('shared fixed envelope and worker-only schemas/errors', () => {
  it('keeps plugin schema evaluation inside the worker rather than the parent primitive checker', async () => {
    const { snapshot } = await pureSnapshot();
    snapshot.manifest.operations.record.output = false;
    expect(responseEnvelope({ output: 7 }, snapshot.manifest, 'record')).toEqual({ output: 7 });
    await expect(invoke(snapshot, { operation: 'record', input: {}, config: {}, state: {} }))
      .rejects.toMatchObject({ code: 'plugin_schema', message: expect.stringContaining('output') });
  });

  it('reports native worker errors generically instead of forwarding their native code', async () => {
    const { snapshot } = await pureSnapshot();
    snapshot.files.set('plugin.wasm', null as unknown as Buffer);
    const error = await invoke(snapshot, { preflight: true }).catch((error: unknown) => error);
    expect(error).toMatchObject({ code: 'plugin_runtime', message: expect.stringContaining('Plugin worker failed') });
    expect(String(error)).not.toContain('ERR_INVALID_ARG_TYPE');
    expect(String(error)).not.toContain('TypeError');
  });
});
