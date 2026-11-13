import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { ensureLocalIgnore } from '../src/core/local-ignore.js';
import { initGitRepo, tempDir, write } from './helpers.js';

function gitCheckIgnore(root: string, relative: string): number | null {
  const result = spawnSync('git', ['check-ignore', '--', relative], { cwd: root, encoding: 'utf8', timeout: 10000 });
  expect([0, 1], result.stderr).toContain(result.status);
  return result.status;
}

function windowsShortPath(dir: string): string {
  const powershell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0',
    'powershell.exe');
  const command = "$ErrorActionPreference='Stop'; (New-Object -ComObject Scripting.FileSystemObject)"
    + '.GetFolder($env:SDLC_B307_PATH).ShortPath';
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, SDLC_B307_PATH: dir }, encoding: 'utf8', timeout: 10000,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim();
}

describe.runIf(process.platform === 'win32')('Windows short project paths', () => {
  for (const kind of ['root', 'nested'] as const) {
    it(`keeps ${kind} project exclusions scoped through the real short path`, ({ skip }) => {
      const root = tempDir('sdlc-local-ignore-long-windows-');
      initGitRepo(root);
      const alias = windowsShortPath(root);
      if (path.resolve(alias).toLowerCase() === path.resolve(root).toLowerCase()) {
        skip('No Windows 8.3 alias on this volume; a separate run with a real short name is required');
      }
      expect(fs.realpathSync.native(alias).toLowerCase()).toBe(fs.realpathSync.native(root).toLowerCase());
      const nested = path.join('packages', '[app] #1');
      const project = kind === 'root' ? root : path.join(root, nested);
      const spelledProject = kind === 'root' ? alias : path.join(alias, nested);
      const other = kind === 'root' ? path.join(root, 'packages', 'other') : root;
      for (const folder of [project, other]) {
        write(path.join(folder, 'openspec/.sdlc/board.json'), '{}\n');
        write(path.join(folder, 'openspec/.sdlc/board.lock'), 'lock\n');
      }
      write(path.join(project, 'ordinary.txt'), 'untracked\n');
      const excludeFile = path.join(root, '.git/info/exclude');
      fs.appendFileSync(excludeFile, '\n# existing rule\nexisting-only.txt\n');
      const before = fs.readFileSync(excludeFile, 'utf8');

      ensureLocalIgnore(spelledProject, ['board.json', 'board.lock']);
      const once = fs.readFileSync(excludeFile, 'utf8');
      ensureLocalIgnore(spelledProject, ['board.json', 'board.lock']);
      expect.soft(once.startsWith(before), 'existing exclude bytes remain').toBe(true);
      expect.soft(fs.readFileSync(excludeFile, 'utf8'), 'repeated call is idempotent').toBe(once);
      for (const entry of ['board.json', 'board.lock']) {
        expect.soft(gitCheckIgnore(root, path.relative(root, path.join(project, 'openspec/.sdlc', entry))),
          `${kind}: current project ${entry} is ignored`).toBe(0);
        expect.soft(gitCheckIgnore(root, path.relative(root, path.join(other, 'openspec/.sdlc', entry))),
          `${kind}: another project ${entry} remains visible`).toBe(1);
      }
      const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'],
        { cwd: root, encoding: 'utf8', timeout: 10000 });
      expect(status.status, status.stderr).toBe(0);
      expect(status.stdout).toContain('ordinary.txt');
    }, 30000);
  }
});

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

  it('keeps root project state separate from a neighbouring project on a full path', () => {
    const root = tempDir('sdlc-ignore-root-');
    initGitRepo(root);
    const other = path.join(root, 'packages/other');
    for (const folder of [root, other]) {
      write(path.join(folder, 'openspec/.sdlc/board.json'), '{}');
      write(path.join(folder, 'openspec/.sdlc/board.lock'), 'lock\n');
    }
    write(path.join(root, 'ordinary.txt'), 'ordinary\n');
    ensureLocalIgnore(root, ['board.json', 'board.lock']);
    for (const entry of ['board.json', 'board.lock']) {
      expect(gitCheckIgnore(root, `openspec/.sdlc/${entry}`)).toBe(0);
      expect(gitCheckIgnore(root, `packages/other/openspec/.sdlc/${entry}`)).toBe(1);
    }
    expect(gitCheckIgnore(root, 'ordinary.txt')).toBe(1);
  });

  it('retains prior rules and only excludes the literal nested project, idempotently', () => {
    const root = tempDir('sdlc-ignore-literal-');
    initGitRepo(root);
    const project = path.join(root, 'packages/[app] #1');
    const other = path.join(root, 'packages/a #1');
    for (const folder of [root, project, other]) write(path.join(folder, 'openspec/.sdlc/board.json'), '{}');
    write(path.join(project, 'ordinary.txt'), 'ordinary\n');
    const exclude = path.join(root, '.git/info/exclude');
    fs.appendFileSync(exclude, '\n# previous exact bytes\nkeep-this-rule\n../../obsolete/openspec/.sdlc/board.json\n');
    const previous = fs.readFileSync(exclude, 'utf8');

    ensureLocalIgnore(project, ['board.json']);
    const once = fs.readFileSync(exclude, 'utf8');
    ensureLocalIgnore(project, ['board.json']);

    expect(once.startsWith(previous)).toBe(true);
    expect(fs.readFileSync(exclude, 'utf8')).toBe(once);
    expect(gitCheckIgnore(root, 'packages/[app] #1/openspec/.sdlc/board.json')).toBe(0);
    expect(gitCheckIgnore(root, 'packages/a #1/openspec/.sdlc/board.json')).toBe(1);
    expect(gitCheckIgnore(root, 'openspec/.sdlc/board.json')).toBe(1);
    expect(gitCheckIgnore(root, 'packages/[app] #1/ordinary.txt')).toBe(1);
  });

  it('does not add an exclusion when physical project resolution fails', () => {
    const root = tempDir('sdlc-ignore-resolution-');
    initGitRepo(root);
    write(path.join(root, 'openspec/.sdlc/board.json'), '{}');
    const exclude = path.join(root, '.git/info/exclude');
    const before = fs.readFileSync(exclude, 'utf8');
    const native = fs.realpathSync.native;
    const denied = Object.assign(new Error('fixture denied realpath'), { code: 'EACCES' });
    let nativeCalled = false;
    const spy = vi.spyOn(fs.realpathSync, 'native').mockImplementation(((file: fs.PathLike, options?: unknown) => {
      if (path.resolve(String(file)) === path.resolve(root)) {
        nativeCalled = true;
        throw denied;
      }
      return Reflect.apply(native, fs.realpathSync, [file, options]);
    }) as typeof fs.realpathSync.native);
    let caught: unknown;
    try {
      ensureLocalIgnore(root, ['board.json']);
    } catch (error) {
      caught = error;
    } finally {
      spy.mockRestore();
    }

    expect(nativeCalled, 'physical resolution must actually be attempted').toBe(true);
    if (caught) expect(caught).toBe(denied);
    expect(fs.readFileSync(exclude, 'utf8')).toBe(before);
    expect(gitCheckIgnore(root, 'openspec/.sdlc/board.json')).toBe(1);
  });

  it('does not invent a Git exclusion outside a Git repository', () => {
    const root = tempDir('sdlc-ignore-no-git-');
    const board = path.join(root, 'openspec/.sdlc/board.json');
    write(board, '{}');
    ensureLocalIgnore(root, ['board.json']);
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
    expect(fs.readFileSync(board, 'utf8')).toBe('{}');
  });

  it('uses the physical target for a junction within the same Git tree', ({ skip }) => {
    const root = tempDir('sdlc-ignore-inside-link-');
    initGitRepo(root);
    const project = path.join(root, 'packages/target');
    const link = path.join(root, 'project-link');
    write(path.join(project, 'openspec/.sdlc/board.json'), '{}');
    try {
      fs.symlinkSync(project, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        skip('Filesystem cannot create the link; a separate real-link control is required');
      }
      throw error;
    }

    ensureLocalIgnore(link, ['board.json']);

    expect(gitCheckIgnore(root, 'packages/target/openspec/.sdlc/board.json')).toBe(0);
  });

  it('does not change either Git exclude when a junction leaves the original repository', ({ skip }) => {
    const parent = tempDir('sdlc-ignore-outside-link-');
    const root = path.join(parent, 'source');
    const other = path.join(parent, 'other');
    fs.mkdirSync(root);
    fs.mkdirSync(other);
    initGitRepo(root);
    initGitRepo(other);
    write(path.join(other, 'openspec/.sdlc/board.json'), '{}');
    const link = path.join(root, 'other-project');
    try {
      fs.symlinkSync(other, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        skip('Filesystem cannot create the link; a separate real-link control is required');
      }
      throw error;
    }
    const rootExclude = path.join(root, '.git/info/exclude');
    const otherExclude = path.join(other, '.git/info/exclude');
    const rootBefore = fs.readFileSync(rootExclude, 'utf8');
    const otherBefore = fs.readFileSync(otherExclude, 'utf8');
    try {
      ensureLocalIgnore(link, ['board.json']);
    } catch (error) {
      expect(error).toMatchObject({ code: 'local_ignore' });
    }

    expect.soft(fs.readFileSync(rootExclude, 'utf8'), 'original repository exclusions remain').toBe(rootBefore);
    expect.soft(fs.readFileSync(otherExclude, 'utf8'), 'other repository exclusions remain').toBe(otherBefore);
    expect.soft(gitCheckIgnore(other, 'openspec/.sdlc/board.json')).toBe(1);
  });

  it('keeps a Git worktree with a .git file scoped to its own project', () => {
    const root = tempDir('sdlc-ignore-worktree-');
    initGitRepo(root);
    write(path.join(root, 'tracked.txt'), 'initial\n');
    let result = spawnSync('git', ['add', 'tracked.txt'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    result = spawnSync('git', ['commit', '-qm', 'initial'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    const worktree = path.join(tempDir('sdlc-ignore-worktree-parent-'), 'worktree');
    result = spawnSync('git', ['worktree', 'add', '--detach', worktree],
      { cwd: root, encoding: 'utf8', timeout: 10000 });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.lstatSync(path.join(worktree, '.git')).isFile()).toBe(true);
    write(path.join(worktree, 'openspec/.sdlc/board.json'), '{}');
    write(path.join(worktree, 'ordinary.txt'), 'ordinary\n');

    ensureLocalIgnore(worktree, ['board.json']);

    expect(gitCheckIgnore(worktree, 'openspec/.sdlc/board.json')).toBe(0);
    expect(gitCheckIgnore(worktree, 'ordinary.txt')).toBe(1);
  });
});
