import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { gitBashOnPath } from '../src/core/claude-git-bash.js';
import { HarnessAdapter } from '../src/executors/harness-adapter.js';
import type { TaskItem } from '../src/core/task-contract.js';
import { tempDir } from './helpers.js';

const PROTECTED = ['DIGITALOCEAN_TOKEN', 'DIGITALOCEAN_ACCESS_TOKEN', 'DO_API_TOKEN',
  'GITHUB_TOKEN', 'GH_TOKEN', 'GIT_ASKPASS'];
const item = { result: { branch: 'sdlc/demo/1.1' } } as TaskItem;

function shell(): string {
  if (process.platform !== 'win32') return '/bin/sh';
  return gitBashOnPath() ?? path.join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git/bin/bash.exe');
}

function fixture(name?: string, value = 'host-only-secret') {
  const environment: NodeJS.ProcessEnv = { PATH: tempDir('e20-empty-path-') };
  if (process.env.SystemRoot) environment.SystemRoot = process.env.SystemRoot;
  if (name) environment[name] = value;
  const executions: Array<ReturnType<typeof spawnSync>> = [];
  const runtime = { get: vi.fn(async () => ({ id: 'one', status: 'SESSION_STATUS_READY' })),
    exec: vi.fn(async (_session: string, argv: string[]) => {
      expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
      // Git's Windows Bash launcher may seed PATH; clear it inside the actual interpreter as well.
      const script = `PATH=\n${argv[2]}`;
      const args = process.platform === 'win32' ? ['--noprofile', '--norc', '-c', script] : ['-c', script];
      const result = spawnSync(shell(), args, { env: environment, encoding: 'utf8', timeout: 5000 });
      expect(result.error, 'A real POSIX shell is required for the preflight oracle').toBeUndefined();
      executions.push(result);
      return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    }), input: vi.fn(async () => {}) };
  const host = { heartbeat: vi.fn(async () => {}), prepare: vi.fn(async () => {}), verify: vi.fn() };
  return { adapter: new HarnessAdapter(runtime as never, host), runtime, host, executions };
}

describe('Real builtins-only Harness credential preflight', () => {
  it.each(PROTECTED)('refuses %s before lease, preparation or task input with no external tools', async (name) => {
    const p = fixture(name);
    await expect(p.adapter.launch('one', item)).rejects.toMatchObject({ code: 'harness_refused' });
    expect(p.executions[0].status).toBe(71);
    expect(p.host.heartbeat).not.toHaveBeenCalled();
    expect(p.host.prepare).not.toHaveBeenCalled();
    expect(p.runtime.input).not.toHaveBeenCalled();
    expect(String(p.executions[0].stdout) + String(p.executions[0].stderr)).not.toContain('host-only-secret');
  });

  it('refuses a present empty credential without external utilities', async () => {
    const empty = fixture('GH_TOKEN', '');
    await expect(empty.adapter.launch('one', item)).rejects.toMatchObject({ code: 'harness_refused' });
  });

  it('permits a clean environment without external utilities or diagnostic noise', async () => {
    const clean = fixture();
    await clean.adapter.launch('one', item);
    expect(clean.executions[0].status).toBe(0);
    expect(clean.executions[0].stderr).toBe('');
    expect(clean.host.heartbeat).toHaveBeenCalledTimes(2);
    expect(clean.runtime.input).toHaveBeenCalledOnce();
  });
});
