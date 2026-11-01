import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { callsHumanCommand } from '../src/core/human-command-match.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

describe('Guard neighboring attack cases', () => {
  it('recognizes an escaped newline inside a submitted person command', () => {
    expect(callsHumanCommand('sdlc ap\\\nprove plan')).toBe(true);
  });

  it('protects the actual npx shim through a hard-linked alias', () => {
    const root = tempDir('e20-launcher-alias-');
    const config = defaultConfig();
    config.cli = 'npx --no-install sdlc';
    const shim = path.join(root, 'node_modules/.bin/sdlc');
    write(shim, 'original');
    fs.linkSync(shim, path.join(root, 'alias'));
    for (const [tool, input] of [['Write', { file_path: 'alias', content: 'forged' }],
      ['Bash', { command: 'echo forged > alias' }]] as const) {
      expect(evaluateToolCall(normalizeToolCall(tool, input, root), { paths: projectPaths(root), config }))
        .toMatchObject({ decision: 'deny', rule: 'guard-config' });
    }
  });

  it.each(['cp -R plain stateful destination', 'cp -R -t destination plain stateful'])
    ('checks every static recursive source: %s', (command) => {
      const root = tempDir('e20-copy-multi-');
      const config = defaultConfig();
      config.enforcement.mode = 'warn';
      write(path.join(root, 'plain/a.md'), 'plain');
      write(path.join(root, 'stateful/deep/.sdlc.yaml'), 'version: 1');
      expect(evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config }))
        .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each(['cp -R source* destination', 'Copy-Item "$SOURCE" destination -Recurse',
    'cp -R `printf source` destination'])('does not guess unresolved copy operands safe: %s', (command) => {
    const root = tempDir('e20-copy-unknown-');
    const config = defaultConfig();
    config.enforcement.mode = 'warn';
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config }))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});
