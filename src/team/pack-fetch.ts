import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { git as runGitPlain } from '../core/git.js';
import { isDirectory, isFile, readText, writeTextAtomic } from '../core/fs-utils.js';
import { isGitPack, type GitPackConfig, type NpmPackConfig, type PackConfig, type PackSource } from './pack-config.js';
import { LIMITS, unsafeSkillPath } from './vetting.js';

/**
 * Fetching a pack (B76) into the cache `<git dir>/sdlc/packs/<name>/<ref-or-version>/`, which lives in the git dir
 * and is never committed. Nothing of a pack runs:
 * - git: a shallow fetch of the ref into a bare repository (no work tree, so no checkout, no filters, no hooks;
 *   `core.hooksPath` points nowhere and submodules are not fetched); the files under `roles/` and `skills/` are
 *   copied out of the commit's tree, regular blobs only (no symlinks, no submodules), each path checked.
 * - npm: only registry packages and tarballs are allowed. npm 10 can run `prepare` for folder and git specs even
 *   with `--ignore-scripts`, so those sources are refused. The tarball is extracted by `tar`.
 * A pack that cannot be fetched throws `PackError`; sync reports it and goes on with the next source.
 */
export class PackError extends Error {}

export interface FetchedPack {
  dir: string;
  source: PackSource;
}

const FETCH_MS = 180000;
const META = '.sdlc-pack.json';
/** Limits on a whole pack: the files under roles/ and skills/, and their size together. */
export const PACK_LIMITS = { files: 1000, bytes: 16 * 1024 * 1024 };
const LAYOUT = ['roles', 'skills'];

interface Run {
  ok: boolean;
  stdout: Buffer;
  stderr: string;
}

/** The cache root of the project's packs, created on demand; a project outside git has none. */
export function packsCache(root: string): string {
  const found = runGitPlain(root, ['rev-parse', '--absolute-git-dir']);
  if (!found.ok || !found.stdout) throw new PackError('not a git repository: the pack cache lives in the git dir');
  const cache = path.join(found.stdout, 'sdlc', 'packs');
  fs.mkdirSync(cache, { recursive: true });
  return cache;
}

/** A ref or a version as one safe folder name. */
function segment(value: string): string {
  const plain = value.replace(/[^\w.-]/g, '_').replace(/[. ]+$/, '_').slice(0, 100);
  return plain === '' || /^\.+$/.test(plain) ? '_' : plain;
}

function firstLine(text: string): string {
  const lines = text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  const fatal = lines.find((item) => /^(?:fatal|error|npm error)/i.test(item));
  return (fatal ?? lines[0] ?? 'failed').slice(0, 200);
}

function spawn(cmd: string, args: string[], cwd: string, input?: string, extraEnv = {}): Run {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', ...extraEnv };
  const options = { cwd, env, input, timeout: FETCH_MS, maxBuffer: 64 * 1024 * 1024, windowsHide: true };
  const result = spawnSync(cmd, args, options);
  const stderr = result.error ? result.error.message : (result.stderr ?? Buffer.alloc(0)).toString('utf8');
  return { ok: result.status === 0, stdout: result.stdout ?? Buffer.alloc(0), stderr };
}

/** git with the pack's hooks, submodules and the `ext` transport switched off whatever the user's config says. */
function gitRun(cwd: string, args: string[], input?: string): Run {
  const hardened = [
    '-c', `core.hooksPath=${path.join(cwd, 'no-hooks')}`, '-c', 'core.fsmonitor=false',
    '-c', 'submodule.recurse=false', '-c', 'fetch.recurseSubmodules=false', '-c', 'protocol.ext.allow=never',
  ];
  return spawn('git', [...hardened, ...args], cwd, input);
}

function gitOk(cwd: string, args: string[], input?: string): Buffer {
  const run = gitRun(cwd, args, input);
  if (!run.ok) throw new PackError(`git ${args[0]}: ${firstLine(run.stderr)}`);
  return run.stdout;
}

interface TreeFile {
  mode: string;
  sha: string;
  size: number;
  path: string;
}

