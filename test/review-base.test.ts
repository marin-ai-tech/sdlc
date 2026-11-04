import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git as gitRead } from '../src/core/git.js';
import { spawnSync } from 'node:child_process';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B242: review context on a change built on the base branch itself (E2E run of 2026-11-02, finding S23): the base was
 * main..HEAD, which is empty, so the context showed no changed files, and the plan-drift untouched list held samples
 * from plan.md. The base is now the parent of the change's first commit; the list holds paths from Files that change.
 */

const PLAN = [
  '# Plan', '', '## Files that change', '', '- `src/planned.ts` (modified): the feature.',
  '- `src/never-touched.ts` (modified): planned but not done.', '', '## Proof', '',
  'Samples: `1/2` and `a/b`, a path in `docs/sample/guide.md`, and https://example.com/x/y.', '',
].join('\n');

function repo() {
  const root = tempDir('sdlc-review-base-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  const commit = (message: string) => {
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', message]);
    return gitRead(root, ['rev-parse', 'HEAD']).stdout;
  };
  const cli = (args: string[]) => {
    const result = runCli(args, root, env);
    expect(result.code, `${args.join(' ')}\n${result.stdout}${result.stderr}`).toBe(0);
    return result;
  };
  write(path.join(root, 'README.md'), 'start\n');
  const start = commit('start');
  cli(['init', '--tools', 'claude', '--json']);
  commit('sdlc');
  return { root, cli, commit, start, branch: gitRead(root, ['branch', '--show-current']).stdout };
}

function buildChange(p: ReturnType<typeof repo>): string {
  p.cli(['new', 'demo', '--json']);
  write(path.join(p.root, 'openspec/changes/demo/plan.md'), PLAN);
  const first = p.commit('change: demo');
  for (const name of ['planned', 'second', 'third', 'fourth']) {
    write(path.join(p.root, `src/${name}.ts`), `export const ${name} = 1;\n`);
    p.commit(`work: ${name}`);
  }
  return first;
}

const context = (p: ReturnType<typeof repo>, ...extra: string[]) =>
  p.cli(['review', 'context', '--change', 'demo', '--json', ...extra]).json();

