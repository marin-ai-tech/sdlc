import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { humanEnv, tempDir } from './helpers.js';
import { callPlugin } from '../dist/plugins/broker.js';
import { readStore } from '../dist/plugins/store.js';
import { projectEvents } from '../dist/plugins/events.js';
import { loadConfig } from '../dist/core/config.js';
import { appendLog, readLog } from '../dist/core/log.js';
import { withLogWriter } from '../dist/core/log-write.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';

const response = { output: { ok: true }, state: { counter: 1 }, events: [{ name: 'sampled', data: { value: 5 } }] };

const nodeScript = (root: string, script: string) => promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
  cwd: root, env: humanEnv(tempDir('sdlc-plugin-child-')), timeout: 20000, maxBuffer: 1024 * 1024,
});

describe('Broker transactions and attributed event projection', () => {
  it('State and event persistence, replay without any new worker, and request conflict', async () => {
    const p = await pluginProject(response);
    const id = pluginRequest();
    const first = await callPlugin(p.root, p.config, 'economy', 'record', { a: 1, b: 2 }, p.actor, id);
    expect(first.output).toEqual({ ok: true });
    const store = readStore(p.root, 'economy')!;
    expect(store).toMatchObject({ revision: 1, data: { counter: 1 }, pending: [] });
    const event = readLog(p.root).find((e) => e.plugin)!;
    expect(event).toMatchObject({ event: 'economy.sampled', executor: 'mesh',
      plugin: { digest: p.snapshot.digest, name: 'economy', payload: { value: 5 }, request: id } });
    expect(event.plugin!.eventId).toContain(store.stateId);
    expect(await callPlugin(p.root, p.config, 'economy', 'record', { b: 2, a: 1 }, p.actor, id)).toEqual(first);
    const broker = new URL('../dist/plugins/broker.js', import.meta.url).href;
    const cfg = new URL('../dist/core/config.js', import.meta.url).href;
    const script = `import wt from 'node:worker_threads'; import {syncBuiltinESMExports} from 'node:module';
      wt.Worker=class {constructor(){throw Error('Replay started a worker')}}; syncBuiltinESMExports();
      const {callPlugin}=await import(${JSON.stringify(broker)}); const {loadConfig}=await import(${JSON.stringify(cfg)});
      console.log(JSON.stringify(await callPlugin(${JSON.stringify(p.root)},loadConfig(${JSON.stringify(p.file)}),
        'economy','record',{b:2,a:1},${JSON.stringify(p.actor)},${JSON.stringify(id)})));`;
    expect(JSON.parse((await nodeScript(p.root, script)).stdout)).toEqual(first);
    expect(readStore(p.root, 'economy')!.revision).toBe(1);
    expect(readLog(p.root).filter((e) => e.plugin)).toHaveLength(1);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', { a: 2 }, p.actor, id))
      .rejects.toMatchObject({ code: 'plugin_request_conflict' });
  });

  it('Logging disabled leaves authoritative events and can project them after re-enabling', async () => {
    const p = await pluginProject(response);
    p.raw.log = { ...(p.raw.log as object), enabled: false };
    fs.writeFileSync(p.file, stringify(p.raw));
    const config = loadConfig(p.file);
    await callPlugin(p.root, config, 'economy', 'record', {}, p.actor, pluginRequest());
    const store = readStore(p.root, 'economy')!;
    expect(store.pending).toHaveLength(1);
    expect(fs.existsSync(path.join(p.root, 'openspec/.sdlc/log.jsonl'))).toBe(false);
    config.log.enabled = true;
    p.raw.log = { ...(p.raw.log as object), enabled: true };
    fs.writeFileSync(p.file, stringify(p.raw));
    expect(projectEvents(p.root, config, 'economy', store.stateId)).toEqual({ projected: 1, pending: 0 });
    expect(readStore(p.root, 'economy')!.pending).toEqual([]);
    expect(readLog(p.root).filter((e) => e.plugin)).toHaveLength(1);
  });

  it.each(['prefix', 'flush'])('Projection %s failure retains the complete authoritative batch for retry', async (fault) => {
    const p = await pluginProject(response);
    p.raw.log = { ...(p.raw.log as object), enabled: false };
    fs.writeFileSync(p.file, stringify(p.raw));
    await callPlugin(p.root, loadConfig(p.file), 'economy', 'record', {}, p.actor, pluginRequest());
    const state = readStore(p.root, 'economy')!;
    p.raw.log = { ...(p.raw.log as object), enabled: true };
    fs.writeFileSync(p.file, stringify(p.raw));
    const events = new URL('../dist/plugins/events.js', import.meta.url).href;
    const cfg = new URL('../dist/core/config.js', import.meta.url).href;
    const log = path.join(p.root, 'openspec/.sdlc/log.jsonl');
    const script = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
      const opened=new Set(); const open=fs.openSync; const write=fs.writeSync; const flush=fs.fsyncSync;
      fs.openSync=(file,...args)=>{const fd=open(file,...args); if(file===${JSON.stringify(log)})opened.add(fd);return fd};
      ${fault === 'prefix'
        ? "fs.writeSync=(fd,bytes,offset,count,...args)=>{if(opened.has(fd)){write(fd,bytes,offset,Math.min(count,16),...args);throw Error('Injected prefix failure')}return write(fd,bytes,offset,count,...args)};"
        : "fs.fsyncSync=(fd)=>{if(opened.has(fd))throw Error('Injected flush failure');return flush(fd)};"}
      syncBuiltinESMExports(); const {projectEvents}=await import(${JSON.stringify(events)});
      const {loadConfig}=await import(${JSON.stringify(cfg)});
      console.log(JSON.stringify(projectEvents(${JSON.stringify(p.root)},loadConfig(${JSON.stringify(p.file)}),'economy',${JSON.stringify(state.stateId)})));`;
    expect(JSON.parse((await nodeScript(p.root, script)).stdout).pending).toBe(1);
    expect(readStore(p.root, 'economy')!.pending).toEqual(state.pending);
    expect(projectEvents(p.root, loadConfig(p.file), 'economy', state.stateId).pending).toBe(0);
    expect(readLog(p.root).filter((e) => e.plugin)).toHaveLength(1);
  });

  it('concurrent core writers preserve complete distinct records in the shared log', async () => {
    const p = await pluginProject();
    const module = new URL('../dist/core/log.js', import.meta.url).href;
    const config = JSON.stringify(p.config);
    await Promise.all([0, 1].map((writer) => nodeScript(p.root,
      `const {appendLog}=await import(${JSON.stringify(module)}); for(let i=0;i<8;i++)
       appendLog(${JSON.stringify(p.root)},${config},{event:'writer.${writer}',detail:String(i)});`)));
    const entries = readLog(p.root);
    for (const writer of [0, 1]) expect(entries.filter((e) => e.event === `writer.${writer}`).map((e) => e.detail))
      .toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
  });

  it('Shared writer contention retains pending events; a partial tail cannot hide a retried event', async () => {
    const p = await pluginProject(response);
    const lock = path.join(p.root, 'openspec/.sdlc/log.lock');
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, nonce: 'live-writer' }));
    await callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, pluginRequest());
    const store = readStore(p.root, 'economy')!;
    expect(store.pending).toHaveLength(1);
    fs.unlinkSync(lock);
    const log = path.join(p.root, 'openspec/.sdlc/log.jsonl');
    fs.writeFileSync(log, '{"plugin":{"eventId":"partial-prefix');
    expect(projectEvents(p.root, p.config, 'economy', store.stateId).pending).toBe(0);
    expect(readLog(p.root).filter((e) => e.plugin)).toHaveLength(1);
    const complete = fs.readFileSync(log, 'utf8').split('\n')[1];
    fs.appendFileSync(log, complete + '\n');
    expect(readLog(p.root).filter((e) => e.plugin)).toHaveLength(1);
    const core = { event: 'task.test', detail: 'same legacy event' };
    appendLog(p.root, p.config, core);
    appendLog(p.root, p.config, core);
    expect(readLog(p.root).filter((e) => e.event === core.event)).toHaveLength(2);
  });

  it('Mixed invalid effects leave all authoritative files unchanged', async () => {
    const p = await pluginProject({ ...response, events: [...response.events, { name: 'gate.plan.approved', data: {} }] });
    const file = path.join(p.root, 'openspec/.sdlc/plugins/state/economy/store.json');
    const before = fs.readFileSync(file);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, pluginRequest()))
      .rejects.toMatchObject({ code: 'plugin_event' });
    expect(fs.readFileSync(file)).toEqual(before);
    expect(readLog(p.root)).toEqual([]);
  });

  it('Acceptance never executes a guest, even if its allocator loops', async () => {
    const p = await pluginProject({ output: 1 }, {}, { alloc: '(loop $spin (br $spin)) (i32.const 0)' });
    expect(readStore(p.root, 'economy')!.revision).toBe(0);
    expect(p.cli(['plugins', 'list', '--json']).json().plugins[0].active).toBe(true);
    withLogWriter(p.root, () => expect(readStore(p.root, 'economy')!.receipts).toEqual([]));
  });
});
