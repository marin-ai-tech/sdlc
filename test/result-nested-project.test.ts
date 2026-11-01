import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { submitClaim } from '../src/core/board.js';
import { readBoard } from '../src/core/board-store.js';
import { projectPaths } from '../src/core/project.js';
import { checkResultCore } from '../src/core/task-result.js';
import { git as readGit } from '../src/core/git.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

describe('Git-root versus project-root candidate paths', () => {
  it.each(['packages/app', ''])('matches locked paths in project coordinates: %s', (prefix) => {
    const top = tempDir('e20-monorepo-');
    initGitRepo(top);
    const root = path.join(top, prefix);
    const dir = path.join(root, 'openspec/changes/demo');
    write(path.join(dir, '.sdlc.yaml'), 'version: 1\nkind: feature\nrisk: low\ntests_locked: true\n');
    write(path.join(dir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Work\n');
    write(path.join(root, 'test/locked.test.ts'), 'old');
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'baseline']);
    const base = readGit(top, ['rev-parse', 'HEAD']).stdout;
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.renameSync(path.join(root, 'test/locked.test.ts'), path.join(root, 'src/moved.ts'));
    if (prefix) write(path.join(top, 'outside.txt'), 'outside');
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'result\n\nSDLC-Change: demo\nSDLC-Task: 1.1']);
    const branch = readGit(top, ['symbolic-ref', '--short', 'HEAD']).stdout;
    const config = defaultConfig();
    config.enforcement.testPaths = ['test/**'];
    const result = checkResultCore(root, { id: 'demo', dir, archived: false }, config, branch, base);
    const oldName = prefix ? `${prefix}/test/locked.test.ts` : 'test/locked.test.ts';
    const newName = prefix ? `${prefix}/src/moved.ts` : 'src/moved.ts';
    expect(result.files).toEqual(expect.arrayContaining([oldName, newName]));
    expect(result.problems).toContainEqual({ code: 'forbidden_path', file: oldName });
    if (prefix) expect(result.problems).toContainEqual({ code: 'outside_project', file: 'outside.txt' });
    expect(result.problems.filter((problem) => problem.file === newName)).toEqual([]);
    expect(result.ok).toBe(false);
    write(path.join(root, 'openspec/sdlc.yaml'), 'enforcement:\n  test_paths: [test/**]\nlog:\n  enabled: false\n');
    const cli = runCli(['task', 'check-result', '--branch', branch, '--change', 'demo', '--base', base, '--json'],
      root, humanEnv(tempDir('e20-result-person-')));
    expect(cli.code, cli.stdout + cli.stderr).toBe(1);
    expect(cli.json().problems).toEqual(result.problems);
    const claim = { id: 'held-test-claim', item: 'demo#1.1', change: 'demo', task: '1.1', executor: 'mesh',
      agent: 'coder', claimedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      leaseSeconds: 60, state: 'held' };
    write(path.join(root, 'openspec/.sdlc/board.json'), JSON.stringify({ version: 1, claims: [claim] }));
    config.log.enabled = false;
    const submitted = submitClaim(root, projectPaths(root), config, claim.id, branch, base);
    expect(submitted.result.problems).toEqual(result.problems);
    expect(readBoard(root).claims[0].state).toBe('held');
  });
});
