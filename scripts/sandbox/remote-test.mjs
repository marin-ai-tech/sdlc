// Runs a command, or the whole suite with no command, on the private server on the commit at HEAD.
// `sdlc verify` calls this, and its fingerprint hashes the files on disk, so a state the server would not test
// stops here.
// The server is read from the `origin` remote: no address lives in tracked files. No setting of this tool replaces
// ssh. What it cannot stop is a hostile shell on this host, which can put another ssh first on PATH or swap the
// commit during a run; binding a result to the fingerprint is B252.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REFUSED = 2;
const TOOL = 'scripts/sandbox/test.sh';
const ORIGIN = /^ssh:\/\/([A-Za-z0-9_][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9.-]*)(\/[A-Za-z0-9._/-]+)$/;
const PUBLIC_HOST = /^github\.com$/i;
const ARGUMENT = /^[A-Za-z0-9._/=:@%+-]+$/;
const HOST_PATH = /^(--?[^=]+=)?[A-Za-z]:[\\/]/;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6'];
const LAST_LINE = 'main "$@"';

/** A local replace ref or an inherited repository path would make git answer about something the server never sees. */
function gitEnvironment(extra = {}) {
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', ...extra };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  return env;
}

function git(cwd, args, extra) {
  const options = { cwd, env: gitEnvironment(extra), encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 };
  const r = spawnSync('git', args, options);
  return { ok: r.status === 0, stdout: r.stdout ?? '' };
}

/** Hashes the files on disk into `index`, already seeded, and returns the tree, or undefined when git failed. */
function treeOnDisk(cwd, index) {
  const extra = { GIT_INDEX_FILE: index };
  if (!git(cwd, ['add', '-A', '--', ':/'], extra).ok) return undefined;
  const tree = git(cwd, ['write-tree'], extra);
  return tree.ok ? tree.stdout.trim() : undefined;
}

function treeFromCommit(cwd, commit, index) {
  return git(cwd, ['read-tree', commit], { GIT_INDEX_FILE: index }).ok ? treeOnDisk(cwd, index) : undefined;
}

/** The verify fingerprint seeds from the real index, whose flags and forced entries a fresh index does not hold. */
function treeFromRealIndex(cwd, index) {
  const real = git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  if (!real.ok) return undefined;
  if (fs.existsSync(real.stdout.trim())) fs.copyFileSync(real.stdout.trim(), index);
  return treeOnDisk(cwd, index);
}

/** Compares the commit with the disk two ways, with no index flags to hide behind: 'same', 'differs' or 'unknown'. */
function compareWithDisk(cwd, commit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-remote-test-'));
  try {
    const expected = git(cwd, ['rev-parse', `${commit}^{tree}`]);
    const fresh = treeFromCommit(cwd, commit, path.join(dir, 'fresh'));
    const seeded = treeFromRealIndex(cwd, path.join(dir, 'seeded'));
    if (!expected.ok || fresh === undefined || seeded === undefined) return 'unknown';
    const tree = expected.stdout.trim();
    return fresh === tree && seeded === tree ? 'same' : 'differs';
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function describeChanges(cwd) {
  const status = git(cwd, ['status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none']);
  return status.stdout.trim() || '(hidden from git status: an index flag or a file added by force)';
}

function parseOrigin(cwd) {
  const url = git(cwd, ['remote', 'get-url', 'origin']);
  const match = url.ok ? ORIGIN.exec(url.stdout.trim()) : null;
  if (!match || PUBLIC_HOST.test(match[2])) return null;
  return { target: `${match[1]}@${match[2]}`, repository: match[3] };
}

/** The arguments cross a remote shell, which splits and expands them; only characters with no meaning there pass. */
function firstUnsafeArgument(args) {
  return args.find((argument) => !ARGUMENT.test(argument));
}

function refusedArgument(args) {
  const hostPath = args.find((argument) => HOST_PATH.test(argument));
  if (hostPath !== undefined) {
    return `${hostPath} is a path of this host. Git Bash rewrites /path arguments: set MSYS_NO_PATHCONV=1.`;
  }
  const unsafe = firstUnsafeArgument(args);
  if (unsafe !== undefined) return `the argument ${JSON.stringify(unsafe)} is not safe to pass through a remote shell.`;
  return undefined;
}

function refuseState(cwd, commit, log) {
  const state = compareWithDisk(cwd, commit);
  if (state === 'same') return false;
  if (state === 'unknown') {
    log('Refused: git could not compare the files on disk with the commit at HEAD.');
    return true;
  }
  const changes = describeChanges(cwd);
  log(`Refused: the files on disk are not the commit at HEAD, and the server tests only commits:\n${changes}`);
  return true;
}

export function runRemoteTest({ cwd, args, ssh, log }) {
  const commit = git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!commit.ok) {
    log('Refused: git could not compare the files on disk with the commit at HEAD, because there is no commit.');
    return REFUSED;
  }
  const sha = commit.stdout.trim();
  if (refuseState(cwd, sha, log)) return REFUSED;
  const origin = parseOrigin(cwd);
  if (!origin) {
    log('Refused: the origin remote is not an ssh:// address of the private server, so there is nowhere to test.');
    return REFUSED;
  }
  const refusal = refusedArgument(args);
  if (refusal !== undefined) {
    log(`Refused: ${refusal}`);
    return REFUSED;
  }
  const script = git(cwd, ['cat-file', 'blob', `${sha}:${TOOL}`]);
  if (!script.ok) {
    log(`Refused: the commit at HEAD does not hold ${TOOL}.`);
    return REFUSED;
  }
  if (script.stdout.trimEnd().split('\n').pop() !== LAST_LINE) {
    log(`Refused: ${TOOL} at HEAD does not end with ${LAST_LINE}: bash would exit 0 with nothing run.`);
    return REFUSED;
  }
  const remote = ['bash', '-s', '--', origin.repository, sha, ...args];
  const result = ssh([...SSH_OPTIONS, origin.target, ...remote], script.stdout);
  if (result.error) log(`ssh did not run: ${result.error.message}`);
  return result.status ?? 1;
}

function realSsh(args, script) {
  return spawnSync('ssh', args, { input: script, stdio: ['pipe', 'inherit', 'inherit'], cwd: os.homedir() });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runRemoteTest({
    cwd: process.cwd(),
    args: process.argv.slice(2),
    ssh: realSsh,
    log: (message) => console.error(message),
  });
}
