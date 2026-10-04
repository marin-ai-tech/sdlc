import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REPO_ROOT, tempDir } from './helpers.js';

const SCRIPT = path.join(REPO_ROOT, 'scripts/release-branch.mjs');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/release.yml');
const pkg = () => JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'));
const load = async () => import(`file://${SCRIPT.replace(/\\/g, '/')}`) as Promise<{
  releasePackageJson(p: Record<string, unknown>): Record<string, unknown>;
  releaseGitignore(text: string): string;
}>;

/** A git repository with the tracked files of this checkout plus the built dist/, like CI after `npm ci`. */
function snapshot(): string {
  const dir = tempDir('sdlc-release-src-');
  const files = spawnSync('git', ['ls-files', '-z'], { cwd: REPO_ROOT, encoding: 'utf-8' }).stdout.split('\0').filter(Boolean);
  for (const file of [...files, 'scripts/release-branch.mjs']) {
    if (!fs.existsSync(path.join(REPO_ROOT, file))) continue;
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(dir, file));
  }
  fs.cpSync(path.join(REPO_ROOT, 'dist'), path.join(dir, 'dist'), { recursive: true });
  return dir;
}

const npm = (args: string[], cwd?: string) =>
  spawnSync('npm', args, { cwd, encoding: 'utf-8', shell: process.platform === 'win32', timeout: 900000 });

describe('the release branch (install from git: npm install -g github:marin-ai-tech/sdlc#release)', () => {
  it('its package.json has no prepare (npm 11 breaks preparing a git package globally) and keeps everything else', async () => {
    const { releasePackageJson } = await load();
    const out = releasePackageJson(pkg());
    expect((out.scripts as Record<string, string>).prepare).toBeUndefined();
    expect((out.scripts as Record<string, string>).compile).toBe(pkg().scripts.compile);
    expect(out.version).toBe(pkg().version);
    expect(out.bin).toEqual(pkg().bin);
    expect(pkg().scripts.prepare).toBeDefined(); // master keeps building from source
  });

  it('its .gitignore lets dist/ in, and nothing else changes', async () => {
    const { releaseGitignore } = await load();
    const text = 'node_modules/\ndist/\ncoverage/\n*.log\n';
    expect(releaseGitignore(text)).toBe('node_modules/\ncoverage/\n*.log\n');
  });

  it('negative: running the script without --in-place changes nothing', () => {
    const dir = snapshot();
    const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf-8');
    const r = spawnSync(process.execPath, [path.join(dir, 'scripts/release-branch.mjs')], { cwd: dir, encoding: 'utf-8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--in-place/);
    expect(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).toBe(before);
  });

  it.skipIf(process.env.SDLC_INSTALL_TEST !== '1')('npm install -g from the release branch works (network, slow)', () => {
    const dir = snapshot();
    expect(spawnSync(process.execPath, ['scripts/release-branch.mjs', '--in-place'], { cwd: dir }).status).toBe(0);
    const git = (args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf-8' });
    git(['init', '-q']);
    git(['add', '-A']);
    git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'release']);
    expect(git(['ls-files', 'dist/cli/index.js']).stdout.trim()).toBe('dist/cli/index.js');
    const prefix = tempDir('sdlc-release-prefix-');
    const r = npm(['install', '-g', `git+file:///${dir.replace(/\\/g, '/').replace(/^\//, '')}`, '--prefix', prefix, '--no-audit', '--no-fund']);
    expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-3000)).toBe(0);
    const bin = path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'sdlc/bin/sdlc.js');
    expect(spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf-8' }).stdout.trim()).toBe(pkg().version);
  }, 960000);

  it.skipIf(process.env.SDLC_INSTALL_TEST !== '1')('npm install -g from the packed release archive works (network, slow)', () => {
    const dir = snapshot();
    const packed = npm(['pack', '--silent', '--ignore-scripts'], dir);
    const tgz = path.join(dir, packed.stdout.trim().split('\n').pop()!);
    expect(fs.existsSync(tgz)).toBe(true);
    const prefix = tempDir('sdlc-tgz-prefix-');
    const r = npm(['install', '-g', tgz, '--prefix', prefix, '--no-audit', '--no-fund']);
    expect(r.status, `${r.stdout}\n${r.stderr}`.slice(-3000)).toBe(0);
    const bin = path.join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'sdlc/bin/sdlc.js');
    expect(spawnSync(process.execPath, [bin, '--version'], { encoding: 'utf-8' }).stdout.trim()).toBe(pkg().version);
  }, 960000);
});

describe('the release workflow', () => {
  const wf = () => parse(fs.readFileSync(WORKFLOW, 'utf-8'));
  const script = () => Object.values(wf().jobs).flatMap((job) => (job as { steps: Array<{ run?: string }> }).steps)
    .map((s) => s.run ?? '').join('\n');

  it('a v* tag tests, packs and attaches the archive to the release as sdlc-<version>.tgz and sdlc.tgz', () => {
    expect(wf().on.push.tags).toEqual(['v*']);
    expect(wf().permissions.contents).toBe('write');
    for (const re of [/npm ci/, /npm test/, /npm pack/, /sdlc\.tgz/, /gh release create/]) expect(script()).toMatch(re);
  });

  it('it updates the release branch with the built code through the same script', () => {
    expect(script()).toMatch(/node scripts\/release-branch\.mjs --in-place/);
    expect(script()).toMatch(/git push (--force|-f) origin (HEAD:)?release/);
  });

  it('negative: a tag that does not match package.json stops the release before anything is published', () => {
    const text = fs.readFileSync(WORKFLOW, 'utf-8');
    expect(text).toMatch(/GITHUB_REF_NAME/);
    expect(text.indexOf('GITHUB_REF_NAME')).toBeLessThan(text.indexOf('gh release create'));
    expect(text).toMatch(/exit 1/);
  });
});

describe('install hints never point at the unrelated `sdlc` package on the npm registry', () => {
  it('no `npm install -g sdlc`, `npx sdlc` without --no-install, or the broken `github:marin-ai-tech/sdlc` without #release', () => {
    const r = spawnSync('git', ['grep', '-n', '-I', '-E', 'npm (install|i) (-g|-D) (sdlc\\b|github:marin-ai-tech/sdlc($|[^#]))|npx sdlc',
      '--', '.', ':!CHANGELOG.md', ':!docs/demo/*.json', ':!test'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    // Warnings that tell people not to run it are the point, not a leak.
    const hints = r.stdout.split('\n').filter((line) => line && !/(Never|Do not run) `npm install -g sdlc`/.test(line));
    expect(hints).toEqual([]);
  });
});