/** The regular files under roles/ and skills/ of the commit; symlinks (120000) and submodules (160000) are left. */
function treeFiles(repo: string, commit: string): TreeFile[] {
  const out = gitOk(repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit, '--', ...LAYOUT]).toString('utf8');
  const files: TreeFile[] = [];
  for (const record of out.split('\0').filter(Boolean)) {
    const tab = record.indexOf('\t');
    const [mode, type, sha, size] = record.slice(0, tab).split(/ +/);
    const rel = record.slice(tab + 1);
    const regular = type === 'blob' && (mode === '100644' || mode === '100755');
    if (regular && !unsafeSkillPath(rel)) files.push({ mode, sha, size: Number(size), path: rel });
  }
  return files;
}

function assertPackSize(files: Array<{ path: string; size: number }>): void {
  if (files.length > PACK_LIMITS.files) throw new PackError(`more than ${PACK_LIMITS.files} files`);
  const big = files.find((file) => file.size > LIMITS.skillBytes);
  if (big) throw new PackError(`${big.path} is larger than ${LIMITS.skillBytes} bytes`);
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > PACK_LIMITS.bytes) throw new PackError(`the files are larger than ${PACK_LIMITS.bytes} bytes together`);
}

/** The contents of the blobs, in order, read in one `git cat-file --batch`. */
function blobs(repo: string, shas: string[]): Buffer[] {
  if (shas.length === 0) return [];
  const out = gitOk(repo, ['cat-file', '--batch'], `${shas.join('\n')}\n`);
  const contents: Buffer[] = [];
  let at = 0;
  for (const sha of shas) {
    const end = out.indexOf(0x0a, at);
    const header = out.subarray(at, end).toString('utf8').split(' ');
    if (header[0] !== sha || header[1] !== 'blob') throw new PackError(`git cat-file: ${sha} is not a blob`);
    const size = Number(header[2]);
    contents.push(out.subarray(end + 1, end + 1 + size));
    at = end + 1 + size + 1;
  }
  return contents;
}

function exportTree(repo: string, commit: string, target: string): void {
  const files = treeFiles(repo, commit);
  assertPackSize(files);
  const contents = blobs(repo, files.map((file) => file.sha));
  files.forEach((file, index) => {
    const abs = path.join(target, ...file.path.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, contents[index]);
  });
}

/** Replaces `<cache>/<name>/<folder>` with `staged` and drops the pack's other cached versions. */
function settle(cache: string, name: string, folder: string, staged: string): string {
  const base = path.join(cache, name);
  fs.mkdirSync(base, { recursive: true });
  for (const entry of fs.readdirSync(base)) {
    if (entry !== META) fs.rmSync(path.join(base, entry), { recursive: true, force: true });
  }
  const dir = path.join(base, folder);
  fs.renameSync(staged, dir);
  return dir;
}

function fetchGit(cache: string, work: string, pack: GitPackConfig): FetchedPack {
  const repo = path.join(work, 'repo.git');
  gitOk(work, ['init', '-q', '--bare', '--template=', repo]);
  const fetch = ['fetch', '-q', '--depth', '1', '--no-tags', '--no-recurse-submodules', '--', pack.git, pack.ref];
  gitOk(repo, fetch);
  const commit = gitOk(repo, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}']).toString('utf8').trim();
  const staged = path.join(work, 'files');
  fs.mkdirSync(staged);
  exportTree(repo, commit, staged);
  const dir = settle(cache, pack.name, segment(pack.ref), staged);
  return { dir, source: { pack: pack.name, git: pack.git, ref: pack.ref, commit } };
}

