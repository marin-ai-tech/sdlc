import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isWithin } from '../../src/core/fs-utils.js';
import { tempDir, write } from '../helpers.js';

export interface ProjectCopyMeasurements {
  seedBuilds: number;
  seedMs: number[];
  cloneMs: number[];
  seedFiles: number;
  seedBytes: number;
}

interface Snapshot { root: string; digest: string; files: number; bytes: number }
interface Copies { seed?: Snapshot; measured: ProjectCopyMeasurements }

function refuse(detail: string): never {
  throw new Error(`Unsafe immutable board fixture: ${detail}`);
}

/**
 * The canonical spelling of a real path. The native call resolves 8.3 short names and letter case, as Git does
 * (a GitHub Windows runner's TEMP is `C:\Users\RUNNER~1\...`); `fs.realpathSync` keeps the spelling it was given.
 */
function canonical(file: string): string {
  return fs.realpathSync.native(file);
}

function physicalRoot(root: string): string {
  const owned = process.env.SDLC_TEST_TMP;
  if (!owned) return refuse('owned temporary root is unavailable');
  if (fs.lstatSync(root).isSymbolicLink()) return refuse('root indirection is not physical');
  const actual = canonical(root);
  const owner = canonical(owned);
  if (actual === owner || !isWithin(owner, actual)) return refuse('seed leaves its owned temporary root');
  const metadata = fs.lstatSync(path.join(actual, '.git'));
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) return refuse('Git metadata must be physical');
  return actual;
}

function localGit(root: string): void {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
  const result = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel', '--git-common-dir'], {
    env, encoding: 'utf8', timeout: 10000, windowsHide: true,
  });
  if (result.status !== 0) return refuse('Git root could not be inspected');
  const [top, common] = result.stdout.trim().split(/\r?\n/);
  if (!top || !common || canonical(top) !== canonical(root)
    || canonical(path.resolve(root, common)) !== canonical(path.join(root, '.git'))) {
    refuse('Git root or common-dir indirection');
  }
}

function quiescent(relative: string): void {
  if (/^\.git\/(?:commondir|gitdir|config\.worktree|objects\/info\/(?:http-)?alternates|worktrees)(?:\/|$)/i
    .test(relative)) refuse('Git alternates or worktree indirection');
  if (/(?:^|\/)\.sdlc\.yaml$/i.test(relative)
    || /^openspec\/\.sdlc(?:\/|$)/i.test(relative) || /^\.sdlc-tmp(?:\/|$)/i.test(relative)) {
    refuse('non-quiescent authority, decision or private store state');
  }
  if (/^\.git\/(?:refs|logs\/refs)\/sdlc(?:\/|$)/i.test(relative)) {
    refuse('decision/checkpoint authority is not immutable scaffolding');
  }
  if (/^openspec\/changes\/[^/]+\/(?:verification|review|release)\.md$/i.test(relative)) {
    refuse('execution/review results are not immutable scaffolding');
  }
  if (/^\.git\/.*\.lock$/i.test(relative)) refuse('lock state is not quiescent');
}

function fingerprint(root: string): Snapshot {
  const hash = createHash('sha256');
  const dirs = [''];
  let entries = 0;
  let files = 0;
  let bytes = 0;
  while (dirs.length) {
    const dir = dirs.pop()!;
    for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name))) {
      if (++entries > 4096) return refuse('seed entry bound exceeded');
      const relative = path.posix.join(dir, item.name);
      if (item.isSymbolicLink()) return refuse('filesystem indirection in seed');
      quiescent(relative);
      if (item.isDirectory()) dirs.push(relative);
      else {
        if (!item.isFile()) return refuse('seed contains a non-regular file');
        const size = fs.statSync(path.join(root, relative)).size;
        if (size > 64 * 1024 * 1024 - bytes) return refuse('seed byte bound exceeded');
        const value = fs.readFileSync(path.join(root, relative));
        if (relative === '.git/packed-refs' && /\srefs\/sdlc(?:\/|$)/m.test(value.toString('utf8'))) {
          return refuse('packed decision/checkpoint authority');
        }
        if (relative === '.git/config' && /^\s*\[(?:credential|http|remote|url|include|includeIf)(?:\s|["\]])/im.test(value.toString('utf8'))) {
          return refuse('credential/remote/include authority in Git configuration');
        }
        bytes += value.length;
        if (bytes > 64 * 1024 * 1024) return refuse('seed byte bound exceeded');
        files++;
        hash.update(JSON.stringify([relative, value.length])).update('\0').update(value);
      }
    }
  }
  return { root, digest: hash.digest('hex'), files, bytes };
}

function buildOnce(state: Copies, build: () => string): Snapshot {
  const started = performance.now();
  const root = physicalRoot(build());
  localGit(root);
  const snapshot = fingerprint(root);
  state.measured.seedBuilds++;
  state.measured.seedMs.push(performance.now() - started);
  state.measured.seedFiles = snapshot.files;
  state.measured.seedBytes = snapshot.bytes;
  return snapshot;
}

function createCopy(state: Copies, build: () => string, prefix: string): string {
  const seed = state.seed ??= buildOnce(state, build);
  if (fingerprint(seed.root).digest !== seed.digest) return refuse('seed bytes or refs changed');
  const root = tempDir(prefix);
  const started = performance.now();
  fs.cpSync(seed.root, root, { recursive: true });
  localGit(root);
  if (fingerprint(root).digest !== seed.digest) return refuse('copy differs from real seed');
  if (fingerprint(seed.root).digest !== seed.digest) return refuse('seed bytes or refs changed during copy');
  state.measured.cloneMs.push(performance.now() - started);
  return root;
}

/** Private real seed, always physically copied; callers rebuild case-specific closures and homes. */
export function immutableBoardProject(build: () => string, prefix: string) {
  const state: Copies = { measured: { seedBuilds: 0, seedMs: [], cloneMs: [], seedFiles: 0, seedBytes: 0 } };
  return { create: () => createCopy(state, build, prefix), measurements: () => structuredClone(state.measured) };
}

export function reportBoardProject(name: string, copies: ReturnType<typeof immutableBoardProject>): void {
  const report = process.env.SDLC_TEST_REPORT;
  if (report) write(`${report}.${name}.fixtures.json`, `${JSON.stringify(copies.measurements(), null, 2)}\n`);
}
