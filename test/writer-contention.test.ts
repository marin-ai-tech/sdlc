import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { humanEnv, tempDir } from './helpers.js';

describe('Shared writer fence native contention', () => {
  it('four real processes never overlap or lose an acknowledged critical section', async () => {
    const root = tempDir('sdlc-writer-race-');
    const module = new URL('../dist/core/writer-lock.js', import.meta.url).href;
    const go = path.join(root, 'go');
    const critical = path.join(root, 'critical');
    const trace = path.join(root, 'trace');
    const source = `import fs from 'node:fs';const {acquireWriterLock}=await import(${JSON.stringify(module)});
      const wait=()=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
      console.log('ready');while(!fs.existsSync(${JSON.stringify(go)}))wait();
      for(let i=0;i<3;i++){const lease=acquireWriterLock(${JSON.stringify(path.join(root, 'writer.lock'))},10000);
        try{const fd=fs.openSync(${JSON.stringify(critical)},'wx');fs.closeSync(fd);
          fs.appendFileSync(${JSON.stringify(trace)},'start '+process.pid+'\\n');wait();
          fs.appendFileSync(${JSON.stringify(trace)},'end '+process.pid+'\\n');fs.unlinkSync(${JSON.stringify(critical)});
        }finally{lease.release()}}`;
    const children = Array.from({ length: 4 }, () => {
      const child = spawn(process.execPath, ['--input-type=module', '-e', source],
        { env: humanEnv(tempDir('sdlc-writer-race-home-')), windowsHide: true });
      let stderr = '';
      child.stderr.on('data', part => { stderr += part; });
      const ready = new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve());
        child.once('error', reject);
      });
      const result = new Promise<{ code: number | null; stderr: string }>(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 35000);
        child.once('exit', code => { clearTimeout(timer); resolve({ code, stderr }); });
      });
      return { ready, result };
    });
    await Promise.all(children.map(child => child.ready));
    fs.writeFileSync(go, 'go');
    const results = await Promise.all(children.map(child => child.result));
    for (const result of results) expect(result.code, result.stderr).toBe(0);
    const events = fs.readFileSync(trace, 'utf8').trim().split('\n');
    expect(events).toHaveLength(24);
    for (let i = 0; i < events.length; i += 2) expect(events[i + 1]).toBe(events[i].replace('start ', 'end '));
    expect(fs.existsSync(critical)).toBe(false);
  }, 45000);

  it.skipIf(process.platform !== 'win32')('fault-injected unavailable identity keeps PID protected while writes work', () => {
    const root = tempDir('sdlc-provider-unavailable-');
    const module = process.env.SDLC_WRITER_TEST_MODULE ?? new URL('../dist/core/writer-lock.js', import.meta.url).href;
    const source = `import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
      const original=cp.spawnSync;cp.spawnSync=(command,...args)=>String(command).toLowerCase().endsWith('powershell.exe')
        ?{status:null,stdout:'',stderr:'',error:Object.assign(Error('provider denied'),{code:'EACCES'})}:original(command,...args);
      syncBuiltinESMExports();const {acquireWriterLock,inspectWriterLock}=await import(${JSON.stringify(module)});
      const file=${JSON.stringify(path.join(root, 'writer.lock'))};const lease=acquireWriterLock(file,1000);
      console.log(inspectWriterLock(file).state);lease.release();`;
    const env = humanEnv(root);
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source],
      { env, encoding: 'utf8', timeout: 15000 });
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout.trim()).toBe('unknown');
  });
});
