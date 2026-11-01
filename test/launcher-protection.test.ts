import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

describe('Selected launcher integrity', () => {
  it.each(['node_modules/.bin/sdlc', 'node_modules/.bin/sdlc.cmd', 'node_modules/.bin/sdlc.ps1'])
    ('protects the configured npx shim: %s', (file) => {
      const root = tempDir('e20-npx-');
      const config = defaultConfig();
      config.cli = 'npx --no-install sdlc';
      for (const [tool, input] of [['Write', { file_path: file, content: 'forged' }],
        ['Bash', { command: `echo forged > ${file}` }]] as const) {
        expect(evaluateToolCall(normalizeToolCall(tool, input, root), { paths: projectPaths(root), config }))
          .toMatchObject({ decision: 'deny', rule: 'guard-config' });
      }
    });

  it.each(['yarn sdlc', 'pnpm sdlc'])('compares only the relevant package script for %s', (cli) => {
    const root = tempDir('e20-script-');
    const config = defaultConfig();
    config.cli = cli;
    const before = JSON.stringify({ scripts: { sdlc: 'sdlc', test: 'old' }, name: 'demo' });
    write(path.join(root, 'package.json'), before);
    const decide = (content: string) => evaluateToolCall(normalizeToolCall('Write',
      { file_path: 'package.json', content }, root), { paths: projectPaths(root), config });
    expect(decide(JSON.stringify({ scripts: { sdlc: 'echo bypass', test: 'old' }, name: 'demo' })))
      .toMatchObject({ decision: 'deny', rule: 'guard-config' });
    expect(decide(JSON.stringify({ scripts: { sdlc: 'sdlc', test: 'new' }, name: 'changed' })).decision)
      .not.toBe('deny');
  });
});
