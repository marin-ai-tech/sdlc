import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { appendLocalLog, appendLog, readLog } from '../src/core/log.js';
import { withLogWriter } from '../src/core/log-write.js';
import { read, tempDir, write } from './helpers.js';

function lock(root: string, content: string, age = 0): string {
  const file = path.join(root, 'openspec/.sdlc/log.lock');
  write(file, content);
  const at = new Date(Date.now() - age);
  fs.utimesSync(file, at, at);
  return file;
}

describe('Recoverable project logging', () => {
  it('reclaims a real dead owner before the next append', () => {
    const root = tempDir('sdlc-log-dead-');
    const child = spawnSync(process.execPath, ['-e', ''], { timeout: 10000 });
    expect(child.status).toBe(0);
    const file = lock(root, JSON.stringify({ pid: child.pid, nonce: 'dead-owner' }));
    appendLog(root, defaultConfig(), { event: 'test.recovered' });
    expect(readLog(root).map(entry => entry.event)).toContain('test.recovered');
    expect(fs.existsSync(file)).toBe(false);
  });

  it.each(['', '{partial'])('reclaims abandoned partial publication: %j', content => {
    const root = tempDir('sdlc-log-partial-');
    const file = lock(root, content, 180000);
    let entered = false;
    withLogWriter(root, () => { entered = true; });
    expect(entered).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
  });

  it('never steals a live legacy owner or changes its nonce', () => {
    const root = tempDir('sdlc-log-live-');
    const content = JSON.stringify({ pid: process.pid, nonce: 'keep-live' });
    const file = lock(root, content, 180000);
    expect(() => withLogWriter(root, () => { throw new Error('must not enter'); })).toThrow();
    expect(read(file)).toBe(content);
  });

  it('retains unparseable raw lines while recognized queued records drain', () => {
    const root = tempDir('sdlc-log-unknown-');
    const config = defaultConfig();
    appendLocalLog(root, config, { event: 'test.queued' });
    const queue = path.join(root, 'openspec/.sdlc/hook-log.jsonl');
    const unknown = 'not-yet-json\n{"future":{"version":99}}\n';
    fs.appendFileSync(queue, unknown);
    appendLog(root, config, { event: 'test.next' });
    expect(readLog(root).map(entry => entry.event)).toEqual(['test.queued', 'test.next']);
    expect(fs.existsSync(queue)).toBe(true);
    expect(read(queue)).toBe(unknown);
    appendLog(root, config, { event: 'test.retry' });
    expect(read(queue)).toBe(unknown);
    expect(readLog(root).filter(entry => entry.event === 'test.queued')).toHaveLength(1);
  });
});
