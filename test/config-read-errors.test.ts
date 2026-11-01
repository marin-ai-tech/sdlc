import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/core/config.js';
import { humanEnv, runCli, tempDir, write } from './helpers.js';

describe('Config absence versus read failure', () => {
  it('defaults only for absence, and refuses an existing non-readable file shape', () => {
    const root = tempDir('e20-config-');
    const file = path.join(root, 'openspec/sdlc.yaml');
    expect(loadConfig(file).enforcement.mode).toBeDefined();
    fs.mkdirSync(file, { recursive: true });
    expect(() => loadConfig(file)).toThrow();
  });

  it('governs a decoy OpenSpec directory from the configured ancestor', () => {
    const root = tempDir('e20-hook-root-');
    write(path.join(root, 'openspec/sdlc.yaml'), 'enforcement:\n  mode: block\n');
    const cwd = path.join(root, 'sub/openspec/changes');
    fs.mkdirSync(cwd, { recursive: true });
    const result = runCli(['hook', 'pre-tool'], cwd, humanEnv(tempDir()), JSON.stringify({ cwd,
      tool_name: 'Edit', tool_input: { file_path: path.join(root, 'openspec/sdlc.yaml') }, skip_log: true }));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('guard-config');
  });

  it('lets a genuine nested configuration govern itself and preserves no-config allowance', () => {
    const root = tempDir('e20-hook-nested-');
    write(path.join(root, 'openspec/sdlc.yaml'), 'enforcement:\n  mode: block\n');
    const cwd = path.join(root, 'sub');
    write(path.join(cwd, 'openspec/sdlc.yaml'), 'enforcement:\n  mode: off\n');
    const input = JSON.stringify({ cwd, tool_name: 'Edit', tool_input: { file_path: 'openspec/sdlc.yaml' } });
    expect(runCli(['hook', 'pre-tool'], cwd, humanEnv(tempDir()), input).stdout).toBe('');
    const outside = tempDir('e20-hook-outside-');
    expect(runCli(['hook', 'pre-tool'], outside, humanEnv(tempDir()), '{}').stdout).toBe('');
  });
});
