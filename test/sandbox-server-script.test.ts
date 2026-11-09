import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT, git, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * B265 review: scripts/sandbox/test.sh and run.sh run for real here, with only docker, df and ps replaced. git, flock,
 * timeout and sleep are the real ones, and the gate on the machine's memory is opened unless a test is about it: inside
 * the container a stand would otherwise wait on what the suite itself uses. The server is shared with a production bot,
 * so what must not happen is named.
 * POSIX only: links, signals and flock are what is under test, and the server's container is where this runs.
 */

const SCRIPT = read(path.join(REPO_ROOT, 'scripts/sandbox/test.sh'));
const RUNNER = read(path.join(REPO_ROOT, 'scripts/sandbox/run.sh'));
const LIMIT_MS = 30_000;

const FAKE_DOCKER = [
  '#!/bin/sh',
  'echo "$*" >> "$FAKE_DIR/docker.log"',
  'case "$1" in',
  '  image) [ -f "$FAKE_DIR/image-exists" ] ;;',
  '  build) [ ! -f "$FAKE_DIR/build-fails" ] ;;',
  '  images) cat "$FAKE_DIR/images" 2>/dev/null; true ;;',
  '  ps)',
  '    pattern=""',
  '    for arg in "$@"; do case "$arg" in name=*) pattern="${arg#name=}" ;; esac; done',
  '    if [ -f "$FAKE_DIR/containers" ]; then grep -E "$pattern" "$FAKE_DIR/containers"; fi',
  '    true',
  '    ;;',
  '  run)',
  '    for arg in "$@"; do',
  '      case "$arg" in',
  '        *:/evidence) evidence="${arg%:/evidence}" ;;',
  '        *:/workspace) source="${arg%:/workspace}" ;;',
  '        *:/scratch) scratch="${arg%:/scratch}" ;;',
  '      esac',
  '    done',
  '    if [ -f "$FAKE_DIR/plant" ]; then ln -s "$(cat "$FAKE_DIR/plant")" "$evidence/run.log"; fi',
  '    if [ -f "$FAKE_DIR/read-only" ]; then mkdir "$source/ro"; touch "$source/ro/f"; chmod 555 "$source/ro"; fi',
  '    if [ -f "$FAKE_DIR/plant-scratch" ]; then ln -s "$(cat "$FAKE_DIR/plant-scratch")" "$scratch/link"; fi',
  '    if [ -f "$FAKE_DIR/evidence-file" ]; then touch "$evidence/big"; fi',
  '    echo container-id',
  '    ;;',
  '  wait)',
  '    i=0',
  '    while [ ! -f "$FAKE_DIR/finished" ] && [ "$i" -lt 300 ]; do sleep 0.1; i=$((i + 1)); done',
  '    cat "$FAKE_DIR/rc" 2>/dev/null || echo 0',
  '    ;;',
  '  logs) echo "container output line"; cat "$FAKE_DIR/log-extra" 2>/dev/null; true ;;',
  '  kill)',
  '    if [ -f "$FAKE_DIR/hang-kill" ]; then exec sleep 30; fi',
  '    touch "$FAKE_DIR/finished"',
  '    ;;',
  '  rm) touch "$FAKE_DIR/finished" ;;',
  'esac',
];

const FAKE_DF = [
  '#!/bin/sh',
  'echo "Filesystem 1M-blocks Used Available Use% Mounted"',
  'echo "fake 100000 1 $(cat "$FAKE_DIR/free") 1% /"',
];

const FAKE_PS = ['#!/bin/sh', 'cat "$FAKE_DIR/parent"'];

interface Stand {
  root: string;
  bare: string;
  sha: string;
  fake: string;
  home: string;
  tmp: string;
  env: NodeJS.ProcessEnv;
}

const stands: Stand[] = [];

