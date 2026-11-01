import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { processIdentity } from '../src/core/process-identity.js';
import { updateBoard, BOARD_LOCK } from '../src/core/board-store.js';
import { acquireWriterLock, inspectWriterLock, recoverWriterLock } from '../src/core/writer-lock.js';
import { tempDir, write, read } from './helpers.js';

function failedPublication(fault: 'write' | 'flush' | 'replaced') {
  const file = path.join(tempDir('sdlc-publication-fault-'), 'writer.lock');
  const module = pathToFileURL(path.resolve('dist/core/writer-lock.js')).href;
  const source = `import fs from 'node:fs'; import {syncBuiltinESMExports} from 'node:module';
    const file=${JSON.stringify(file)}, fault=${JSON.stringify(fault)};
    const write=fs.writeFileSync, flush=fs.fsyncSync; let injected=false, replacement;
    const failure=()=>Object.assign(new Error('owner publication EIO'),{code:'EIO'});
    const owns=fd=>{if(typeof fd!=='number'||!fs.existsSync(file))return false;
      const a=fs.fstatSync(fd),b=fs.statSync(file);return a.dev===b.dev&&a.ino===b.ino;};
    fs.writeFileSync=(...args)=>{if(fault==='write'&&!injected&&owns(args[0])&&String(args[1]).startsWith('{"version":1,')){
      injected=true;write(args[0],String(args[1]).slice(0,17));throw failure();}return write(...args);};
    fs.fsyncSync=fd=>{if(fault!=='write'&&!injected&&owns(fd)){injected=true;
      if(fault==='replaced'){replacement=JSON.stringify({...JSON.parse(fs.readFileSync(file,'utf8')),nonce:'changed-owner'});write(file,replacement);}
      throw failure();}return flush(fd);}; syncBuiltinESMExports();
    const {acquireWriterLock,inspectWriterLock}=await import(${JSON.stringify(module)});
    let firstError;try{const lease=acquireWriterLock(file,1000);lease.release();}catch(error){firstError=error.code;}
    fs.writeFileSync=write;fs.fsyncSync=flush;syncBuiltinESMExports();
    const after=inspectWriterLock(file);let retry=false,retryError;
    if(fault!=='replaced')try{const lease=acquireWriterLock(file,50);lease.release();retry=true;}catch(error){retryError=error.code;}
    console.log(JSON.stringify({injected,firstError,after,retry,retryError,replacement,raw:fs.existsSync(file)?fs.readFileSync(file,'utf8'):undefined}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8', timeout: 15000, windowsHide: true,
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}

describe('Exact instance ownership', () => {
  it.each(['write', 'flush'] as const)('rolls back a failed owner %s publication and permits a same-process retry', fault => {
    const result = failedPublication(fault);
    expect(result.injected).toBe(true);
    expect(result.firstError).toBe('EIO');
    expect(result.after.state).toBe('absent');
    expect(result.retry, result.retryError).toBe(true);
  });

  it('retains a changed owner when failed publication cleanup cannot prove its own bytes', () => {
    const result = failedPublication('replaced');
    expect(result.firstError).toBe('EIO');
    expect(result.raw).toBe(result.replacement);
    expect(JSON.parse(result.raw).nonce).toBe('changed-owner');
  });

  it('reclaims a board lock with a proven different instance even while its PID is live', () => {
    const root = tempDir('sdlc-board-instance-');
    const instance = `${processIdentity(process.pid)}0`;
    write(path.join(root, BOARD_LOCK), JSON.stringify({ pid: process.pid, instance, nonce: 'old' }));
    updateBoard(root, board => { board.dispatches = []; });
    expect(fs.existsSync(path.join(root, BOARD_LOCK))).toBe(false);
  }, 15000);

  it.each(['', '{partial'])('reclaims an aged partial board publication %j', raw => {
    const root = tempDir('sdlc-board-partial-');
    const file = path.join(root, BOARD_LOCK);
    write(file, raw);
    const old = new Date(Date.now() - 180000);
    fs.utimesSync(file, old, old);
    updateBoard(root, () => undefined);
    expect(fs.existsSync(file)).toBe(false);
  }, 15000);

  it('reclaims a partial contender with a proven reused instance, preserving unknown live metadata', () => {
    const root = tempDir('sdlc-partial-contender-');
    const file = path.join(root, 'writer.lock');
    const dir = `${file}.writers`;
    fs.mkdirSync(dir);
    const instance = `${processIdentity(process.pid)}0`;
    const kind = process.platform === 'win32' ? 'w' : 'l';
    const name = `${process.pid}-${kind}-${createHash('sha256').update(instance).digest('hex')}-${randomUUID()}.json`;
    write(path.join(dir, name), '{partial');
    const lease = acquireWriterLock(file, 1000);
    lease.release();
    expect(fs.existsSync(path.join(dir, name))).toBe(false);
    const unknown = `${process.pid}-u-${'0'.repeat(64)}-${randomUUID()}.json`;
    write(path.join(dir, unknown), '{partial');
    expect(() => acquireWriterLock(file, 50)).toThrow();
    expect(read(path.join(dir, unknown))).toBe('{partial');
  });

  it('protects an actual owner and rejects a changed inspection digest', () => {
    const root = tempDir('sdlc-owner-');
    const file = path.join(root, 'writer.lock');
    const lease = acquireWriterLock(file, 50);
    const before = inspectWriterLock(file);
    expect(before.state).toBe('live');
    expect(() => recoverWriterLock(file, 'sha256:' + '0'.repeat(64))).toThrow();
    expect(read(file)).toBe(lease.owner);
    expect(JSON.parse(lease.owner).instance).toBe(processIdentity(process.pid));
    lease.release();
    expect(inspectWriterLock(file).state).toBe('absent');
  });
});
