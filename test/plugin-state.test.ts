import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { genesis as initialize, readStore, commitStore, receipt, requestTime } from '../dist/plugins/store.js';
import { storagePath, withPluginLock } from '../dist/plugins/activation.js';
import { humanEnv, tempDir, REPO_ROOT } from './helpers.js';

const request = (at = Date.now()) => `p1.${at}.${randomUUID().replaceAll('-', '')}`;
const genesis = (root: string, name: string, value: unknown) => initialize(root, name, value as never,
  { source: `packages/${name}`, digest: `sha256:${'0'.repeat(64)}` });

describe('Authoritative own-state store', () => {
  it('reads do not initialize; genesis is stable and missing initialized state refuses', () => {
    const root = tempDir('sdlc-plugin-store-');
    expect(readStore(root, 'economy')).toBeUndefined();
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/plugins'))).toBe(false);
    const state = genesis(root, 'economy', { counter: 0 });
    expect(genesis(root, 'economy', { counter: 99 }).data).toEqual({ counter: 0 });
    expect(readStore(root, 'economy', state.stateId)).toEqual(state);
    fs.unlinkSync(storagePath(root, 'state/economy/store.json'));
    expect(() => readStore(root, 'economy', state.stateId)).toThrow(/missing/);
  });

  it('commits state/events/receipt together and replays identical requests once', () => {
    const root = tempDir('sdlc-plugin-store-');
    const state = genesis(root, 'economy', { counter: 0 });
    const id = request();
    const result = { output: 'ok', state: { counter: 1 } };
    const events = [{ id: 'event-1', record: { event: 'economy.sampled' } }];
    const next = commitStore(root, state, id, { b: 2, a: 1 }, result, events);
    expect(next).toMatchObject({ revision: 1, data: { counter: 1 }, pending: events });
    expect(receipt(next, id, { a: 1, b: 2 })?.result).toEqual(result);
    expect(commitStore(root, state, id, { a: 1, b: 2 }, result, events).revision).toBe(1);
    expect(() => receipt(next, id, { a: 2 })).toThrow(/changed/);
    expect(() => commitStore(root, state, request(), {}, result, [])).toThrow(/changed/);
  });

  it('Expired request after compaction and clock rollback', () => {
    const now = Date.now();
    const id = request(now - 86_400_001);
    expect(() => requestTime(id, now - 86_400_000, now)).toThrow(/Expired/);
    expect(() => requestTime(id, now - 86_400_000, now - 200_000_000)).toThrow(/Expired/);
  });

  it('never steals a live lock based on its age', () => {
    const root = tempDir('sdlc-plugin-store-');
    genesis(root, 'economy', {});
    withPluginLock(root, 'state/economy/store.lock', () => {
      const lock = storagePath(root, 'state/economy/store.lock');
      fs.utimesSync(lock, 0, 0);
      expect(() => withPluginLock(root, 'state/economy/store.lock', () => 42)).toThrow(/busy/);
    });
  });

  it.each(['before', 'after'])('Crash around commit: %s atomic rename', (phase) => {
    const root = tempDir('sdlc-plugin-crash-');
    const state = genesis(root, 'economy', { counter: 0 });
    const id = request();
    const module = new URL('../dist/plugins/store.js', import.meta.url).href;
    const script = [
      "import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';",
      `const original=fs.renameSync; fs.renameSync=(...args)=>{${phase === 'before' ? 'process.exit(92);' : ''}`,
      `original(...args);${phase === 'after' ? 'process.exit(92);' : ''}}; syncBuiltinESMExports();`,
      `const {commitStore}=await import(${JSON.stringify(module)});`,
      `commitStore(${JSON.stringify(root)},${JSON.stringify(state)},${JSON.stringify(id)},{},{output:'ok',state:{counter:1}},[]);`,
    ].join('\n');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT, env: humanEnv(tempDir('sdlc-plugin-crash-home-')), timeout: 5000,
    });
    expect(child.status, child.stderr?.toString()).toBe(92);
    const current = readStore(root, 'economy', state.stateId)!;
    expect(current.data).toEqual({ counter: phase === 'after' ? 1 : 0 });
    expect(!!receipt(current, id, {})).toBe(phase === 'after');
  });

  it.each(['short', 'zero', 'flush', 'rename', 'ack'])('Atomic I/O fault: %s', (fault) => {
    const root = tempDir('sdlc-plugin-atomic-fault-');
    const state = genesis(root, 'economy', { counter: 0 });
    const id = request();
    const module = new URL('../dist/plugins/store.js', import.meta.url).href;
    const injection: Record<string, string> = {
      short: 'fs.writeSync=(fd,bytes,offset,count,...args)=>write(fd,bytes,offset,temporary.has(fd)?Math.min(count,7):count,...args);',
      zero: 'fs.writeSync=(fd,...args)=>temporary.has(fd)?0:write(fd,...args);',
      flush: "fs.fsyncSync=(fd)=>{if(temporary.has(fd))throw Error('flush failed');return flush(fd)};",
      rename: "fs.renameSync=()=>{throw Error('rename failed')};",
      ack: "fs.renameSync=(...args)=>{rename(...args);throw Error('acknowledgement failed')};",
    };
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const temporary=new Set();const open=fs.openSync;const write=fs.writeSync;const flush=fs.fsyncSync;const rename=fs.renameSync;
      fs.openSync=(file,...args)=>{const fd=open(file,...args);if(String(file).endsWith('.tmp'))temporary.add(fd);return fd};
      ${injection[fault]} syncBuiltinESMExports();const {commitStore}=await import(${JSON.stringify(module)});
      try{commitStore(${JSON.stringify(root)},${JSON.stringify(state)},${JSON.stringify(id)},{},{output:'ok',state:{counter:1}},[]);
        console.log('committed')}catch(error){console.log(error.code??'io');process.exitCode=1}`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: REPO_ROOT, env: humanEnv(tempDir('sdlc-plugin-atomic-person-')), timeout: 5000,
    });
    expect(child.status, child.stderr?.toString()).toBe(fault === 'short' ? 0 : 1);
    if (['rename', 'ack'].includes(fault)) expect(child.stdout.toString()).toContain('plugin_indeterminate');
    const committed = fault === 'short' || fault === 'ack';
    const current = readStore(root, 'economy', state.stateId)!;
    expect(current.data).toEqual({ counter: committed ? 1 : 0 });
    expect(!!receipt(current, id, {})).toBe(committed);
  });
});
