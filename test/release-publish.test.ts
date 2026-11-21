import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { REPO_ROOT, git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * B269 (E25, change release-branch-survives): in 0.30.1 the push of the `release` branch failed with HTTP 408 after
 * the GitHub release was published, and a re-run stopped at `gh release create` because the release existed, so the
 * documented install stayed on the previous version. scripts/release-publish.mjs now creates the release only when
 * it is missing (never replacing an archive), pushes the branch with four attempts, names the tag and the way to
 * repeat after the last one, and never moves the branch to a lower version or touches master or a tag.
 */

const PUBLISH = path.join(REPO_ROOT, 'scripts/release-publish.mjs');
const WORKFLOW = path.join(REPO_ROOT, '.github/workflows/release.yml');

interface Call { cmd: string; args: string[] }
interface Answer { status: number; stdout?: string; stderr?: string }
interface Publish {
  publishRelease(options: Record<string, unknown>): Promise<{ created: boolean }>;
  pushReleaseBranch(options: Record<string, unknown>): Promise<{ attempts: number }>;
}

const load = async () => import(`file://${PUBLISH.replace(/\\/g, '/')}`) as Promise<Publish>;

function fakeRun(answer: (call: Call) => Answer) {
  const calls: Call[] = [];
  const run = (cmd: string, args: string[]) => {
    const call = { cmd, args };
    calls.push(call);
    const result = answer(call);
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  return { calls, run };
}

const quiet = () => undefined;

/** A local repository with a bare origin; the hook rejects the first `rejections` pushes to it. */
function repository(rejections: number, releaseVersion?: string) {
  const origin = tempDir('sdlc-release-origin-');
  spawnSync('git', ['init', '-q', '--bare', origin], { encoding: 'utf-8', timeout: 60000 });
  const work = tempDir('sdlc-release-work-');
  initGitRepo(work);
  git(work, ['remote', 'add', 'origin', origin]);
  if (releaseVersion) {
    write(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: releaseVersion }));
    git(work, ['add', '-A']);
    git(work, ['commit', '-q', '-m', `release v${releaseVersion}`]);
    git(work, ['push', '-q', 'origin', 'HEAD:refs/heads/release']);
  }
  const counter = path.join(origin, 'pushes.txt').replace(/\\/g, '/');
  const hook = [
    '#!/bin/sh',
    `n=$(cat "${counter}" 2>/dev/null || echo 0)`,
    'n=$((n+1))',
    `echo "$n" > "${counter}"`,
    `if [ "$n" -le ${rejections} ]; then echo "busy $n" >&2; exit 1; fi`,
    'exit 0',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(origin, 'hooks', 'pre-receive'), hook, { mode: 0o755 });
  git(work, ['checkout', '-q', '-B', 'release']);
  // The built branch always differs from origin's, so an equal version still makes a new commit to push.
  write(path.join(work, 'package.json'), JSON.stringify({ name: 'x', version: '1.2.3', build: 'tag' }));
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'release v1.2.3']);
  const remote = () => spawnSync('git', ['rev-parse', 'refs/heads/release'], { cwd: origin, encoding: 'utf-8' })
    .stdout.trim();
  const head = () => spawnSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf-8' }).stdout.trim();
  return { work, remote, head };
}

describe('B269: the GitHub release is created only when it is missing', () => {
  it('P1 a missing release is created with both archives and generated notes', async () => {
    const fake = fakeRun((call) => ({ status: call.args[1] === 'view' ? 1 : 0 }));
    const result = await (await load()).publishRelease({ tag: 'v1.2.3', archives: ['sdlc-1.2.3.tgz', 'sdlc.tgz'],
      run: fake.run, log: quiet });
    expect(result.created).toBe(true);
    const create = fake.calls.find((call) => call.cmd === 'gh' && call.args[1] === 'create');
    expect(create?.args.slice(0, 5)).toEqual(['release', 'create', 'v1.2.3', 'sdlc-1.2.3.tgz', 'sdlc.tgz']);
    expect(create?.args).toContain('--generate-notes');
  });

  it('P2 an existing release is kept: no create, no upload, no clobber', async () => {
    // Review round 1 of B269: an existing release is kept only when both archives are on it, so the fake view
    // answers the asset query with both names.
    const assets = JSON.stringify({ assets: [{ name: 'sdlc-1.2.3.tgz' }, { name: 'sdlc.tgz' }] });
    const fake = fakeRun((call) => ({ status: 0, stdout: call.args.includes('assets') ? assets : '' }));
    const result = await (await load()).publishRelease({ tag: 'v1.2.3', archives: ['sdlc-1.2.3.tgz', 'sdlc.tgz'],
      run: fake.run, log: quiet });
    expect(result.created).toBe(false);
    const words = fake.calls.flatMap((call) => call.args);
    expect(words).not.toContain('create');
    expect(words).not.toContain('upload');
    expect(words.join(' ')).not.toMatch(/clobber/);
  });
});

