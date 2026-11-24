// Runs a command, or the whole suite with no command, on the private server on the commit at HEAD.
// `sdlc verify` calls this, and its fingerprint hashes the files on disk, so a state the server would not test
// stops here.
// The server is read from the `origin` remote: no address lives in tracked files. No setting of this tool replaces
// ssh. With the variables of the remote verify contract (src/core/verify-remote.ts, B252) it answers which commit it
// sent and how the server run ended, and copies the run.log of the server run, so sdlc checks the commit itself.
// What it cannot stop is a hostile shell on this host, which can put another ssh first on PATH, swap the commit
// during a run or write the answer itself.
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const REFUSED = 2;
const SERVER_REFUSED = 3;
const SERVER_BUSY = 75;
const SSH_FAILED = 255;
const TOOL = 'scripts/sandbox/test.sh';
const ORIGIN = /^ssh:\/\/([A-Za-z0-9_][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9.-]*)(\/[A-Za-z0-9._/-]+)$/;
const PUBLIC_HOST = /^github\.com$/i;
const ARGUMENT = /^[A-Za-z0-9._/=:@%+-]+$/;
const HOST_PATH = /^(--?[^=]+=)?[A-Za-z]:[\\/]/;
const SSH_OPTIONS = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20',
  '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=6'];
const LAST_LINE = 'main "$@"';
/** The last line test.sh prints, and the run folder it names, relative to the home folder on the server. */
const FINISHED = /^sandbox finished \d{2}:\d{2}:\d{2}, exit=(\d{1,3}), logs: (.*)$/;
const RUN_FOLDER = /^sandbox_runs\/sdlc\/sdlc-sandbox-([0-9a-f]{8})-\d{8}_\d{6}$/;
const OUTPUT_LIMIT = 256 * 1024 * 1024;
/** The copy of run.log runs after the server run, inside the same verify limit as the run itself. */
export const LOG_COPY_SECONDS = 45;
/** sdlc keeps only the last 8 MiB of the log (LOG_LIMIT in src/core/verify-remote.ts), so no more is read. */
const KEPT_LOG_BYTES = 8 * 1024 * 1024;
/** The control bytes test.sh removes from the container output: tabs and line feeds stay. */
const CONTROL_BYTES = /[\x00-\x08\x0b-\x1f\x7f]/g;

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

/** The variables of the remote verify contract; an empty or missing value counts as unset. */
function contractOf(env = {}) {
  const value = (name) => (typeof env[name] === 'string' && env[name] !== '' ? env[name] : undefined);
  return { commit: value('SDLC_VERIFY_COMMIT'), answer: value('SDLC_VERIFY_ANSWER'), log: value('SDLC_VERIFY_LOG') };
}

/** A stale answer must never outlive this run, whatever ends it; false when it could not be removed. */
function removeStaleAnswer(file, log) {
  if (file === undefined) return true;
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch (error) {
    log(`Refused: the answer at ${JSON.stringify(file)} could not be removed: ${error.message}`);
    return false;
  }
}

/** The commit at HEAD, or undefined when there is none or the contract asks for another one. */
function headCommit(cwd, expected, log) {
  const commit = git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']);
  if (!commit.ok) {
    log('Refused: git could not compare the files on disk with the commit at HEAD, because there is no commit.');
    return undefined;
  }
  const sha = commit.stdout.trim();
  if (expected !== undefined && expected !== sha) {
    log(`Refused: SDLC_VERIFY_COMMIT names the commit ${JSON.stringify(expected)}, but HEAD is ${sha}.`);
    return undefined;
  }
  return sha;
}

/** The blob of test.sh at the commit, or undefined when it is missing or would exit 0 with nothing run. */
function toolScript(cwd, sha, log) {
  const script = git(cwd, ['cat-file', 'blob', `${sha}:${TOOL}`]);
  if (!script.ok) {
    log(`Refused: the commit at HEAD does not hold ${TOOL}.`);
    return undefined;
  }
  if (script.stdout.trimEnd().split('\n').pop() !== LAST_LINE) {
    log(`Refused: ${TOOL} at HEAD does not end with ${LAST_LINE}: bash would exit 0 with nothing run.`);
    return undefined;
  }
  return script.stdout;
}

/** What goes to the server, or undefined when the run is refused; every refusal names its reason. */
function planRun(cwd, args, expected, log) {
  const sha = headCommit(cwd, expected, log);
  if (sha === undefined || refuseState(cwd, sha, log)) return undefined;
  const origin = parseOrigin(cwd);
  if (!origin) {
    log('Refused: the origin remote is not an ssh:// address of the private server, so there is nowhere to test.');
    return undefined;
  }
  const refusal = refusedArgument(args);
  if (refusal !== undefined) {
    log(`Refused: ${refusal}`);
    return undefined;
  }
  const script = toolScript(cwd, sha, log);
  return script === undefined ? undefined : { sha, origin, script };
}

