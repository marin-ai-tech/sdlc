import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { parseManifest } from '../dist/plugins/manifest.js';
import { parsePluginPolicies } from '../dist/plugins/config.js';
import { evaluateHooks } from '../dist/plugins/hooks.js';
import { callPlugin } from '../dist/plugins/broker.js';
import { readRegistry } from '../dist/plugins/trust.js';
import { safeRelative } from '../dist/plugins/package.js';
import { requestTime } from '../dist/plugins/store.js';
import { manifest } from './fixtures/plugin-modules.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { REPO_ROOT, tempDir, write } from './helpers.js';

describe('Strict discriminants and core-owned guest revision', () => {
  it('rejects a line terminator at the end of a namespace', () => {
    expect(() => parseManifest(manifest({ name: 'economy\n' }))).toThrow(/namespace/);
  });

  it('rejects a line terminator at the end of a package path', () => {
    expect(safeRelative('support.txt\n')).toBe(false);
  });

  it('rejects a line terminator at the end of a request identifier', () => {
    expect(() => requestTime(`${pluginRequest()}\n`, 0)).toThrow(/identifier/);
  });

  it('rejects a line terminator at the end of a hook code', async () => {
    const p = await pluginProject({ output: { decision: 'deny', code: 'A\n' } }, { hooks: { claim: 'read' } });
    await expect(evaluateHooks(p.root, p.config, 'claim', {}, p.actor)).rejects.toMatchObject({ code: 'plugin_hook' });
  });

  it.each(['read', 'executor', 'person'])('rejects an array access class resembling %s', (access) => {
    const value = manifest();
    (value.operations.record as { access: unknown }).access = [access];
    expect(() => parseManifest(value)).toThrow(/access class/);
  });

  it.each(['pass', 'signal', 'deny'])('rejects an array hook decision resembling %s', async (decision) => {
    const p = await pluginProject({ output: { decision: [decision] } }, { hooks: { claim: 'read' } });
    await expect(evaluateHooks(p.root, p.config, 'claim', {}, p.actor)).rejects.toMatchObject({ code: 'plugin_hook' });
  });

  it('rejects a coerced predicate operator beneath negation', () => {
    expect(() => parsePluginPolicies([{ id: 'strict', hook: 'claim', reason: 'Boolean fact is required',
      require: { not: { fact: 'economy.ready', op: ['eq'], value: false } } }])).toThrow(/predicate/);
  });

  it('rejects a non-string authoritative trust status', () => {
    const root = tempDir('sdlc-plugin-status-');
    write(path.join(root, 'openspec/.sdlc/plugins/registry.json'), JSON.stringify({ version: 1,
      plugins: { economy: { name: 'economy', source: 'packages/economy', version: '1.0.0',
        digest: `sha256:${'a'.repeat(64)}`, stateId: 'fixture', status: ['accepted'], by: 'Pat Owner',
        at: new Date().toISOString() } } }));
    expect(() => readRegistry(root)).toThrow(/acceptance/);
  });

  it.each(['a'.repeat(65), '0invalid', 'invalid code'])('publishes the actual bounded hook code contract: %s', (code) => {
    const schema = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'schemas/contracts/plugin-api.schema.json'), 'utf8'));
    const Ajv = createRequire(import.meta.url)('ajv/dist/2020');
    const validate = new Ajv({ strict: false }).compile({ $defs: schema.$defs, $ref: '#/$defs/hookOutput' });
    expect(validate({ decision: 'deny', code })).toBe(false);
  });

  it('supplies the authoritative revision to actual command and hook guests', async () => {
    const prefix = Buffer.from('{"output":{"decision":"pass"},"facts":{"request":');
    const p = await pluginProject(null, { hooks: { claim: 'read' } }, { bytes: prefix, call: `
      (memory.copy (i32.const ${128 + prefix.length}) (local.get 0) (local.get 1))
      (i32.store8 (i32.add (i32.const ${128 + prefix.length}) (local.get 1)) (i32.const 125))
      (i32.store8 (i32.add (i32.const ${129 + prefix.length}) (local.get 1)) (i32.const 125))
      (i64.or (i64.shl (i64.const 128) (i64.const 32))
        (i64.extend_i32_u (i32.add (local.get 1) (i32.const ${prefix.length + 2}))))` });
    const before = await callPlugin(p.root, p.config, 'economy', 'read', {}, p.actor);
    expect(before).toMatchObject({ facts: { request: { revision: 0 } } });
    await callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, pluginRequest());
    const after = await callPlugin(p.root, p.config, 'economy', 'read', { revision: 999 }, p.actor);
    expect(after).toMatchObject({ facts: { request: { revision: 1, input: { revision: 999 } } } });
    const hook = await evaluateHooks(p.root, p.config, 'claim', {}, p.actor);
    expect(hook.facts).toMatchObject({ 'economy.request': { revision: 1 } });
  });
});