describe('review context on the base branch', () => {
  it('B242.C1: the base is the parent of the first commit and the changed files are the change\'s', () => {
    const p = repo();
    const first = buildChange(p);
    const out = context(p);
    expect(out.base).toBe(gitRead(p.root, ['rev-parse', `${first}^`]).stdout);
    expect([...out.changedFiles].sort()).toEqual(['src/fourth.ts', 'src/planned.ts', 'src/second.ts', 'src/third.ts']);
  }, 240000);

  it('B242.C1: a change whose first commit is the root commit is compared with the empty tree', () => {
    const root = tempDir('sdlc-review-root-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    expect(runCli(['new', 'demo', '--json'], root, env).code).toBe(0);
    write(path.join(root, 'src/first.ts'), 'export const a = 1;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'everything at once']);
    const result = runCli(['review', 'context', '--change', 'demo', '--json'], root, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json().changedFiles).toContain('src/first.ts');
  }, 240000);

  it('negative: a change folder no commit touches keeps today\'s base', () => {
    const p = repo();
    p.cli(['new', 'demo', '--json']);
    // Nothing committed: the folder is local, as in a project that keeps openspec/ out of git.
    expect(context(p).base).toBe(p.branch);
  }, 240000);
});

describe('today\'s base is kept', () => {
  it('B242.C2: a change on its own branch', () => {
    const p = repo();
    git(p.root, ['checkout', '-q', '-b', 'feature']);
    buildChange(p);
    const out = context(p);
    expect(out.base).toBe(p.branch);
    expect([...out.changedFiles].sort()).toEqual(['src/fourth.ts', 'src/planned.ts', 'src/second.ts', 'src/third.ts']);
  }, 240000);

  it('B242.C3: an explicit --base', () => {
    const p = repo();
    buildChange(p);
    const out = context(p, '--base', p.start);
    expect(out.base).toBe(p.start);
  }, 240000);

  it('B242.C3: a configured review.base', () => {
    const p = repo();
    buildChange(p);
    const sdlc = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(sdlc));
    config.review = { ...config.review, base: p.start };
    write(sdlc, stringify(config));
    expect(context(p).base).toBe(p.start);
  }, 240000);
});

describe('plan drift', () => {
  it('B242.C4: untouched holds planned paths only, never samples from other sections', () => {
    const p = repo();
    buildChange(p);
    const { untouched } = context(p).planDrift;
    expect(untouched).toEqual(['src/never-touched.ts']);
    for (const sample of ['1/2', 'a/b', 'docs/sample/guide.md', 'x/y']) expect(untouched).not.toContain(sample);
  }, 240000);
});

describe('review round 1: the first commit of this change', () => {
  const parentOf = (p: ReturnType<typeof repo>, sha: string) => gitRead(p.root, ['rev-parse', `${sha}^`]).stdout;

  it('a later commit to the change folder does not move the base', () => {
    const p = repo();
    const first = buildChange(p);
    write(path.join(p.root, 'openspec/changes/demo/notes.md'), 'later\n');
    p.commit('notes');
    expect(context(p).base).toBe(parentOf(p, first));
  }, 240000);

  it('a renamed change folder keeps its earlier commits', () => {
    const p = repo();
    const first = buildChange(p);
    git(p.root, ['mv', 'openspec/changes/demo', 'openspec/changes/moved']);
    p.commit('rename the change');
    const out = p.cli(['review', 'context', '--change', 'moved', '--json']).json();
    expect(out.base).toBe(parentOf(p, first));
    expect(out.changedFiles).toContain('src/planned.ts');
  }, 240000);

  // Owner's decision after review round 2: a base that can only widen. The older change's files may appear.
  it('a reused id keeps every commit of the current change', () => {
    const p = repo();
    p.cli(['new', 'demo', '--json']);
    write(path.join(p.root, 'src/old.ts'), 'export const old = 1;\n');
    p.commit('the first demo');
    git(p.root, ['mv', 'openspec/changes/demo', 'openspec/changes/archive-2026-01-01-demo']);
    p.commit('archive it');
    write(path.join(p.root, 'src/between.ts'), 'export const between = 1;\n');
    p.commit('between');
    const first = buildChange(p);
    const out = context(p);
    expect(spawnSync('git', ['merge-base', '--is-ancestor', out.base, parentOf(p, first)], { cwd: p.root }).status).toBe(0);
    for (const file of ['src/planned.ts', 'src/second.ts', 'src/third.ts', 'src/fourth.ts']) {
      expect(out.changedFiles, file).toContain(file);
    }
  }, 240000);

  it('removing and adding back the change file does not hide the commits before it', () => {
    const p = repo();
    const first = buildChange(p);
    git(p.root, ['rm', '-q', '--', 'openspec/changes/demo/.openspec.yaml']);
    p.commit('remove it');
    git(p.root, ['checkout', '-q', 'HEAD~1', '--', 'openspec/changes/demo/.openspec.yaml']);
    p.commit('add it back');
    const out = context(p);
    expect(out.base).toBe(parentOf(p, first));
    expect(out.changedFiles).toContain('src/planned.ts');
  }, 240000);

  it('a project in a subfolder of the repository finds the first commit too', () => {
    const top = tempDir('sdlc-review-nested-');
    initGitRepo(top);
    write(path.join(top, 'README.md'), 'top\n');
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'top']);
    const root = path.join(top, 'pkg');
    fs.mkdirSync(root);
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'sdlc']);
    expect(runCli(['new', 'demo', '--json'], root, env).code).toBe(0);
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'change']);
    const first = gitRead(top, ['rev-parse', 'HEAD']).stdout;
    write(path.join(root, 'src/work.ts'), 'export const w = 1;\n');
    git(top, ['add', '-A']);
    git(top, ['commit', '-qm', 'work']);
    git(root, ['mv', 'openspec/changes/demo', 'openspec/changes/moved']);
    git(top, ['commit', '-qm', 'rename']);
    const result = runCli(['review', 'context', '--change', 'moved', '--json'], root, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json<{ base: string }>().base).toBe(gitRead(top, ['rev-parse', `${first}^`]).stdout);
  }, 240000);

  it('a detached HEAD on the base keeps the change start', () => {
    const p = repo();
    const first = buildChange(p);
    git(p.root, ['checkout', '-q', '--detach']);
    expect(context(p).base).toBe(parentOf(p, first));
  }, 240000);

  it('a partly pushed change on the default branch keeps its first commits', () => {
    const remote = tempDir('sdlc-review-remote-');
    spawnSync('git', ['init', '-q', '--bare', remote], { timeout: 60000 });
    const p = repo();
    git(p.root, ['remote', 'add', 'origin', remote]);
    git(p.root, ['push', '-q', 'origin', `HEAD:${p.branch}`]);
    git(p.root, ['fetch', '-q', 'origin']);
    git(p.root, ['remote', 'set-head', 'origin', p.branch]);
    const first = buildChange(p);
    git(p.root, ['push', '-q', 'origin', `HEAD~2:${p.branch}`]);
    git(p.root, ['fetch', '-q', 'origin']);
    const out = context(p);
    expect(out.base).toBe(parentOf(p, first));
    expect([...out.changedFiles].sort()).toEqual(['src/fourth.ts', 'src/planned.ts', 'src/second.ts', 'src/third.ts']);
  }, 240000);

  it('a shallow clone does not call the whole repository the change', () => {
    const p = repo();
    buildChange(p);
    const shallow = tempDir('sdlc-review-shallow-');
    const url = `file:///${p.root.replace(/\\/g, '/').replace(/^\//, '')}`;
    const clone = spawnSync('git', ['clone', '-q', '--depth', '1', url, shallow], { encoding: 'utf-8', timeout: 120000 });
    expect(clone.status, clone.stderr).toBe(0);
    const env = humanEnv(tempDir('sdlc-home-'));
    const result = runCli(['review', 'context', '--change', 'demo', '--json'], shallow, env);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(result.json<{ changedFiles: string[] }>().changedFiles).not.toContain('README.md');
  }, 240000);

  it('the reported diff command runs, also for a root commit', () => {
    const root = tempDir('sdlc-review-root-diff-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    expect(runCli(['new', 'demo', '--json'], root, env).code).toBe(0);
    write(path.join(root, 'src/first.ts'), 'export const a = 1;\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'everything at once']);
    const out = runCli(['review', 'context', '--change', 'demo', '--json'], root, env).json<{ diffCommand: string }>();
    const first = out.diffCommand.split(' && ')[0].split(' ');
    const ran = spawnSync(first[0], first.slice(1), { cwd: root, encoding: 'utf-8', timeout: 60000 });
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toContain('src/first.ts');
  }, 240000);

  it('review suggest takes the same base', () => {
    const p = repo();
    const first = buildChange(p);
    write(path.join(p.root, 'openspec/roles.yaml'), [
      'version: 1', 'signing: off', 'people:',
      '  pat: { name: Pat Owner, emails: [pat@example.com] }',
      '  sam: { name: Sam Other, emails: [sam@example.com] }',
      'roles:', '  code-owner: [pat, sam]', '',
    ].join('\n'));
    const out = p.cli(['review', 'suggest', '--change', 'demo', '--json']).json<{ base: string; suggested: string }>();
    expect(out.base).toBe(parentOf(p, first));
    // Pat wrote the commits, so the base that finds them keeps Pat from being suggested.
    expect(out.suggested).toBe('sam');
  }, 240000);
});
