import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { appendLocalLog, readLog } from '../src/core/log.js';
import { tempDir, humanEnv } from './helpers.js';

describe('Acknowledged hook observations under contention', () => {
  it('retains an append while a real writer holds the lock beyond the old250ms window', async () => {
    const root = tempDir('sdlc-log-contention-');
    const module = new URL('../dist/core/log-write.js', import.meta.url).href;
    const source = `const {withLogWriter}=await import(${JSON.stringify(module)});
      withLogWriter(${JSON.stringify(root)},()=>{console.log('holding');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5000)});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', source],
      { env: humanEnv(tempDir('sdlc-log-owner-home-')), windowsHide: true });
    let stderr = '';
    child.stderr.on('data', value => { stderr += value; });
    const ended = new Promise<number | null>(resolve => child.once('exit', resolve));
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve());
        child.once('error', reject);
      });
      appendLocalLog(root, defaultConfig(), { event: 'test.contended' });
      expect(await ended, stderr).toBe(0);
      expect(readLog(root).map(entry => entry.event)).toEqual(['test.contended']);
    } finally { clearTimeout(timer); if (child.exitCode === null) child.kill('SIGKILL'); }
  }, 20000);
});