/** How to run npm without a shell: node with npm's own CLI script when it can be found, else `npm` itself. */
function npmCommand(): { cmd: string; args: string[] } {
  const bin = path.dirname(process.execPath);
  const execpath = process.env.npm_execpath ?? '';
  const candidates = [
    /npm-cli\.js$/.test(execpath) ? execpath : '',
    path.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const cli = candidates.find((file) => file !== '' && isFile(file));
  if (cli) return { cmd: process.execPath, args: [cli] };
  if (process.platform === 'win32') throw new PackError('npm not found next to node');
  return { cmd: 'npm', args: [] };
}

interface NpmPacked {
  name: string;
  version: string;
  integrity?: string;
  filename: string;
  unpackedSize?: number;
}

function packedInfo(stdout: string): NpmPacked {
  const start = stdout.indexOf('[');
  try {
    const list = JSON.parse(start === -1 ? stdout : stdout.slice(start)) as unknown;
    const item = (Array.isArray(list) ? list[0] : undefined) as Record<string, unknown> | undefined;
    const ok = typeof item?.name === 'string' && typeof item.version === 'string' && typeof item.filename === 'string';
    if (!ok) throw new PackError('npm pack --json gave no name, version or file');
    return item as unknown as NpmPacked;
  } catch (error) {
    throw error instanceof PackError ? error : new PackError('npm pack --json gave no JSON');
  }
}

function npmPack(root: string, spec: string, work: string): NpmPacked {
  if (!spec.startsWith('https://') && isDirectory(path.resolve(root, spec))) {
    throw new PackError(`npm pack: ${spec} is a directory, not a tarball`);
  }
  const npm = npmCommand();
  const flags = ['pack', '--ignore-scripts', '--json', '--no-audit', '--no-fund', '--no-update-notifier'];
  const run = spawn(npm.cmd, [...npm.args, ...flags, '--pack-destination', work, '--', spec], root, undefined,
    { npm_config_ignore_scripts: 'true' });
  if (!run.ok) throw new PackError(`npm pack: ${firstLine(run.stderr)}`);
  const info = packedInfo(run.stdout.toString('utf8'));
  if ((info.unpackedSize ?? 0) > PACK_LIMITS.bytes) {
    throw new PackError(`the package is larger than ${PACK_LIMITS.bytes} bytes unpacked`);
  }
  return info;
}

/** `tar` of the system (bsdtar on Windows 10+), run in the folder of the tarball so no path holds a drive colon. */
function tarCommand(): string {
  const system = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  return process.platform === 'win32' && isFile(system) ? system : 'tar';
}

function fetchNpm(root: string, cache: string, work: string, pack: NpmPackConfig): FetchedPack {
  const info = npmPack(root, pack.npm, work);
  const tarball = path.basename(info.filename);
  if (!isFile(path.join(work, tarball))) throw new PackError(`npm pack wrote no ${tarball}`);
  const extract = spawn(tarCommand(), ['-xzf', tarball], work);
  if (!extract.ok) throw new PackError(`tar: ${firstLine(extract.stderr)}`);
  const staged = path.join(work, 'package');
  if (!isDirectory(staged)) throw new PackError('the tarball has no package folder');
  const dir = settle(cache, pack.name, segment(info.version), staged);
  const integrity = typeof info.integrity === 'string' ? { integrity: info.integrity } : {};
  return { dir, source: { pack: pack.name, npm: pack.npm, version: info.version, ...integrity } };
}

function writeMeta(cache: string, pack: PackConfig, fetched: FetchedPack): void {
  const meta = { config: pack, folder: path.basename(fetched.dir), source: fetched.source };
  writeTextAtomic(path.join(cache, pack.name, META), `${JSON.stringify(meta, null, 2)}\n`);
}

/** Fetches the pack into the cache (replacing what was there) and records what was fetched. */
export function fetchPack(root: string, pack: PackConfig): FetchedPack {
  const cache = packsCache(root);
  const work = fs.mkdtempSync(path.join(cache, `.fetch-${pack.name}-`));
  try {
    const fetched = isGitPack(pack) ? fetchGit(cache, work, pack) : fetchNpm(root, cache, work, pack);
    writeMeta(cache, pack, fetched);
    return fetched;
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** The pack as last fetched for this very config entry, or undefined (never fetched, or the entry changed since). */
export function cachedPack(root: string, pack: PackConfig): FetchedPack | undefined {
  const base = path.join(packsCache(root), pack.name);
  try {
    const meta = JSON.parse(readText(path.join(base, META)) ?? 'null') as Record<string, unknown> | null;
    if (!meta || JSON.stringify(meta.config) !== JSON.stringify(pack)) return undefined;
    const folder = typeof meta.folder === 'string' && meta.folder === segment(meta.folder) ? meta.folder : '';
    const dir = path.join(base, folder);
    return folder !== '' && isDirectory(dir) ? { dir, source: meta.source as PackSource } : undefined;
  } catch {
    return undefined;
  }
}