function installFakes(bin: string): void {
  const tools: [string, string[]][] = [['docker', FAKE_DOCKER], ['df', FAKE_DF], ['ps', FAKE_PS]];
  for (const [name, lines] of tools) {
    write(path.join(bin, name), `${lines.join('\n')}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
}

function commitInputs(work: string): void {
  write(path.join(work, 'package.json'), '{"name":"x"}\n');
  write(path.join(work, 'package-lock.json'), '{"lockfileVersion":3}\n');
  write(path.join(work, 'scripts/sandbox/Dockerfile'), 'FROM scratch\n');
  git(work, ['add', '-A']);
  git(work, ['commit', '-q', '-m', 'inputs']);
}

function publish(stand: { root: string }, work: string): { bare: string; sha: string } {
  const bare = path.join(stand.root, 'bare.git');
  fs.rmSync(bare, { recursive: true, force: true });
  git(stand.root, ['clone', '-q', '--bare', work, bare]);
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: work, encoding: 'utf-8' });
  return { bare, sha: head.stdout.trim() };
}

function makeStand(prepare?: (work: string) => void): Stand {
  const root = tempDir('sdlc-server-script-');
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  initGitRepo(work);
  commitInputs(work);
  if (prepare) prepare(work);
  const { bare, sha } = publish({ root }, work);
  const fake = path.join(root, 'fake');
  const bin = path.join(root, 'bin');
  const home = path.join(root, 'home');
  const tmp = path.join(root, 'tmp');
  for (const dir of [fake, bin, home, tmp]) fs.mkdirSync(dir);
  installFakes(bin);
  write(path.join(fake, 'free'), '50000\n');
  write(path.join(fake, 'parent'), '100\n');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_DIR: fake, HOME: home, TMPDIR: tmp };
  const stand = { root, bare, sha, fake, home, tmp, env };
  stands.push(stand);
  return stand;
}

afterEach(() => {
  for (const stand of stands.splice(0)) write(path.join(stand.fake, 'finished'), '');
});

/** Shortens a wait; a constant the script no longer holds is left out, and the budget test names the missing one. */
function scriptWith(constants: Record<string, number>): string {
  let text = SCRIPT;
  for (const [name, value] of Object.entries(constants)) {
    text = text.replace(new RegExp(`^${name}=.*$`, 'm'), `${name}=${value}`);
  }
  return text;
}

function finish(stand: Stand, rc: number | string = 0): void {
  write(path.join(stand.fake, 'rc'), `${rc}\n`);
  write(path.join(stand.fake, 'finished'), '');
}

function runScript(stand: Stand, args: string[] = ['npm', 'test'], constants: Record<string, number> = {}) {
  const result = spawnSync('bash', ['-s', '--', stand.bare, stand.sha, ...args], {
    input: scriptWith({ POLL_SECONDS: 1, MEMORY_NEEDED_MB: 1, ...constants }),
    env: stand.env,
    encoding: 'utf-8',
    timeout: LIMIT_MS,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}`, calls: dockerCalls(stand) };
}

function dockerCalls(stand: Stand): string[] {
  const log = path.join(stand.fake, 'docker.log');
  return fs.existsSync(log) ? read(log).split('\n').filter(Boolean) : [];
}

function called(calls: string[], word: string): boolean {
  return calls.some((call) => call.split(' ')[0] === word);
}

function runFolders(stand: Stand): string[] {
  const runs = path.join(stand.home, 'sandbox_runs/sdlc');
  return fs.readdirSync(runs).filter((name) => name.startsWith('sdlc-sandbox-')).map((name) => path.join(runs, name));
}

async function until(condition: () => boolean, ms = 10_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return condition();
}

/** A run left waiting on its container, as the long part of every real run is. */
async function startWaiting(stand: Stand, constants: Record<string, number> = {}) {
  const output = fs.openSync(path.join(stand.root, 'out.log'), 'w');
  const child = spawn('bash', ['-s', '--', stand.bare, stand.sha, 'npm', 'test'], {
    env: stand.env,
    stdio: ['pipe', output, output],
  });
  fs.closeSync(output);
  child.stdin.end(scriptWith({ POLL_SECONDS: 1, MEMORY_NEEDED_MB: 1, ...constants }));
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const waiting = await until(() => dockerCalls(stand).some((call) => call.startsWith('wait ')));
  expect(waiting).toBe(true);
  return { child, exited };
}

async function withLimit(exited: Promise<number | null>, ms = 10_000): Promise<number | null | 'still running'> {
  const late = new Promise<'still running'>((resolve) => setTimeout(() => resolve('still running'), ms));
  return Promise.race([exited, late]);
}

function lockIsFree(stand: Stand): boolean {
  const lock = path.join(stand.home, 'sandbox_runs/sdlc/.lock');
  return spawnSync('flock', ['-n', lock, 'true'], { env: stand.env }).status === 0;
}

describe.skipIf(process.platform === 'win32')('B265 review: test.sh on the server', () => {
  it('a passing run returns 0, saves the log, keeps evidence and removes source and scratch', () => {
    const stand = makeStand();
    finish(stand);
    const r = runScript(stand);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('container output line');
    const [run] = runFolders(stand);
    expect(fs.existsSync(path.join(run, 'evidence'))).toBe(true);
    expect(read(path.join(run, 'run.log'))).toContain('container output line');
    expect(fs.existsSync(path.join(run, 'source'))).toBe(false);
    expect(fs.existsSync(path.join(run, 'scratch'))).toBe(false);
    expect(r.out, 'the login and its home path stay on the server').not.toContain(stand.home);
  });

  it('negative: the container cannot reach a host file through a link at evidence/run.log', () => {
    const stand = makeStand();
    const outside = path.join(stand.root, 'outside.txt');
    write(outside, 'SECRET\n');
    write(path.join(stand.fake, 'plant'), outside);
    finish(stand);
    const r = runScript(stand);
    expect(read(outside), 'the file behind the link is not written').toBe('SECRET\n');
    expect(r.out, 'the file behind the link is not read back').not.toContain('SECRET');
  });

  it('the docker run call itself carries every limit shared with the other projects', () => {
    const stand = makeStand();
    finish(stand);
    const { calls } = runScript(stand);
    const run = calls.find((call) => call.startsWith('run ')) ?? '';
    const limits = ['--network none', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges',
      '--memory 3g', '--cpus 2', '--cpu-shares 256', '--pids-limit 1024',
      '--log-opt max-size=20m', '--log-opt max-file=2'];
    for (const limit of limits) expect(run).toContain(limit);
    expect(run).not.toMatch(/--privileged|--network host|docker\.sock/);
  });

  it('a commit on no branch stops at exit 3 and no container starts', () => {
    const stand = makeStand();
    const made = spawnSync('git', ['--git-dir', stand.bare, 'commit-tree', `${stand.sha}^{tree}`, '-m', 'loose'],
      { encoding: 'utf-8', env: { ...stand.env, GIT_AUTHOR_NAME: 'x', GIT_AUTHOR_EMAIL: 'x@x', GIT_COMMITTER_NAME: 'x',
        GIT_COMMITTER_EMAIL: 'x@x' } });
    stand.sha = made.stdout.trim();
    const r = runScript(stand);
    expect(r.code).toBe(3);
    expect(r.out).toContain('NOT PUSHED');
    expect(called(r.calls, 'run')).toBe(false);
  });

  it('a wrong repository path is named as that, not as NOT PUSHED', () => {
    const stand = makeStand();
    stand.bare = path.join(stand.root, 'missing.git');
    const r = runScript(stand);
    expect(r.code).toBe(2);
    expect(r.out).toContain('NO REPOSITORY');
    expect(r.out).not.toContain('NOT PUSHED');
    expect(r.calls).toEqual([]);
  });

  it('a lock held by another run ends in 75 and no container starts', () => {
    const stand = makeStand();
    const runs = path.join(stand.home, 'sandbox_runs/sdlc');
    fs.mkdirSync(runs, { recursive: true });
    const holder = spawn('flock', [path.join(runs, '.lock'), 'sleep', '20'], { stdio: 'ignore' });
    try {
      spawnSync('sleep', ['0.3']);
      const r = runScript(stand, ['npm', 'test'], { LOCK_WAIT_SECONDS: 1 });
      expect(r.code).toBe(75);
      expect(r.out).toContain('SANDBOX BUSY');
      expect(called(r.calls, 'run')).toBe(false);
    } finally {
      holder.kill('SIGKILL');
    }
  });

  it('memory that stays short ends in 75 and no container starts', () => {
    const stand = makeStand();
    const r = runScript(stand, ['npm', 'test'], { MEMORY_NEEDED_MB: 99_999_999, MEMORY_WAIT_SECONDS: 0 });
    expect(r.code).toBe(75);
    expect(r.out).toContain('SANDBOX BUSY');
    expect(called(r.calls, 'run')).toBe(false);
  });

  it('too little free disk ends in 75 and no container starts', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'free'), '9000\n');
    const r = runScript(stand);
    expect(r.code).toBe(75);
    expect(r.out).toContain('SANDBOX BUSY');
    expect(called(r.calls, 'run')).toBe(false);
  });

  it('disk that runs out during a run stops the container, cleans up and ends in 75', async () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'evidence-file'), '');
    const { exited } = await startWaiting(stand);
    write(path.join(stand.fake, 'free'), '4000\n');
    expect(await withLimit(exited)).toBe(75);
    expect(called(dockerCalls(stand), 'rm')).toBe(true);
    const [run] = runFolders(stand);
    expect(fs.existsSync(path.join(run, 'source'))).toBe(false);
    expect(fs.existsSync(path.join(run, 'evidence')), 'what filled the disk stays and refuses every later run')
      .toBe(false);
  }, LIMIT_MS);

  it('a run that ends with less free disk than a run needs gives its evidence back, and keeps its result', async () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'evidence-file'), '');
    const { exited } = await startWaiting(stand);
    write(path.join(stand.fake, 'free'), '6000\n');
    finish(stand);
    expect(await withLimit(exited)).toBe(0);
    const [run] = runFolders(stand);
    expect(fs.existsSync(path.join(run, 'evidence'))).toBe(false);
    expect(read(path.join(stand.root, 'out.log'))).toContain('only 6000 MB of disk free');
  }, LIMIT_MS);

  it('negative: with enough free disk the evidence stays', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'evidence-file'), '');
    finish(stand);
    expect(runScript(stand).code).toBe(0);
    expect(fs.existsSync(path.join(runFolders(stand)[0], 'evidence/big'))).toBe(true);
  });

  it.each([5, 1, 127])('the container code %i passes through', (rc) => {
    const stand = makeStand();
    finish(stand, rc);
    expect(runScript(stand).code).toBe(rc);
  });

  it.each(['256', '512', 'abc', ''])('negative: a docker answer of %j is no exit code and is never a pass', (rc) => {
    const stand = makeStand();
    finish(stand, rc);
    expect(runScript(stand).code).toBe(1);
  });

  it('no result in the limit is 124 and stops the container, and is never a pass', () => {
    const stand = makeStand();
    const r = runScript(stand, ['npm', 'test'], { COMMAND_LIMIT_SECONDS: 1 });
    expect(r.code).toBe(124);
    expect(r.out).toContain('NO RESULT');
    expect(called(r.calls, 'kill')).toBe(true);
  });

  it('the limit of a command counts what the waits and the build already used', () => {
    const stand = makeStand();
    const started = Date.now();
    const r = runScript(stand, ['npm', 'test'], { TOTAL_LIMIT_SECONDS: 1, COMMAND_LIMIT_SECONDS: 25 });
    expect(r.code).toBe(124);
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('negative: a run with no command keeps its own limit', () => {
    const stand = makeStand();
    spawn('sh', ['-c', `sleep 3; touch "${path.join(stand.fake, 'finished')}"`], { stdio: 'ignore' });
    const r = runScript(stand, [], { TOTAL_LIMIT_SECONDS: 1 });
    expect(r.code, r.out).toBe(0);
  });

  it('a docker that hangs on kill cannot hold the run and the lock', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'hang-kill'), '');
    const started = Date.now();
    const r = runScript(stand, ['npm', 'test'], { COMMAND_LIMIT_SECONDS: 1, CONTROL_LIMIT_SECONDS: 1 });
    expect(r.code).toBe(124);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(lockIsFree(stand)).toBe(true);
  });

  it('a killed script leaves the lock free at once, and the next run removes what it left', async () => {
    const stand = makeStand();
    const { child, exited } = await startWaiting(stand);
    child.kill('SIGKILL');
    await exited;
    expect(await until(() => lockIsFree(stand), 3000), 'the lock outlived the script').toBe(true);
    const [left] = runFolders(stand);
    write(path.join(left, 'evidence/kept'), 'x\n');
    const leftName = path.basename(left);
    write(path.join(stand.fake, 'containers'), `${leftName}\nother-sdlc-sandbox-x\nmarin-sandbox-1\n`);
    const sibling = path.join(path.dirname(left), 'keep-me/source');
    fs.mkdirSync(sibling, { recursive: true });
    finish(stand);
    fs.rmSync(path.join(stand.fake, 'docker.log'));
    spawnSync('sleep', ['1.1']);
    const next = runScript(stand);
    expect(next.code, next.out).toBe(0);
    const removals = next.calls.filter((call) => call.startsWith('rm -f ') && call.includes(leftName));
    expect(removals).toHaveLength(1);
    expect(next.calls.join('\n')).not.toMatch(/rm .*(other-sdlc-sandbox-x|marin-sandbox-1)/);
    expect(fs.existsSync(path.join(left, 'source'))).toBe(false);
    expect(fs.existsSync(path.join(left, 'scratch'))).toBe(false);
    expect(fs.existsSync(path.join(left, 'evidence/kept'))).toBe(true);
    expect(fs.existsSync(sibling), 'a folder of another name is not this script\'s').toBe(true);
  }, LIMIT_MS);

  it('TERM stops a waiting run at once, with cleanup', async () => {
    const stand = makeStand();
    const { child, exited } = await startWaiting(stand);
    child.kill('SIGTERM');
    expect(await withLimit(exited, 5000)).toBe(143);
    expect(called(dockerCalls(stand), 'rm')).toBe(true);
    expect(fs.existsSync(path.join(runFolders(stand)[0], 'source'))).toBe(false);
  }, LIMIT_MS);

  it('a client that went away stops the run: nobody would read its result', async () => {
    const stand = makeStand();
    const { exited } = await startWaiting(stand);
    write(path.join(stand.fake, 'parent'), '1\n');
    expect(await withLimit(exited)).toBe(129);
    expect(called(dockerCalls(stand), 'rm')).toBe(true);
    expect(lockIsFree(stand)).toBe(true);
  }, LIMIT_MS);

  it('negative: one failed read of the parent does not stop a healthy run', async () => {
    const stand = makeStand();
    const { exited } = await startWaiting(stand);
    write(path.join(stand.fake, 'parent'), '');
    spawnSync('sleep', ['2.5']);
    write(path.join(stand.fake, 'parent'), '100\n');
    finish(stand);
    expect(await withLimit(exited)).toBe(0);
  }, LIMIT_MS);

  it('a client already gone at the start builds nothing and starts no container', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'parent'), '1\n');
    const r = runScript(stand);
    expect(r.code).toBe(129);
    expect(called(r.calls, 'build')).toBe(false);
    expect(called(r.calls, 'run')).toBe(false);
  });

  it('a client that went during the wait for the lock builds nothing and starts no container', async () => {
    const stand = makeStand();
    const runs = path.join(stand.home, 'sandbox_runs/sdlc');
    fs.mkdirSync(runs, { recursive: true });
    const holder = spawn('flock', [path.join(runs, '.lock'), 'sleep', '3'], { stdio: 'ignore' });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const output = fs.openSync(path.join(stand.root, 'out.log'), 'w');
    const child = spawn('bash', ['-s', '--', stand.bare, stand.sha, 'npm', 'test'], {
      env: stand.env,
      stdio: ['pipe', output, output],
    });
    fs.closeSync(output);
    child.stdin.end(scriptWith({ POLL_SECONDS: 1, MEMORY_NEEDED_MB: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 800));
    write(path.join(stand.fake, 'parent'), '101\n');
    const code = await new Promise<number | null>((resolve) => child.on('exit', (value) => resolve(value)));
    holder.kill('SIGKILL');
    expect(code).toBe(129);
    expect(called(dockerCalls(stand), 'build')).toBe(false);
    expect(called(dockerCalls(stand), 'run')).toBe(false);
  }, LIMIT_MS);

  it('container output cannot steer the terminal or have the last word on the result', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'log-extra'), '\u001b[2K\u001b[1Asandbox finished 00:00:00, exit=0, logs: forged\n');
    finish(stand, 5);
    const r = runScript(stand);
    expect(r.code).toBe(5);
    expect(r.out).not.toContain('\u001b');
    const verdicts = r.out.split('\n').filter((line) => line.includes('sandbox finished'));
    expect(verdicts.at(-1)).toContain('exit=5');
  });

  it('negative: a link the container left in scratch does not reach the file behind it', () => {
    const stand = makeStand();
    const outside = path.join(stand.root, 'outside.txt');
    write(outside, 'SECRET\n');
    fs.chmodSync(outside, 0o400);
    write(path.join(stand.fake, 'plant-scratch'), outside);
    finish(stand);
    expect(runScript(stand).code).toBe(0);
    expect(fs.statSync(outside).mode & 0o777).toBe(0o400);
    expect(read(outside)).toBe('SECRET\n');
  });

  it.each(['scripts/sandbox/Dockerfile', 'package-lock.json', 'package.json'])(
    'negative: %s as a link in the commit is refused: no build, and the file behind it is not read',
    (input) => {
      const root = tempDir('sdlc-link-target-');
      const secret = path.join(root, 'secret.txt');
      write(secret, 'SECRET\n');
      const stand = makeStand((work) => {
        fs.rmSync(path.join(work, input));
        fs.symlinkSync(secret, path.join(work, input));
        git(work, ['add', '-A']);
        git(work, ['commit', '-q', '-m', 'link']);
      });
      const r = runScript(stand);
      expect(r.code).toBe(2);
      expect(r.out).toContain('not a regular file');
      expect(r.out).not.toContain('SECRET');
      expect(called(r.calls, 'build')).toBe(false);
      expect(called(r.calls, 'run')).toBe(false);
    },
  );

  it('a failed build stops the run and leaves no temporary folder', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'build-fails'), '');
    const r = runScript(stand);
    expect(r.code).not.toBe(0);
    expect(called(r.calls, 'run')).toBe(false);
    expect(fs.readdirSync(stand.tmp)).toEqual([]);
  });

  it('the image is tagged by the full hash of its inputs, and only older tags are removed', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'images'), 'sdlc-sandbox:old\n');
    finish(stand);
    const { calls } = runScript(stand);
    const build = calls.find((call) => call.startsWith('build ')) ?? '';
    const tag = /sdlc-sandbox:([0-9a-f]+)/.exec(build)?.[1] ?? '';
    expect(tag).toHaveLength(64);
    expect(calls.some((call) => call === 'rmi sdlc-sandbox:old')).toBe(true);
    expect(calls.some((call) => call.startsWith('rmi ') && call.includes(tag))).toBe(false);
  });

  it('a change to package.json alone gives another image', () => {
    const first = makeStand();
    const second = makeStand((work) => {
      write(path.join(work, 'package.json'), '{"name":"y"}\n');
      git(work, ['add', '-A']);
      git(work, ['commit', '-q', '-m', 'name']);
    });
    finish(first);
    finish(second);
    const tagOf = (calls: string[]) => /sdlc-sandbox:([0-9a-f]+)/.exec(calls.join('\n'))?.[1];
    expect(tagOf(runScript(first).calls)).not.toBe(tagOf(runScript(second).calls));
  });

  it('a folder a test left read-only does not turn a pass red', () => {
    const stand = makeStand();
    write(path.join(stand.fake, 'read-only'), '');
    finish(stand);
    const r = runScript(stand);
    expect(r.code, r.out).toBe(0);
    expect(fs.existsSync(path.join(runFolders(stand)[0], 'source'))).toBe(false);
  });
});

