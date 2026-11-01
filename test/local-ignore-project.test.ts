import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { ensureLocalIgnore } from '../src/core/local-ignore.js';
import { initGitRepo, tempDir, write } from './helpers.js';

describe('Nested project state ownership', () => {
  it('ignores only this project state using literal Git-top coordinates', () => {
    const root = tempDir('sdlc-ignore-nested-');
    initGitRepo(root);
    const project = path.join(root, 'packages/[app]');
    fs.mkdirSync(project, { recursive: true });
    const relative = 'openspec/.sdlc/board.json';
    for (const folder of [project, root, path.join(root, 'packages/other')]) write(path.join(folder, relative), '{}');
    ensureLocalIgnore(project, ['board.json']);
    const ignored = spawnSync('git', ['check-ignore', '--', 'packages/[app]/openspec/.sdlc/board.json'],
      { cwd: root, encoding: 'utf8', timeout: 10000 });
    expect(ignored.status, ignored.stderr).toBe(0);
    expect(spawnSync('git', ['check-ignore', '--', relative, 'packages/other/' + relative],
      { cwd: root, encoding: 'utf8', timeout: 10000 }).status).toBe(1);
  });
});
