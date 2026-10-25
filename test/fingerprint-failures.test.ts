import { beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';
import { worktreeFingerprint } from '../src/core/git.js';
import { tempDir } from './helpers.js';

vi.mock('node:child_process', async (original) => ({
  ...await original<typeof import('node:child_process')>(), spawnSync: vi.fn(),
}));
vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>();
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) };
});

describe('B126: partial fingerprints fail closed', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses an unreadable index rather than trusting a negative existence probe', () => {
    const root = tempDir();
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const words = args as string[];
      const stdout = words.includes('--show-toplevel') ? root : words.includes('--show-prefix') ? ''
        : words.includes('--git-path') ? `${root}/unreadable-index` : 'abc';
      return { status: 0, stdout, stderr: '', pid: 1, output: [], signal: null };
    });
    vi.mocked(copyFileSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('index unavailable'), { code: 'EACCES' });
    });
    expect(worktreeFingerprint(root)).toBeUndefined();
    expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => (args as string[]).includes('add'))).toBe(false);
  });

  it.each(['failed', 'empty'])('refuses %s index-path metadata instead of building an unseeded tree', (mode) => {
    const root = tempDir();
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const words = args as string[];
      const indexQuery = words.includes('--git-path');
      const stdout = indexQuery ? '' : words.includes('--show-toplevel') ? root
        : words.includes('--show-prefix') ? '' : 'abc';
      return { status: indexQuery && mode === 'failed' ? 1 : 0,
        stdout, stderr: '', pid: 1, output: [], signal: null };
    });
    expect(worktreeFingerprint(root)).toBeUndefined();
    expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => (args as string[]).includes('add'))).toBe(false);
  });

  it('retains the valid relative index-path fallback for older Git', () => {
    const root = tempDir();
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const words = args as string[];
      const stdout = words.includes('--show-toplevel') ? root : words.includes('--show-prefix') ? ''
        : words.includes('--git-path') ? 'absent-index' : 'abc';
      return { status: words.includes('--path-format=absolute') ? 1 : 0,
        stdout, stderr: '', pid: 1, output: [], signal: null };
    });
    expect(worktreeFingerprint(root)).toBe('git-tree:abc');
    expect(vi.mocked(spawnSync).mock.calls.some(([, args]) =>
      (args as string[]).includes('--git-path') && !(args as string[]).includes('--path-format=absolute'))).toBe(true);
  });

  it('returns no fingerprint when index construction raises an operating-system error', () => {
    const root = tempDir();
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const words = args as string[];
      if (words.includes('add')) throw new Error('index unavailable');
      const stdout = words.includes('--show-toplevel') ? root
        : words.includes('--show-prefix') ? '' : `${root}/absent-index`;
      return { status: 0, stdout, stderr: '', pid: 1, output: [], signal: null };
    });
    expect(worktreeFingerprint(root, ['openspec/'])).toBeUndefined();
  });

  it('does not return a tree when removing an excluded path fails', () => {
    const root = tempDir();
    vi.mocked(spawnSync).mockImplementation((_command, args) => {
      const words = args as string[];
      const stdout = words.includes('--show-toplevel') ? root
        : words.includes('--show-prefix') ? ''
          : words.includes('--git-path') ? `${root}/absent-index` : 'abc';
      return { status: words.includes('rm') ? 1 : 0, stdout, stderr: '', pid: 1, output: [], signal: null };
    });
    expect(worktreeFingerprint(root, ['openspec/'])).toBeUndefined();
    expect(vi.mocked(spawnSync).mock.calls.some(([, args]) => (args as string[])[0] === 'write-tree')).toBe(false);
  });
});