describe('B269: the release branch push survives transient failures', () => {
  it('P3 two rejected pushes are retried and the third reaches origin', async () => {
    const repo = repository(2);
    const result = await (await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: repo.work, pauses: [0, 0, 0],
      log: quiet });
    expect(result.attempts).toBe(3);
    expect(repo.remote()).toBe(repo.head());
  }, 120000);

  it('P4 four rejected pushes fail naming the tag and how to repeat', async () => {
    const repo = repository(10);
    const lines: string[] = [];
    const push = (await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: repo.work, pauses: [0, 0, 0],
      log: (text: string) => lines.push(text) });
    await expect(push).rejects.toThrow(/v1\.2\.3/);
    await expect(push).rejects.toThrow(/re-run/i);
    expect(lines.filter((text) => /attempt/i.test(text))).toHaveLength(4);
  }, 120000);

  it('P5 the branch never moves to a lower version; an equal one is pushed again', async () => {
    const newer = repository(0, '1.3.0');
    const before = newer.remote();
    const push = (await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: newer.work, pauses: [0, 0, 0], log: quiet });
    await expect(push).rejects.toThrow(/1\.3\.0/);
    expect(newer.remote()).toBe(before);
    const same = repository(0, '1.2.3');
    await (await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: same.work, pauses: [0, 0, 0], log: quiet });
    expect(same.remote()).toBe(same.head());
  }, 120000);

  it('P6 negative: the only pushed ref is the release branch, forced, never master or a tag', async () => {
    const fake = fakeRun((call) => ({ status: call.args[0] === 'ls-remote' ? 2 : 0 }));
    await (await load()).pushReleaseBranch({ tag: 'v1.2.3', run: fake.run, pauses: [0, 0, 0], log: quiet });
    const pushes = fake.calls.filter((call) => call.cmd === 'git' && call.args[0] === 'push');
    expect(pushes).toHaveLength(1);
    const text = pushes[0].args.join(' ');
    expect(text).toMatch(/--force/);
    expect(text).toMatch(/origin (HEAD:)?(refs\/heads\/)?release$/);
    expect(text).not.toMatch(/master|main|--tags|refs\/tags|--all|--mirror/);
  });

  it('P7 the default pauses are 15, 30 and 60 seconds', () => {
    const text = fs.readFileSync(PUBLISH, 'utf-8');
    expect(text).toMatch(/\[\s*15000\s*,\s*30000\s*,\s*60000\s*\]/);
  });
});

describe('B269: the workflow uses the script', () => {
  const steps = () => Object.values(parse(fs.readFileSync(WORKFLOW, 'utf-8')).jobs)
    .flatMap((job) => (job as { steps: Array<{ run?: string }> }).steps).map((step) => step.run ?? '').join('\n');

  it('W1 the release and the branch go through release-publish.mjs, with no inline push or clobber', () => {
    expect(steps()).toMatch(/node scripts\/release-publish\.mjs release --tag "\$\{GITHUB_REF_NAME\}"/);
    expect(steps()).toMatch(/node scripts\/release-publish\.mjs branch --tag "\$\{GITHUB_REF_NAME\}"/);
    expect(steps()).not.toMatch(/git push/);
    expect(steps()).not.toMatch(/gh release create|clobber/);
  });
});