describe.skipIf(process.platform === 'win32')('B265 review: run.sh records what a shard ran', () => {
  function runner(commandIn: (root: string) => string[]) {
    const root = tempDir('sdlc-runner-');
    const dirs = ['workspace', 'deps/node_modules', 'npm-cache', 'scratch', 'evidence', 'home', 'tmp', 'bin'];
    for (const dir of dirs) fs.mkdirSync(path.join(root, dir), { recursive: true });
    write(path.join(root, 'bin/npm'), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(root, 'bin/npm'), 0o755);
    const places: Record<string, string> = {
      '/deps/node_modules': path.join(root, 'deps/node_modules'),
      '/opt/npm-cache': path.join(root, 'npm-cache'),
      '/scratch/': `${root}/scratch/`,
      '/evidence': `${root}/evidence`,
      '/workspace': `${root}/workspace`,
    };
    const text = RUNNER.replace(/\/deps\/node_modules|\/opt\/npm-cache|\/scratch\/|\/evidence|\/workspace/g,
      (place) => places[place]);
    const env = { ...process.env, HOME: path.join(root, 'home'), TMPDIR: path.join(root, 'tmp'),
      PATH: `${path.join(root, 'bin')}:${process.env.PATH}` };
    const args = ['-s', '--', ...commandIn(root)];
    const r = spawnSync('bash', args, { input: text, env, encoding: 'utf-8', timeout: LIMIT_MS });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  }

  /** In a file, because run.sh echoes the command it runs and only the command's output is under test. */
  function nestedThenReal(root: string): string[] {
    const report = path.join(root, 'report.txt');
    write(report, [
      ' Test Files  1 failed (1)',
      '      Tests  1 failed (1)',
      ' Test Files  9 passed (9)',
      '      Tests  77 passed | 2 skipped (79)',
      '',
    ].join('\n'));
    return ['cat', report];
  }

  it('a passing command prints the last counts, not those of a suite nested inside a test', () => {
    const r = runner(nestedThenReal);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('Tests  77 passed | 2 skipped (79)');
    expect(r.out).toContain('Test Files  9 passed (9)');
    expect(r.out).not.toContain('1 failed');
  });

  it('the versions the commit was tested on are in the record', () => {
    const r = runner(() => ['true']);
    expect(r.out).toContain(`node ${process.version}`);
    expect(r.out).toMatch(/git version \d/);
  });

  it('a failing command passes its code through and still shows its tail', () => {
    const r = runner(() => ['sh', '-c', 'echo boom; exit 6']);
    expect(r.code).toBe(6);
    expect(r.out).toContain('boom');
  });
});