/** The status of the answer, or undefined when the result is unknown or the server refused the commit. */
function answerStatus(result) {
  if (result.signal) return undefined;
  if (result.error || result.status === SSH_FAILED) return 'unavailable';
  if (typeof result.status !== 'number' || result.status === SERVER_REFUSED) return undefined;
  if (result.status === 0) return 'passed';
  return result.status === SERVER_BUSY ? 'busy' : 'failed';
}

/** Removes the temporary files `.<name>.<anything>.tmp` an earlier run left beside the file; throws on failure. */
function removeLeftovers(file) {
  const prefix = `.${path.basename(file)}.`;
  const leftover = (name) => name.startsWith(prefix) && name.endsWith('.tmp') && name.length > prefix.length + 4;
  for (const name of fs.readdirSync(path.dirname(file)).filter(leftover)) {
    fs.rmSync(path.join(path.dirname(file), name), { force: true });
  }
}

/** Writes through a temporary file in the same folder, so a reader sees the whole file or none; throws on failure. */
function writeWhole(file, text) {
  removeLeftovers(file);
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  let created = false;
  try {
    fs.writeFileSync(temporary, text, { flag: 'wx' });
    created = true;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (created) fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function writeAnswer(file, commit, result, log) {
  const status = answerStatus(result);
  if (status === undefined) return;
  try {
    writeWhole(file, `${JSON.stringify({ commit, status })}\n`);
  } catch (error) {
    log(`No answer written: ${error.message}`);
  }
}

/**
 * The run folder named by the last finished line, when that line reports the exit of this run and the folder is
 * this project's folder for the commit sent.
 */
function runFolder(output, sha, status) {
  const finished = output.split(/\r?\n/).filter((line) => FINISHED.test(line));
  if (finished.length === 0) return undefined;
  const [, exit, folder] = FINISHED.exec(finished[finished.length - 1]);
  if (Number(exit) !== status) return undefined;
  const match = RUN_FOLDER.exec(folder);
  return match && match[1] === sha.slice(0, 8) ? folder : undefined;
}

/** Copies the kept part of run.log of the server run to the log file; it never changes the answer or the exit code. */
function keepServerLog({ file, run, plan, ssh, log }) {
  const folder = runFolder(typeof run.stdout === 'string' ? run.stdout : '', plan.sha, run.status);
  if (folder === undefined) {
    log('No server log kept: the output names no run folder of this commit and this exit.');
    return;
  }
  const read = ['tail', '-c', String(KEPT_LOG_BYTES), '--', `${folder}/run.log`];
  const result = ssh([...SSH_OPTIONS, plan.origin.target, ...read], '', true, LOG_COPY_SECONDS);
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string') {
    log(`No server log kept: reading ${folder}/run.log did not succeed.`);
    return;
  }
  try {
    writeWhole(file, result.stdout.replace(CONTROL_BYTES, ''));
  } catch (error) {
    log(`No server log kept: ${error.message}`);
  }
}

export function runRemoteTest({ cwd, args, ssh, log, env, print = () => undefined }) {
  const contract = contractOf(env);
  if (!removeStaleAnswer(contract.answer, log)) return REFUSED;
  const plan = planRun(cwd, args, contract.commit, log);
  if (!plan) return REFUSED;
  const capture = contract.log !== undefined;
  const remote = ['bash', '-s', '--', plan.origin.repository, plan.sha, ...args];
  const result = ssh([...SSH_OPTIONS, plan.origin.target, ...remote], plan.script, capture);
  if (result.error) log(`ssh did not run: ${result.error.message}`);
  if (capture && typeof result.stdout === 'string') print(result.stdout);
  if (contract.answer !== undefined) writeAnswer(contract.answer, plan.sha, result, log);
  if (capture) keepServerLog({ file: contract.log, run: result, plan, ssh, log });
  return result.status ?? 1;
}

/**
 * Captures stdout only when asked: the log needs the last line; otherwise the server output streams as it comes.
 * A time limit applies only when given: the server run has its own limits on the server.
 */
function realSsh(args, input, capture, timeoutSeconds) {
  return spawnSync('ssh', args, { input, cwd: os.homedir(), encoding: 'utf-8', maxBuffer: OUTPUT_LIMIT,
    stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    ...(timeoutSeconds === undefined ? {} : { timeout: timeoutSeconds * 1000 }) });
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runRemoteTest({
    cwd: process.cwd(),
    args: process.argv.slice(2),
    ssh: realSsh,
    log: (message) => console.error(message),
    env: process.env,
    print: (text) => process.stdout.write(text),
  });
}
