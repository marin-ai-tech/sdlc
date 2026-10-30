import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { capturePackage } from '../dist/plugins/package.js';
import { invoke } from '../dist/plugins/runtime.js';
import { packageFiles, type GuestOptions } from './fixtures/plugin-modules.js';
import { tempDir } from './helpers.js';

async function run(output: unknown = { output: 42 }, options: GuestOptions = {}, operation = 'read') {
  const root = tempDir('sdlc-plugin-runtime-');
  const p = await packageFiles(root, output, {}, options);
  return invoke(capturePackage(root, p.source), { operation, input: {}, config: {}, state: {}, timeoutMs: 3000 });
}

describe('Native Wasm boundary', () => {
  it('executes the real no-WASI ABI', async () => {
    expect(await run()).toEqual({ output: 42 });
  });

  it('Memory grows during an ABI call', async () => {
    expect(await run({ output: 'fresh memory' }, { grow: true })).toEqual({ output: 'fresh memory' });
    expect(await run({ output: 7 }, { alloc: '(drop (memory.grow (i32.const 1))) (i32.const 4096)' }))
      .toEqual({ output: 7 });
  });

  it.each([
    { imports: '(import "wasi_snapshot_preview1" "fd_write" (func))' },
    { memory: '(memory 16 1024)' },
    { memory: '(import "sdlc" "memory" (memory 16))' },
    { memory: '(import "sdlc" "memory" (memory 16 2048))' },
    { memory: '(import "sdlc" "memory" (memory 16 1024 shared))' },
    { table: '(table 1 funcref)' },
    { table: '(table 1 5000 funcref)' },
    { start: '(func $start) (start $start)' },
  ])('Forbidden imports and memory shapes: %j', async (options) => {
    await expect(run(undefined, options)).rejects.toMatchObject({ code: 'plugin_wasm' });
  });

  it.each([
    { alloc: '(i32.const -1)' },
    { call: '(i64.const -1)' },
    { call: '(unreachable)' },
    { bytes: new Uint8Array([0xff]) },
    { bytes: Buffer.from('{broken') },
  ])('Trap, loop or malformed response: %j', async (options) => {
    await expect(run(undefined, options)).rejects.toHaveProperty('code');
  });

  it('terminates an allocating infinite loop before applying anything', async () => {
    const root = tempDir('sdlc-plugin-loop-');
    const p = await packageFiles(root, { output: 1 }, {}, { alloc: '(loop $again (br $again)) (i32.const 4096)' });
    const start = Date.now();
    await expect(invoke(capturePackage(root, p.source), {
      operation: 'read', input: {}, config: {}, state: {}, timeoutMs: 700,
    })).rejects.toMatchObject({ code: 'plugin_timeout' });
    expect(Date.now() - start).toBeLessThan(2500);
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/plugins'))).toBe(false);
  });

  it('refuses read effects and forged event identity as a complete batch', async () => {
    await expect(run({ output: 1, state: { forged: true } })).rejects.toMatchObject({ code: 'plugin_effect' });
    await expect(run({ output: 1, events: [{ name: 'gate.review.approved', data: {} }] }, {}, 'record'))
      .rejects.toMatchObject({ code: 'plugin_event' });
  });

  it('rejects malformed binary lengths before compilation', async () => {
    const root = tempDir('sdlc-plugin-binary-');
    const p = await packageFiles(root);
    fs.writeFileSync(path.join(p.dir, 'plugin.wasm'), Buffer.from('0061736d0100000001ffffffff1f', 'hex'));
    await expect(invoke(capturePackage(root, p.source), { preflight: true })).rejects.toMatchObject({ code: 'plugin_wasm' });
  });

  it('executes the captured bytes rather than a replaced file', async () => {
    const root = tempDir('sdlc-plugin-capture-');
    const p = await packageFiles(root);
    const snapshot = capturePackage(root, p.source);
    fs.writeFileSync(path.join(p.dir, 'plugin.wasm'), 'not the accepted guest');
    expect(await invoke(snapshot, { operation: 'read', input: {}, config: {}, state: {} })).toEqual({ output: 42 });
  });

  it('bounds hostile schema regular expressions before guest execution', async () => {
    const root = tempDir('sdlc-plugin-regex-');
    const p = await packageFiles(root, { output: 1 }, { schemas: {
      config: { type: 'string', pattern: '^(a+)+$' }, state: true, facts: true,
    } });
    const started = Date.now();
    await expect(invoke(capturePackage(root, p.source), { preflight: true, timeoutMs: 700,
      validate: { kind: 'config', value: 'a'.repeat(40) + '!' } })).rejects.toMatchObject({ code: 'plugin_timeout' });
    expect(Date.now() - started).toBeLessThan(2500);
  });
});
