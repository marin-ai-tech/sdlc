#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import semver from 'semver';

export function defaultRun(cmd, args, options = {}) {
  const { cwd } = options;
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function publishRelease({ tag, archives, run = defaultRun, log = console.log }) {
  const view = () => run('gh', ['release', 'view', tag]);
  if (view().status === 0) {
    guardReleaseAssets(tag, archives, run);
    log(`GitHub release ${tag} and its archives are kept`);
    return { created: false };
  }
  const title = `sdlc ${tag.replace(/^v/, '')}`;
  const created = run('gh', ['release', 'create', tag, ...archives, '--title', title, '--generate-notes']);
  if (created.status === 0) {
    log(`GitHub release ${tag} created`);
    return { created: true };
  }
  if (view().status === 0) {
    guardReleaseAssets(tag, archives, run);
    log(`GitHub release ${tag} and its archives are kept`);
    return { created: false };
  }
  throw new Error(`Could not create GitHub release ${tag}: ${created.stderr || 'creation failed'}`);
}

function guardReleaseAssets(tag, archives, run) {
  const result = run('gh', ['release', 'view', tag, '--json', 'assets']);
  if (result.status !== 0) {
    throw new Error(`Could not inspect GitHub release ${tag} assets: ${result.stderr || 'view failed'}`);
  }
  let assets;
  try {
    assets = JSON.parse(result.stdout).assets;
  } catch {
    throw new Error(`Could not read GitHub release ${tag} assets`);
  }
  if (!Array.isArray(assets)) {
    throw new Error(`Could not read GitHub release ${tag} assets`);
  }
  const names = new Set(assets.map((asset) => asset.name));
  for (const archive of archives) {
    const name = path.basename(archive);
    if (!names.has(name)) {
      throw new Error(`GitHub release ${tag} is missing archive ${name}`);
    }
  }
}

async function remoteBranchSha(run, cwd, pauses, sleep) {
  for (let index = 0; index <= pauses.length; index += 1) {
    const result = run('git', ['ls-remote', '--exit-code', 'origin', 'refs/heads/release'], { cwd });
    if (result.status === 0) {
      const sha = result.stdout.trim().split(/\s+/)[0];
      if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
        throw new Error('Could not read origin release branch SHA');
      }
      return sha;
    }
    if (result.status === 2) {
      return '';
    }
    if (index < pauses.length) {
      await sleep(pauses[index]);
    }
  }
  throw new Error('Could not check origin release branch');
}

async function guardRemoteVersion(tag, cwd, run, pauses, sleep) {
  const tagVersion = tag.replace(/^v/, '');
  if (!semver.valid(tagVersion)) {
    throw new Error(`Invalid package version ${tagVersion}`);
  }
  const sha = await remoteBranchSha(run, cwd, pauses, sleep);
  if (!sha) {
    return sha;
  }
  const fetched = run('git', ['fetch', 'origin', 'refs/heads/release'], { cwd });
  if (fetched.status !== 0) {
    throw new Error(`Could not fetch origin release branch: ${fetched.stderr || 'fetch failed'}`);
  }
  const shown = run('git', ['show', 'FETCH_HEAD:package.json'], { cwd });
  if (shown.status !== 0) {
    throw new Error(`Could not read origin release version: ${shown.stderr || 'git show failed'}`);
  }
  const remoteVersion = JSON.parse(shown.stdout).version;
  if (!semver.valid(remoteVersion)) {
    throw new Error(`Invalid package version ${remoteVersion}`);
  }
  if (semver.gt(remoteVersion, tagVersion)) {
    throw new Error(`Origin release version ${remoteVersion} is newer than ${tagVersion}; branch was not moved`);
  }
  return sha;
}

export async function pushReleaseBranch({ tag, cwd, run = defaultRun, pauses = [15000, 30000, 60000],
  sleep = defaultSleep, log = console.log }) {
  let expectedSha = await guardRemoteVersion(tag, cwd, run, pauses, sleep);
  const total = pauses.length + 1;
  for (let index = 0; index < total; index += 1) {
    log(`release branch push: attempt ${index + 1} of ${total}`);
    const lease = `--force-with-lease=refs/heads/release:${expectedSha}`;
    const result = run('git', ['push', lease, 'origin', 'HEAD:refs/heads/release'], { cwd });
    if (result.status === 0) {
      return { attempts: index + 1 };
    }
    const currentSha = await remoteBranchSha(run, cwd, pauses, sleep);
    if (currentSha !== expectedSha) {
      expectedSha = await guardRemoteVersion(tag, cwd, run, pauses, sleep);
    }
    if (index < pauses.length) {
      await sleep(pauses[index]);
    }
  }
  throw new Error(`::error::Release branch push for ${tag} failed after ${total} attempts; `
    + 'the GitHub release is kept; re-run the failed job to repeat the branch step');
}

function parseArguments(argv) {
  const [mode, ...flags] = argv;
  const values = { tag: undefined, archives: [] };
  for (let index = 0; index < flags.length; index += 2) {
    const flag = flags[index];
    const value = flags[index + 1];
    if (!value || !['--tag', '--archive'].includes(flag)) {
      throw new Error('Usage: release --tag <tag> --archive <file> [--archive <file>] | branch --tag <tag>');
    }
    if (flag === '--tag') {
      values.tag = value;
    } else {
      values.archives.push(value);
    }
  }
  if (!values.tag || !['release', 'branch'].includes(mode) || (mode === 'release' && !values.archives.length)
    || (mode === 'branch' && values.archives.length)) {
    throw new Error('Usage: release --tag <tag> --archive <file> [--archive <file>] | branch --tag <tag>');
  }
  return { mode, ...values };
}

async function main(argv) {
  const { mode, tag, archives } = parseArguments(argv);
  if (mode === 'release') {
    await publishRelease({ tag, archives });
  } else {
    await pushReleaseBranch({ tag, cwd: process.cwd() });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
