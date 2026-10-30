import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { callPlugin } from '../dist/plugins/broker.js';
import { readStore } from '../dist/plugins/store.js';
import { readStored, storagePath } from '../dist/plugins/activation.js';
import { withRecoveryEntry } from '../dist/plugins/recovery-lock.js';
import { pluginProject, pluginRequest } from './fixtures/plugin-project.js';
import { humanEnv, REPO_ROOT, tempDir } from './helpers.js';

const children: ChildProcess[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(children.splice(0).map((child) => stop(child)));
});

async function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGKILL');
  });
}

function entry(source: string): string {
  const file = path.join(tempDir('sdlc-recovery-child-'), 'run.mjs');
  fs.writeFileSync(file, source);
  return file;
}

function holding(root: string, relative: string, bakery = false): Promise<ChildProcess> {
  const module = new URL('../dist/plugins/activation.js', import.meta.url).href;
  const entryModule = new URL('../dist/plugins/recovery-lock.js', import.meta.url).href;
  const source = `import {withPluginLock} from ${JSON.stringify(module)};
    ${bakery ? `import {withRecoveryEntry} from ${JSON.stringify(entryModule)};` : ''}
    ${bakery ? `withRecoveryEntry(${JSON.stringify(root)},()=>` : ''}
    withPluginLock(${JSON.stringify(root)},${JSON.stringify(relative)},()=>{
      console.log('holding');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);
    })${bakery ? ')' : ''};`;
  const child = spawn(process.execPath, [entry(source)], { cwd: REPO_ROOT,
    env: humanEnv(tempDir('sdlc-recovery-human-')), stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => { void stop(child); reject(new Error(`Lock child did not start: ${stderr}`)); }, 10_000);
    child.stderr!.on('data', (part) => { stderr += part.toString(); });
    child.stdout!.on('data', () => { clearTimeout(timer); resolve(child); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Lock child exited ${code}: ${stderr}`)); });
  });
}

function contender(root: string, gate: string, critical: string, trace: string) {
  const module = new URL('../dist/plugins/recovery.js', import.meta.url).href;
  const source = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    import {recoverPlugin} from ${JSON.stringify(module)};
    const open=fs.openSync,unlink=fs.unlinkSync,critical=${JSON.stringify(critical)},trace=${JSON.stringify(trace)};
    const fixed=${JSON.stringify(storagePath(root, 'recovery.lock'))};
    fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===fixed&&args[0]==='wx'){
      try{fs.closeSync(open(critical,'wx'))}catch{process.exit(91)}
      fs.appendFileSync(trace,'start\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);
    }return fd};
    fs.unlinkSync=(file)=>{if(file===fixed&&fs.existsSync(critical)){
      fs.appendFileSync(trace,'end\\n');unlink(critical)}return unlink(file)};syncBuiltinESMExports();
    console.log('ready');const deadline=Date.now()+10000;
    while(!fs.existsSync(${JSON.stringify(gate)})){if(Date.now()>deadline)process.exit(92);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5)}
    for(let attempt=0;attempt<20;attempt++)try{
      console.log(JSON.stringify(recoverPlugin(${JSON.stringify(root)},'economy')));process.exit(0);
    }catch(error){if(error.code!=='plugin_busy'){console.log(error.code);process.exit(1)}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10)}process.exit(2);`;
  const child = spawn(process.execPath, [entry(source)], { cwd: REPO_ROOT,
    env: humanEnv(tempDir('sdlc-recovery-human-')), stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '';
  let stderr = '';
  let readyResolve: () => void;
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  child.stdout!.on('data', (part) => { stdout += part.toString(); if (stdout.includes('ready')) readyResolve(); });
  child.stderr!.on('data', (part) => { stderr += part.toString(); });
  const result = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const timer = setTimeout(() => { void stop(child); }, 15_000);
    child.once('exit', (code) => { clearTimeout(timer); readyResolve(); resolve({ code, stdout, stderr }); });
  });
  return { ready, result };
}

function recoverAt(root: string, request: string, now: number) {
  const module = new URL('../dist/plugins/recovery.js', import.meta.url).href;
  const source = `import {recoverPlugin} from ${JSON.stringify(module)};Date.now=()=>${now};
    try { console.log(JSON.stringify(recoverPlugin(${JSON.stringify(root)},'economy',${JSON.stringify(request)}))); }
    catch(error){console.log(JSON.stringify({code:error.code}));process.exitCode=1;}`;
  const child = spawnSync(process.execPath, [entry(source)], { cwd: REPO_ROOT,
    env: humanEnv(tempDir('sdlc-recovery-human-')), encoding: 'utf8', timeout: 10_000 });
  return { code: child.status, result: JSON.parse(child.stdout), stderr: child.stderr };
}

describe('Recovery guard and retained request reconciliation', () => {
  it('recovers after an actual child is killed while holding the recovery guard', async () => {
    const p = await pluginProject();
    const child = await holding(p.root, 'recovery.lock');
    const old = readStored(p.root, 'recovery.lock');
    expect(old).toMatchObject({ pid: child.pid });
    await stop(child);
    const result = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json()).toMatchObject({ name: 'economy', status: 'reconciled', revision: 0 });
    expect(readStored(p.root, 'recovery.lock')).toBeUndefined();
    expect(readStore(p.root, 'economy')!.revision).toBe(0);
  });

  it('never steals a live recovery guard or changes its nonce', async () => {
    const p = await pluginProject();
    const child = await holding(p.root, 'recovery.lock');
    const lock = storagePath(p.root, 'recovery.lock');
    const before = fs.readFileSync(lock);
    fs.utimesSync(lock, 0, 0);
    const result = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(result.json()).toMatchObject({ status: [{ code: 'plugin_busy' }] });
    expect(fs.readFileSync(lock)).toEqual(before);
    await stop(child);
  });

  it('recovers a killed bakery owner without creating another unrecoverable fixed lock', async () => {
    const p = await pluginProject();
    const child = await holding(p.root, 'recovery.lock', true);
    const directory = storagePath(p.root, 'recovery-entries');
    expect(fs.readdirSync(directory)).toHaveLength(1);
    await stop(child);
    const result = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(fs.readdirSync(directory)).toEqual([]);
    expect(readStored(p.root, 'recovery.lock')).toBeUndefined();
  });

  it('serializes concurrent dead-guard reclaimers and never steals the new live winner', async () => {
    const p = await pluginProject();
    const stale = await holding(p.root, 'recovery.lock');
    await stop(stale);
    const directory = tempDir('sdlc-recovery-race-');
    const gate = path.join(directory, 'go');
    const critical = path.join(directory, 'critical');
    const trace = path.join(directory, 'trace');
    const contenders = [contender(p.root, gate, critical, trace), contender(p.root, gate, critical, trace)];
    await Promise.all(contenders.map((item) => item.ready));
    fs.writeFileSync(gate, 'go');
    const results = await Promise.all(contenders.map((item) => item.result));
    for (const result of results) expect([0, 2], result.stdout + result.stderr).toContain(result.code);
    expect(results.some((result) => result.code === 0)).toBe(true);
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n');
    expect(events.length % 2).toBe(0);
    events.forEach((event, index) => expect(event).toBe(index % 2 ? 'end' : 'start'));
    expect(fs.existsSync(critical)).toBe(false);
    expect(p.cli(['plugins', 'recover', 'economy', '--json']).code).toBe(0);
    expect(readStore(p.root, 'economy')!.revision).toBe(0);
  }, 40_000);

  it('refuses live choosing entries and preserves metadata whose nonce changed', async () => {
    const p = await pluginProject();
    const directory = storagePath(p.root, 'recovery-entries/unused.json', true);
    const ownerDirectory = path.dirname(directory);
    const nonce = '1'.repeat(32);
    const file = path.join(ownerDirectory, `${process.pid}-${nonce}.json`);
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, nonce, choosing: true, ticket: 0 }));
    const before = fs.readFileSync(file);
    expect(p.cli(['plugins', 'recover', 'economy', '--json']).json())
      .toMatchObject({ status: [{ code: 'plugin_busy' }] });
    expect(fs.readFileSync(file)).toEqual(before);
    fs.unlinkSync(file);
    withRecoveryEntry(p.root, () => {
      const own = path.join(ownerDirectory, fs.readdirSync(ownerDirectory)[0]);
      const value = JSON.parse(fs.readFileSync(own, 'utf8'));
      fs.writeFileSync(own, JSON.stringify({ ...value, nonce: '2'.repeat(32) }));
    });
    const changed = fs.readdirSync(ownerDirectory);
    expect(changed).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(ownerDirectory, changed[0]), 'utf8')).nonce).toBe('2'.repeat(32));
  });

  it('cleans a real crashed partial choosing publication without trusting its incomplete payload', async () => {
    const p = await pluginProject();
    const module = new URL('../dist/plugins/recovery-lock.js', import.meta.url).href;
    const source = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
      import {withRecoveryEntry} from ${JSON.stringify(module)};
      const open=fs.openSync,write=fs.writeFileSync;let owner;
      fs.openSync=(file,...args)=>{const fd=open(file,...args);
        if(String(file).includes('recovery-entries')&&String(file).endsWith('.json'))owner=fd;return fd};
      fs.writeFileSync=(fd,...args)=>{if(fd===owner){fs.writeSync(fd,'{');process.exit(93)}return write(fd,...args)};
      syncBuiltinESMExports();withRecoveryEntry(${JSON.stringify(p.root)},()=>process.exit(94));`;
    const child = spawnSync(process.execPath, [entry(source)], { cwd: REPO_ROOT,
      env: humanEnv(tempDir('sdlc-recovery-human-')), timeout: 10_000 });
    expect(child.status, child.stderr?.toString()).toBe(93);
    const directory = storagePath(p.root, 'recovery-entries');
    expect(fs.readdirSync(directory)).toHaveLength(1);
    const result = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('bounds a scan and safely drains excessive dead contender metadata over retries', async () => {
    const p = await pluginProject();
    const child = await holding(p.root, 'recovery.lock');
    await stop(child);
    const directory = path.dirname(storagePath(p.root, 'recovery-entries/unused.json', true));
    for (let index = 0; index < 129; index++) {
      const nonce = index.toString(16).padStart(32, '0');
      fs.writeFileSync(path.join(directory, `${child.pid}-${nonce}.json`),
        JSON.stringify({ pid: child.pid, nonce, choosing: false, ticket: 1 }));
    }
    expect(p.cli(['plugins', 'recover', 'economy', '--json']).json())
      .toMatchObject({ status: [{ code: 'plugin_busy' }] });
    const result = p.cli(['plugins', 'recover', 'economy', '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it('retained broker results and recovery survive a 120 second clock rollback', async () => {
    const p = await pluginProject({ output: 'committed', state: { count: 1 } });
    const request = pluginRequest();
    const committed = await callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, request);
    const file = storagePath(p.root, 'state/economy/store.json');
    const before = fs.readFileSync(file);
    const rolledBack = Date.now() - 120_000;
    vi.spyOn(Date, 'now').mockReturnValue(rolledBack);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, request)).resolves.toEqual(committed);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', { changed: true }, p.actor, request))
      .rejects.toMatchObject({ code: 'plugin_request_conflict' });
    const recovered = recoverAt(p.root, request, rolledBack);
    expect(recovered.code, recovered.stderr).toBe(0);
    expect(recovered.result).toMatchObject({ outcome: { status: 'committed', request, transaction: committed.transaction } });
    expect(fs.readFileSync(file)).toEqual(before);
  });

  it('still rejects new future IDs and expired/compacted requests after clock rollback', async () => {
    const p = await pluginProject({ output: 'committed', state: { count: 1 } });
    const issued = Date.now();
    const old = pluginRequest(issued);
    await callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, old);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(issued - 120_000);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, pluginRequest(issued)))
      .rejects.toMatchObject({ code: 'plugin_request' });
    const future = recoverAt(p.root, pluginRequest(issued), issued - 120_000);
    expect(future.result).toMatchObject({ code: 'plugin_request' });
    clock.mockReturnValue(issued + 86_400_100);
    await callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, pluginRequest(issued + 86_400_100));
    expect(readStore(p.root, 'economy')!.receipts.some((receipt) => receipt.id === old)).toBe(false);
    clock.mockReturnValue(issued - 120_000);
    await expect(callPlugin(p.root, p.config, 'economy', 'record', {}, p.actor, old))
      .rejects.toMatchObject({ code: 'plugin_request_expired' });
    expect(recoverAt(p.root, old, issued - 120_000).result).toMatchObject({ outcome: { status: 'outcome_not_retained' } });
    expect(readStore(p.root, 'economy')!.revision).toBe(2);
  });
});
