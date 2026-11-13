import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { candidatePathMapper } from '../src/core/candidate-paths.js';
import { submitClaim } from '../src/core/board.js';
import { readBoard } from '../src/core/board-store.js';
import { defaultConfig } from '../src/core/config.js';
import { git as readGit } from '../src/core/git.js';
import { projectPaths } from '../src/core/project.js';
import { checkResultCore } from '../src/core/task-result.js';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

function windowsShortPath(dir: string): string {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0',
    'powershell.exe');
  const command = "$ErrorActionPreference='Stop'; (New-Object -ComObject Scripting.FileSystemObject)"
    + '.GetFolder($env:SDLC_B308_PATH).ShortPath';
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, SDLC_B308_PATH: dir }, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

function resultProject(prefix: string) {
  const top = tempDir('sdlc-candidate-path-long-windows-');
  initGitRepo(top);
  const root = path.join(top, prefix);
  const changeDir = path.join(root, 'openspec/changes/demo');
  write(path.join(changeDir, '.sdlc.yaml'), 'version: 1\nkind: feature\nrisk: low\ntests_locked: true\n');
  write(path.join(changeDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Work\n');
  write(path.join(root, 'src/greet.js'), '// baseline\n');
  git(top, ['add', '-A']);
  git(top, ['commit', '-qm', 'baseline']);
  const base = readGit(top, ['rev-parse', 'HEAD']).stdout;
  write(path.join(root, 'src/greet.js'), '// candidate\n');
  git(top, ['add', '-A']);
  git(top, ['commit', '-qm', 'candidate\n\nSDLC-Change: demo\nSDLC-Task: 1.1']);
  const branch = readGit(top, ['symbolic-ref', '--short', 'HEAD']).stdout;
  const config = defaultConfig();
  const check = (project: string) => checkResultCore(project,
    { id: 'demo', dir: path.join(project, 'openspec/changes/demo'), archived: false }, config, branch, base);
  return { top, root, check };
}

describe.runIf(process.platform === 'win32')('candidate checks through a real Windows short path', () => {
  for (const prefix of ['', 'packages/[app] #1']) {
    it(`keeps the ${prefix ? 'nested' : 'root'} project inside its Git boundary`, ({ skip }) => {
      const fixture = resultProject(prefix);
      const shortTop = windowsShortPath(fixture.top);
      if (path.resolve(shortTop).toLowerCase() === path.resolve(fixture.top).toLowerCase()) {
        skip('No real Windows 8.3 alias on this volume; a separate short-name run is required');
      }
      const shortRoot = path.join(shortTop, prefix);
      expect(fs.realpathSync.native(shortRoot).toLowerCase()).toBe(fs.realpathSync.native(fixture.root).toLowerCase());
      const full = fixture.check(fixture.root);
      const short = fixture.check(shortRoot);
      const gitName = prefix ? `${prefix}/src/greet.js` : 'src/greet.js';
      expect(full.files).toContain(gitName);
      expect(full.problems.filter(problem => problem.code === 'outside_project')).toEqual([]);
      expect(short.files).toContain(gitName);
      expect(short.problems.filter(problem => problem.code === 'outside_project')).toEqual([]);
    }, 30000);
  }
});

describe('candidate Git boundaries and failure controls', () => {
  it('accepts a project name beginning with two dots without accepting a sibling', () => {
    const top = tempDir('sdlc-candidate-dotdot-project-');
    initGitRepo(top);
    const project = path.join(top, '..nested');
    fs.mkdirSync(project);
    const mapper = candidatePathMapper(project);

    expect(mapper('..nested/src/example.ts')).toBe('src/example.ts');
    expect(mapper('..nested-other/src/example.ts')).toBeUndefined();
    expect(mapper('../outside.ts')).toBeUndefined();
  });

  it('retains Git names and forbidden paths for deleted and renamed files, including a neighbouring project', ({ skip }) => {
    const top = tempDir('sdlc-candidate-guard-');
    initGitRepo(top);
    const prefix = 'packages/[app] #1';
    const root = path.join(top, prefix);
    const changeDir = path.join(root, 'openspec/changes/demo');
    write(path.join(changeDir, '.sdlc.yaml'), 'version: 1\nkind: feature\nrisk: low\ntests_locked: true\n');
    write(path.join(changeDir, 'tasks.md'), '# Tasks\n- [ ] 1.1 Work\n');
    write(path.join(root, 'openspec/sdlc.yaml'),
      'enforcement:\n  test_paths: [test/**]\n  protected_paths: [private/**]\nlog:\n  enabled: false\n');
    write(path.join(root, 'test/locked.test.ts'), 'locked\n');
    write(path.join(root, 'private/secret [x].txt'), 'protected\n');
    write(path.join(root, 'src/старый [x].txt'), 'old\n');
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'baseline']);
    const base = readGit(top, ['rev-parse', 'HEAD']).stdout;
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.renameSync(path.join(root, 'test/locked.test.ts'), path.join(root, 'src/moved.test.ts'));
    fs.rmSync(path.join(root, 'src/старый [x].txt'));
    write(path.join(root, 'private/secret [x].txt'), 'changed\n');
    write(path.join(top, 'packages/other/outside.txt'), 'neighbour\n');
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'candidate\n\nSDLC-Change: demo\nSDLC-Task: 1.1']);
    const branch = readGit(top, ['symbolic-ref', '--short', 'HEAD']).stdout;
    const config = defaultConfig();
    config.enforcement.testPaths = ['test/**'];
    config.enforcement.protectedPaths = ['private/**'];
    config.log.enabled = false;
    const ref = { id: 'demo', dir: changeDir, archived: false };
    const result = checkResultCore(root, ref, config, branch, base);
    expect(result.files).toEqual(expect.arrayContaining([
      `${prefix}/test/locked.test.ts`, `${prefix}/src/moved.test.ts`, `${prefix}/src/старый [x].txt`,
      `${prefix}/private/secret [x].txt`, 'packages/other/outside.txt',
    ]));
    expect(result.problems).toEqual(expect.arrayContaining([
      { code: 'forbidden_path', file: `${prefix}/test/locked.test.ts` },
      { code: 'forbidden_path', file: `${prefix}/private/secret [x].txt` },
      { code: 'outside_project', file: 'packages/other/outside.txt' },
    ]));
    expect(result.problems.filter(problem => problem.file === `${prefix}/src/старый [x].txt`)).toEqual([]);
    const cli = runCli(['task', 'check-result', '--branch', branch, '--change', 'demo', '--base', base, '--json'],
      root, humanEnv(tempDir('sdlc-candidate-person-')));
    expect(cli.code, cli.stdout + cli.stderr).toBe(1);
    expect(cli.json().problems).toEqual(result.problems);
    const claim = { id: 'held-b308-claim', item: 'demo#1.1', change: 'demo', task: '1.1', executor: 'mesh',
      agent: 'coder', claimedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString(),
      leaseSeconds: 60, state: 'held' };
    write(path.join(root, 'openspec/.sdlc/board.json'), JSON.stringify({ version: 1, claims: [claim] }));
    const submitted = submitClaim(root, projectPaths(root), config, claim.id, branch, base);
    expect(submitted.result.problems).toEqual(result.problems);
    expect(readBoard(root).claims[0].state).toBe('held');
    if (process.platform === 'win32') {
      const shortTop = windowsShortPath(top);
      if (path.resolve(shortTop).toLowerCase() === path.resolve(top).toLowerCase()) {
        skip('No real Windows 8.3 alias on this volume; a separate short-name guard control is required');
      }
      const shortRoot = path.join(shortTop, prefix);
      expect(fs.realpathSync.native(shortRoot).toLowerCase()).toBe(fs.realpathSync.native(root).toLowerCase());
      const shortResult = checkResultCore(shortRoot,
        { id: 'demo', dir: path.join(shortRoot, 'openspec/changes/demo'), archived: false }, config, branch, base);
      expect(shortResult.files).toEqual(result.files);
      expect(shortResult.problems).toEqual(result.problems);
    }
  }, 120000);

  it('uses the actual project coordinates through a link within the same Git tree', ({ skip }) => {
    const top = tempDir('sdlc-candidate-inside-link-');
    initGitRepo(top);
    const target = path.join(top, 'packages/target');
    const link = path.join(top, 'project-link');
    write(path.join(target, 'src/greet.js'), 'hello\n');
    try {
      fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        skip('Filesystem cannot create a real link; a separate link control is required');
      }
      throw error;
    }
    expect(candidatePathMapper(link)('packages/target/src/greet.js')).toBe('src/greet.js');
    expect(candidatePathMapper(link)('packages/other/outside.js')).toBeUndefined();
  });

  it('refuses a link that leaves the original Git tree for another repository', ({ skip }) => {
    const parent = tempDir('sdlc-candidate-outside-link-');
    const source = path.join(parent, 'source');
    const other = path.join(parent, 'other');
    fs.mkdirSync(source);
    fs.mkdirSync(other);
    initGitRepo(source);
    initGitRepo(other);
    write(path.join(other, 'src/greet.js'), 'hello\n');
    const link = path.join(source, 'other-project');
    try {
      fs.symlinkSync(other, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        skip('Filesystem cannot create a real link; a separate link control is required');
      }
      throw error;
    }
    const sourceHead = readGit(source, ['status', '--porcelain']).stdout;
    const otherHead = readGit(other, ['status', '--porcelain']).stdout;
    let mapped: string | undefined;
    try {
      mapped = candidatePathMapper(link)('src/greet.js');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    }
    expect(mapped).toBeUndefined();
    expect(readGit(source, ['status', '--porcelain']).stdout).toBe(sourceHead);
    expect(readGit(other, ['status', '--porcelain']).stdout).toBe(otherHead);
  });

  it('refuses when physical project resolution fails', () => {
    const root = tempDir('sdlc-candidate-realpath-denied-');
    initGitRepo(root);
    const native = fs.realpathSync.native;
    const denied = Object.assign(new Error('fixture denied realpath'), { code: 'EACCES' });
    let called = false;
    const spy = vi.spyOn(fs.realpathSync, 'native').mockImplementation(((file: fs.PathLike, options?: unknown) => {
      if (path.resolve(String(file)) === path.resolve(root)) {
        called = true;
        throw denied;
      }
      return Reflect.apply(native, fs.realpathSync, [file, options]);
    }) as typeof fs.realpathSync.native);
    let mapped: string | undefined;
    try {
      mapped = candidatePathMapper(root)('src/greet.js');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
    } finally {
      spy.mockRestore();
    }
    expect(called, 'physical project resolution must be attempted').toBe(true);
    expect(mapped).toBeUndefined();
  });

  it('refuses when the Git boundary cannot be read', () => {
    const root = tempDir('sdlc-candidate-no-git-');
    expect(() => candidatePathMapper(root)).toThrow();
  });

  it('keeps a real Git worktree with a .git file within its own boundary', () => {
    const source = tempDir('sdlc-candidate-worktree-source-');
    initGitRepo(source);
    write(path.join(source, 'tracked.txt'), 'initial\n');
    git(source, ['add', 'tracked.txt']);
    git(source, ['commit', '-qm', 'initial']);
    const worktree = path.join(tempDir('sdlc-candidate-worktree-parent-'), 'worktree');
    git(source, ['worktree', 'add', '--detach', worktree]);
    expect(fs.lstatSync(path.join(worktree, '.git')).isFile()).toBe(true);
    expect(candidatePathMapper(worktree)('src/greet.js')).toBe('src/greet.js');
    expect(candidatePathMapper(worktree)('../outside.js')).toBeUndefined();
  });
});
