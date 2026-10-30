import * as fs from 'node:fs';
import * as path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { canonical, parseExtensions, parsePluginInput } from '../dist/plugins/api.js';
import { capturePackage } from '../dist/plugins/package.js';
import { validateExtensions } from '../dist/plugins/runtime.js';
import { manifest, packageFiles } from './fixtures/plugin-modules.js';
import { REPO_ROOT, tempDir } from './helpers.js';

const amount = {
  type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } }, additionalProperties: false,
};

async function snapshot(schemas: Record<string, unknown> = { taskExt: amount, bidExt: amount }) {
  const root = tempDir('sdlc-plugin-contracts-');
  const p = await packageFiles(root, { output: 1 }, {
    schemas: { config: true, state: true, facts: true, ...schemas },
  }, { call: '(unreachable)' });
  return capturePackage(root, p.source);
}

function published(name: string) {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, `schemas/contracts/${name}.schema.json`), 'utf8'));
  return new Ajv2020({ strict: true, validateFormats: false }).compile(schema);
}

describe('Namespaced extension boundaries', () => {
  it('preserves absence and canonical JSON identity without changing scalar or array values', () => {
    expect(parseExtensions(undefined)).toBeUndefined();
    const a = parseExtensions({ economy: { b: [2, 1], a: 3 } });
    const b = parseExtensions({ economy: { a: 3, b: [2, 1] } });
    expect(canonical(a)).toBe(canonical(b));
    expect(canonical(a)).not.toBe(canonical({ economy: { a: 3, b: [1, 2] } }));
    expect(canonical(a)).not.toBe(canonical({ economy: { a: '3', b: [2, 1] } }));
  });

  it.each([null, [], 1, 'value', { Economy: {} }, { '../economy': {} }, { constructor: {} },
    { project: {} }, { executor: {} }, { origin: {} }, { request: {} }])('refuses unsafe extension roots: %j', (raw) => {
    expect(() => parseExtensions(raw)).toThrow();
  });

  it('refuses unsafe nested keys, non-JSON values and oversized extensions', () => {
    expect(() => parseExtensions(JSON.parse('{"economy":{"__proto__":{}}}'))).toThrow();
    expect(() => parseExtensions({ economy: undefined })).toThrow();
    expect(() => parseExtensions({ economy: 'x'.repeat(256 * 1024) })).toThrow();
    expect(parseExtensions({ economy: 'x'.repeat(256 * 1024 - 14) })?.economy)
      .toHaveLength(256 * 1024 - 14);
  });

  it('reserves injected dispatch fields at the input root while keeping nested plugin data', () => {
    for (const key of ['project', 'executor', 'origin', 'request']) {
      expect(() => parsePluginInput({ [key]: 'forged' })).toThrow();
    }
    expect(parsePluginInput({ data: { project: 'plugin-owned', executor: 'value' } }))
      .toEqual({ data: { project: 'plugin-owned', executor: 'value' } });
    expect(parsePluginInput([1, null, 'input'])).toEqual([1, null, 'input']);
    expect(() => parsePluginInput(JSON.parse('{"data":{"constructor":{}}}'))).toThrow();
  });

  it('checks task and bid schemas without dispatching a trapping guest', async () => {
    const captured = await snapshot();
    for (const kind of ['taskExt', 'bidExt'] as const) {
      const input = { economy: { amount: 12 } };
      expect(await validateExtensions([captured], kind, input)).toEqual(input);
      await expect(validateExtensions([captured], kind, { economy: { amount: '12' } }))
        .rejects.toMatchObject({ code: 'plugin_schema' });
      expect(input).toEqual({ economy: { amount: 12 } });
    }
  });

  it('does not apply defaults or remove additional properties to make input valid', async () => {
    const captured = await snapshot({ taskExt: {
      ...amount, properties: { amount: { type: 'integer', default: 4 } },
    } });
    const missing = { economy: {} };
    await expect(validateExtensions([captured], 'taskExt', missing)).rejects.toMatchObject({ code: 'plugin_schema' });
    expect(missing).toEqual({ economy: {} });
    await expect(validateExtensions([captured], 'taskExt', { economy: { amount: 1, extra: true } }))
      .rejects.toMatchObject({ code: 'plugin_schema' });
  });

  it('refuses unknown/disabled namespaces and missing schemas; historical data stays opaque', async () => {
    const captured = await snapshot({ taskExt: amount });
    await expect(validateExtensions([], 'taskExt', { economy: { amount: 1 } }))
      .rejects.toMatchObject({ code: 'plugin_namespace' });
    await expect(validateExtensions([captured], 'taskExt', { unknown: {} }))
      .rejects.toMatchObject({ code: 'plugin_namespace' });
    await expect(validateExtensions([captured], 'bidExt', { economy: {} }))
      .rejects.toMatchObject({ code: 'plugin_schema' });
    expect(await validateExtensions([], 'taskExt', undefined)).toBeUndefined();
    expect(parseExtensions({ removed: { oldShape: [null, false, 2] } }))
      .toEqual({ removed: { oldShape: [null, false, 2] } });
  });

  it('bounds hostile extension schemas under the operation deadline', async () => {
    const captured = await snapshot({ taskExt: { type: 'string', pattern: '^(a+)+$' } });
    const started = Date.now();
    await expect(validateExtensions([captured], 'taskExt', { economy: 'a'.repeat(40) + '!' }, 700))
      .rejects.toMatchObject({ code: 'plugin_timeout' });
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('refuses ambiguous captures and invalid deadlines before validation', async () => {
    const captured = await snapshot();
    await expect(validateExtensions([captured, captured], 'taskExt', { economy: { amount: 1 } }))
      .rejects.toMatchObject({ code: 'plugin_namespace' });
    for (const timeout of [0, -1, NaN, Infinity]) {
      await expect(validateExtensions([captured], 'taskExt', { economy: { amount: 1 } }, timeout))
        .rejects.toMatchObject({ code: 'plugin_timeout' });
    }
  });
});

describe('Published JSON Schema contracts', () => {
  it('publishes the actual strict manifest envelope', () => {
    const check = published('plugin-manifest');
    expect(check(manifest())).toBe(true);
    expect(check(manifest({ surprise: true }))).toBe(false);
    expect(check(manifest({ format: 'sdlc.plugin/2' }))).toBe(false);
    expect(check(manifest({ operations: { read: { access: 'root', input: true, output: true } } }))).toBe(false);
    expect(check(manifest({ schemas: { state: true, facts: true } }))).toBe(false);
    expect(check(manifest({ initialState: JSON.parse('{"constructor":{}}') }))).toBe(false);
    for (const name of ['core', 'statusline', 'events', 'triage', 'release', 'approvals', 'instructions',
      'validate', 'archive', 'audit', 'changelog', 'answer', 'constructor', 'prototype']) {
      expect(check(manifest({ name })), name).toBe(false);
    }
  });

  it('publishes the guest request and response rather than an invented transport wrapper', () => {
    const check = published('plugin-api');
    expect(check({ api: 'sdlc.plugin/1', operation: 'read', input: {}, config: {}, state: {}, revision: 0, context: null })).toBe(true);
    expect(check({ output: 1, facts: { sampled: true }, events: [{ name: 'sampled', data: {} }] })).toBe(true);
    expect(check({ output: 1, events: [{ name: 'sampled', data: {}, origin: 'forged' }] })).toBe(false);
    expect(check({ output: 1, origin: 'forged' })).toBe(false);
    expect(check({ output: 1, events: [{ name: 'sampled', data: JSON.parse('{"__proto__":{}}') }] }))
      .toBe(false);
    expect(check({ api: 'sdlc.plugin/2', operation: 'read', input: {}, config: {}, state: {}, context: null }))
      .toBe(false);
  });

  it('keeps task version 1 additive and leaves historical ext schemas opaque', () => {
    const check = published('task');
    const task = { contract: 'sdlc.task/1', id: 'test#1.1', change: 'test', risk: 'low',
      task: { id: '1.1', text: 'Test' }, base: {}, plan: { files: [], proof: [] }, scenarios: [], checks: [],
      forbidden: [], result: { branch: 'test', trailers: { 'SDLC-Change': 'test', 'SDLC-Task': '1.1' } } };
    expect(check(task)).toBe(true);
    expect(check({ ...task, ext: { removed: { oldShape: true } } })).toBe(true);
    expect(check({ ...task, ext: { project: {} } })).toBe(false);
    expect(check({ ...task, ext: [] })).toBe(false);
    expect(check({ ...task, ext: { removed: JSON.parse('{"prototype":{}}') } })).toBe(false);
  });

  it('adds attributed plugin refusal without allowing forged extra fields', () => {
    const check = published('result');
    const result = { ok: false, base: 'a'.repeat(40), commits: [], files: [], warnings: [],
      problems: [{ code: 'plugin_refused', plugin: { name: 'economy', version: '1.0.0',
        digest: `sha256:${'a'.repeat(64)}`, code: 'budget', message: 'Insufficient budget' } }] };
    expect(check(result)).toBe(true);
    expect(check({ ...result, problems: [{ code: 'plugin_refused' }] })).toBe(true);
    expect(check({ ...result, problems: [{ code: 'plugin_refused', policy: 'budget-floor' }] })).toBe(true);
    expect(check({ ...result, problems: [{ ...result.problems[0], allow: true }] })).toBe(false);
    expect(check({ ...result, problems: [{ code: 'diff_unavailable' }] })).toBe(true);
    expect(check({ ...result, problems: [{ code: 'diff_unavailable', plugin: result.problems[0].plugin }] }))
      .toBe(false);
  });
});
