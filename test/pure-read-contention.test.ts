import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { boardTaskListing } from '../src/core/board.js';
import { projectPaths } from '../src/core/project.js';
import { callPlugin } from '../dist/plugins/broker.js';
import { storagePath } from '../dist/plugins/activation.js';
import { pluginProject } from './fixtures/plugin-project.js';
import { tempDir, write, read } from './helpers.js';

describe('Pure reads under a live writer', () => {
  it('board listing observes an atomic snapshot without acquiring or changing the live lock', () => {
    const root = tempDir('sdlc-pure-board-');
    write(path.join(root, 'openspec/config.yaml'), 'schema: spec-driven\n');
    const file = path.join(root, 'openspec/.sdlc/board.lock');
    const owner = `${process.pid} retained-owner`;
    write(file, owner);
    expect(boardTaskListing(root, projectPaths(root), defaultConfig()).tasks).toEqual([]);
    expect(read(file)).toBe(owner);
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/board.json'))).toBe(false);
  }, 15000);

  it('read plugin operation does not compete for the activation writer lock', async () => {
    const p = await pluginProject({ output: 42 }, { operations: {
      quote: { access: 'read', input: { type: 'object' }, output: { type: 'number' } },
    }, commands: {}, tools: {}, hooks: {} });
    const file = storagePath(p.root, 'activation.lock', true);
    const owner = JSON.stringify({ pid: process.pid, nonce: 'live' });
    write(file, owner);
    expect(await callPlugin(p.root, p.config, 'economy', 'quote', {}, { origin: 'mcp' }))
      .toMatchObject({ output: 42 });
    expect(read(file)).toBe(owner);
  }, 30000);
});