describe('release publication review: existing assets', () => {
  const archives = ['sdlc-1.2.3.tgz', 'sdlc.tgz'];
  const assets = (names: string[]) => JSON.stringify({ assets: names.map((name) => ({ name })) });

  it('accepts an existing release only when both archives are present', async () => {
    const fake = fakeRun((call) => ({ status: 0, stdout: call.args.includes('--json') ? assets(archives) : '' }));
    const result = await (await load()).publishRelease({ tag: 'v1.2.3', archives, run: fake.run, log: quiet });
    expect(result.created).toBe(false);
    expect(fake.calls.map((call) => call.args[1])).toEqual(['view', 'view']);
    expect(fake.calls[1].args).toEqual(['release', 'view', 'v1.2.3', '--json', 'assets']);
  });

  it('fails after a partial create without changing the release', async () => {
    let views = 0;
    const fake = fakeRun((call) => {
      if (call.args[1] === 'create') {
        return { status: 1, stderr: 'archive upload failed' };
      }
      if (call.args.includes('--json')) {
        return { status: 0, stdout: assets(['sdlc-1.2.3.tgz']) };
      }
      views += 1;
      return { status: views === 1 ? 1 : 0 };
    });
    await expect((await load()).publishRelease({ tag: 'v1.2.3', archives, run: fake.run, log: quiet }))
      .rejects.toThrow(/sdlc\.tgz/);
    expect(fake.calls.filter((call) => call.args[1] === 'create')).toHaveLength(1);
    expect(fake.calls.map((call) => call.args[1])).toEqual(['view', 'create', 'view', 'view']);
  });

  it('fails when an existing release lacks an archive', async () => {
    const fake = fakeRun((call) => ({ status: 0, stdout: call.args.includes('--json')
      ? assets(['sdlc-1.2.3.tgz']) : '' }));
    await expect((await load()).publishRelease({ tag: 'v1.2.3', archives, run: fake.run, log: quiet }))
      .rejects.toThrow(/sdlc\.tgz/);
    expect(fake.calls.every((call) => call.args[1] === 'view')).toBe(true);
  });
});

describe('release publication review: guarded branch push', () => {
  it('uses the checked SHA as the lease and only pushes the release branch', async () => {
    const sha = 'a'.repeat(40);
    const fake = fakeRun((call) => {
      if (call.args[0] === 'ls-remote') {
        return { status: 0, stdout: `${sha}\trefs/heads/release\n` };
      }
      if (call.args[0] === 'show') {
        return { status: 0, stdout: JSON.stringify({ version: '1.2.3' }) };
      }
      return { status: 0 };
    });
    await (await load()).pushReleaseBranch({ tag: 'v1.2.3', run: fake.run, pauses: [0, 0, 0], log: quiet });
    const push = fake.calls.find((call) => call.args[0] === 'push');
    expect(push?.args).toEqual(['push', `--force-with-lease=refs/heads/release:${sha}`,
      'origin', 'HEAD:refs/heads/release']);
  });

  it('uses an empty expected lease when the remote branch is missing', async () => {
    const fake = fakeRun((call) => ({ status: call.args[0] === 'ls-remote' ? 2 : 0 }));
    await (await load()).pushReleaseBranch({ tag: 'v1.2.3', run: fake.run, pauses: [0, 0, 0], log: quiet });
    const push = fake.calls.find((call) => call.args[0] === 'push');
    expect(push?.args[1]).toBe('--force-with-lease=refs/heads/release:');
  });

  it('does not overwrite a newer branch pushed between the check and the push', async () => {
    const repo = repository(0, '1.2.3');
    const origin = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: repo.work,
      encoding: 'utf-8' }).stdout.trim();
    let moved = false;
    let newerSha = '';
    const run = (cmd: string, args: string[], options: { cwd?: string } = {}) => {
      if (cmd === 'git' && args[0] === 'push' && !moved) {
        const other = tempDir('sdlc-release-concurrent-');
        initGitRepo(other);
        git(other, ['remote', 'add', 'origin', origin]);
        write(path.join(other, 'package.json'), JSON.stringify({ name: 'x', version: '1.3.0' }));
        git(other, ['add', '-A']);
        git(other, ['commit', '-q', '-m', 'release v1.3.0']);
        git(other, ['push', '-q', '--force', 'origin', 'HEAD:refs/heads/release']);
        newerSha = repo.remote();
        moved = true;
      }
      const result = spawnSync(cmd, args, { cwd: options.cwd, encoding: 'utf-8' });
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    await expect((await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: repo.work, run,
      pauses: [0, 0, 0], log: quiet })).rejects.toThrow(/1\.3\.0/);
    expect(repo.remote()).toBe(newerSha);
  }, 120000);

  it('compares prereleases with semver and refuses an invalid remote version', async () => {
    const stable = repository(0, '1.2.3');
    await expect((await load()).pushReleaseBranch({ tag: 'v1.2.3-rc.1', cwd: stable.work,
      pauses: [0, 0, 0], log: quiet })).rejects.toThrow(/1\.2\.3/);
    const prerelease = repository(0, '1.2.3-rc.1');
    await (await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: prerelease.work,
      pauses: [0, 0, 0], log: quiet });
    expect(prerelease.remote()).toBe(prerelease.head());
    const invalid = repository(0, 'abc');
    await expect((await load()).pushReleaseBranch({ tag: 'v1.2.3', cwd: invalid.work,
      pauses: [0, 0, 0], log: quiet })).rejects.toThrow(/abc/);
  }, 120000);
});
