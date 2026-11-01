import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { stringify } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { defaultConfig, serializeConfig } from '../src/core/config.js';
import { appendLog } from '../src/core/log.js';
import { processIdentity } from '../src/core/process-identity.js';
import { acquireWriterLock } from '../src/core/writer-lock.js';
import { humanEnv, tempDir, write, read, runCli } from './helpers.js';

function project() {
  const root = tempDir('sdlc-log-diagnostics-');
  write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
  write(path.join(root, 'openspec/sdlc.yaml'), stringify(serializeConfig(defaultConfig())));
  const doctor = () => runCli(['doctor', '--json'], root, humanEnv(tempDir('sdlc-doctor-home-'))).json().checks;
  return { root, doctor };
}

describe('Explicit operational log and lock diagnostics', () => {
  it('failed append emits a diagnostic without changing the underlying decision', () => {
    const { root } = project();
    fs.mkdirSync(path.join(root, 'openspec/.sdlc/log.jsonl'), { recursive: true });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(() => appendLog(root, defaultConfig(), { event: 'test.refused-append' })).not.toThrow();
      expect(stderr.mock.calls.map(args => String(args[0])).join('')).toMatch(/project log pending.*doctor/);
      expect(fs.statSync(path.join(root, 'openspec/.sdlc/log.jsonl')).isDirectory()).toBe(true);
    } finally { stderr.mockRestore(); }
  });

  it('actual linked storage is diagnosed and external bytes stay unchanged', () => {
    const { root, doctor } = project();
    const external = tempDir('sdlc-external-log-');
    write(path.join(external, 'log.jsonl'), 'external bytes\n');
    fs.symlinkSync(external, path.join(root, 'openspec/.sdlc'), 'junction');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try { appendLog(root, defaultConfig(), { event: 'test.linked' }); }
    finally { stderr.mockRestore(); }
    expect(doctor()).toContainEqual(expect.objectContaining({ check: 'project log storage', code: 'log_write' }));
    expect(read(path.join(external, 'log.jsonl'))).toBe('external bytes\n');
    expect(fs.readdirSync(external)).toEqual(['log.jsonl']);
  }, 60000);

  it('actual doctor names fixed protected log and board owners without mutation', () => {
    const { root, doctor } = project();
    const raw = JSON.stringify({ pid: process.pid, nonce: 'legacy-live' });
    for (const name of ['log', 'board']) write(path.join(root, `openspec/.sdlc/${name}.lock`), raw);
    const checks = doctor();
    for (const name of ['log', 'board']) {
      expect(checks).toContainEqual(expect.objectContaining({ check: `${name} writer`, code: 'writer_unknown' }));
      expect(read(path.join(root, `openspec/.sdlc/${name}.lock`))).toBe(raw);
    }
  }, 60000);

  it('actual unrelated live PID remains protected in plugin diagnostics', async () => {
    const { root, doctor } = project();
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {},30000)'],
      { stdio: 'ignore', windowsHide: true });
    const ended = new Promise(resolve => child.once('exit', resolve));
    const file = path.join(root, 'openspec/.sdlc/plugins/state/economy/store.lock');
    const raw = JSON.stringify({ pid: child.pid, nonce: 'legacy-non-sdlc' });
    write(file, raw);
    try {
      const check = doctor().find((entry: { check: string }) => entry.check === 'plugin economy writer');
      expect(check).toMatchObject({ status: 'warn', code: 'writer_unknown' });
      expect(check.fix).toContain('Keep this lock');
      expect(read(file)).toBe(raw);
    } finally { child.kill('SIGKILL'); await ended; }
  }, 60000);

  it('doctor identifies the relative log lock and an unverifiable live PID', () => {
    const { root, doctor } = project();
    const relative = 'openspec/.sdlc/log.lock';
    const file = path.join(root, relative);
    const raw = JSON.stringify({ pid: process.pid, nonce: 'legacy-diagnostic-owner' });
    write(file, raw);
    const check = doctor().find((entry: { check: string }) => entry.check === 'log writer');
    expect(check).toMatchObject({ code: 'writer_unknown', status: 'warn' });
    expect.soft(check.message).toContain(relative);
    expect.soft(check.message).toContain(`PID ${process.pid}`);
    expect(check.message).toMatch(/unknown|unverifiable/i);
    expect(check.message).not.toContain(root);
    expect(check.fix).toContain('Keep this lock');
    expect(read(file)).toBe(raw);
  }, 60000);

  it('doctor identifies a genuinely held modern owner without mutating its lease', () => {
    const { root, doctor } = project();
    const relative = 'openspec/.sdlc/plugins/state/economy/store.lock';
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lease = acquireWriterLock(file, 1000);
    try {
      const check = doctor().find((entry: { check: string }) => entry.check === 'plugin economy writer');
      expect(check).toMatchObject({ code: 'writer_live', status: 'warn' });
      expect.soft(check.message).toContain(relative);
      expect.soft(check.message).toContain(`PID ${process.pid}`);
      expect.soft(check.message).toMatch(/proven|verified/i);
      expect(check.message).not.toContain(root);
      expect(check.fix).toContain('Keep this lock');
      expect(read(file)).toBe(lease.owner);
    } finally { lease.release(); }
  }, 60000);

  it('doctor explains a proven instance mismatch while the recorded PID remains alive', () => {
    const { root, doctor } = project();
    const relative = 'openspec/.sdlc/plugins/state/economy/store.lock';
    const file = path.join(root, relative);
    const identity = processIdentity(process.pid);
    expect(identity).toBeTypeOf('string');
    const raw = JSON.stringify({ version: 1, pid: process.pid, instance: `${identity}0`, nonce: 'old-instance' });
    write(file, raw);
    const check = doctor().find((entry: { check: string }) => entry.check === 'plugin economy writer');
    expect(check).toMatchObject({ code: 'writer_dead', status: 'warn' });
    expect.soft(check.message).toContain(relative);
    expect.soft(check.message).toContain(`PID ${process.pid}`);
    expect.soft(check.message).toMatch(/instance mismatch|different instance/i);
    expect(check.message).not.toContain(root);
    expect(check.fix).toMatch(/stop competing writers/);
    expect(read(file)).toBe(raw);
    expect(() => process.kill(process.pid, 0)).not.toThrow();
  }, 60000);
});
