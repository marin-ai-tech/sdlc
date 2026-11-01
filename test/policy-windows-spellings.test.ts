import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir } from './helpers.js';

/**
 * A directory change spelled with `.\` reaches state files on every platform: POSIX decoding reads `.\openspec` as
 * `.openspec`, so the bare name written next lands outside the protected folder unless the command is also read with
 * `\` as a separator, as 0.29.0 did (review F1 of fix-posix-0-30-0).
 */
function decide(command: string) {
  const root = tempDir('sdlc-windows-spellings-');
  fs.mkdirSync(path.join(root, 'openspec', 'notes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notes'), { recursive: true });
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

describe('Directory changes spelled with Windows separators', () => {
  it.each([
    'cd .\\openspec; Set-Content backlog.md x',
    'pushd .\\openspec; Set-Content backlog.md x',
    'Set-Location .\\openspec; Add-Content backlog.md x',
    'cd openspec; Set-Content backlog.md x',
  ])('refuses %s as state-integrity', (command) => {
    expect(decide(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    'cd .\\notes; Set-Content readme.txt x',
    'cd .\\openspec\\notes; Set-Content readme.txt x',
  ])('still allows %s, which writes no state file', (command) => {
    expect(decide(command).decision).not.toBe('deny');
  });
});
