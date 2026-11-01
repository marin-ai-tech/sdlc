import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { doctorChecks } from '../src/core/doctor.js';
import { humanEnv, runCli, tempDir, write } from './helpers.js';

const { errors } = vi.hoisted(() => ({ errors: new Map<string, string>() }));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
    const code = errors.get(String(args[0]));
    if (code) throw Object.assign(new Error('injected read failure'), { code });
    return actual.readFileSync(...args);
  } };
});

afterEach(() => errors.clear());

describe('Config permission and I/O diagnostics', () => {
  it.each(['EACCES', 'EIO'])('retains %s consistently through load and doctor', (code) => {
    const root = tempDir('e20-config-io-');
    const file = path.join(root, 'openspec/sdlc.yaml');
    write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    write(file, 'enforcement:\n  mode: block\n');
    errors.set(file, code);
    expect(() => loadConfig(file)).toThrow(code);
    expect(doctorChecks({ root, locale: 'en' }).find((check) => check.check === 'sdlc.yaml'))
      .toMatchObject({ status: 'error', code: 'config_read', message: expect.stringContaining(code) });
    errors.clear();
    expect(loadConfig(path.join(root, 'missing.yaml')).enforcement.mode).toBeDefined();
  });

  it('reports a native existing-directory read error through a real command and doctor', () => {
    const root = tempDir('e20-config-cli-');
    write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    write(path.join(root, 'openspec/sdlc.yaml/not-a-file'), 'existing directory');
    const env = humanEnv(tempDir('e20-config-person-'));
    const command = runCli(['status', '--json'], root, env);
    expect(command.code).toBe(1);
    expect(command.stdout).toContain('config_read');
    const doctor = runCli(['doctor', '--json'], root, env);
    expect(doctor.json().checks.find((check: { check: string }) => check.check === 'sdlc.yaml'))
      .toMatchObject({ status: 'error', code: 'config_read' });
  });
});
