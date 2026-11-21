import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SpawnSyncReturns } from 'node:child_process';

/**
 * The temporary index of the worktree fingerprint (B326). It is seeded from the real index, which keeps tracked
 * ignored files and the recorded file modes, but git must not decide from that seed which files to read: cached
 * stat data, `assume-unchanged` and `skip-worktree` bits, fsmonitor and `core.ignoreStat` each let an edit keep the
 * old blob.
 */

/**
 * Git settings for every fingerprint call: no file monitor, no untracked cache, no ignored stat, and ctime trusted
 * with full stat checks, so a modification time set back by hand does not hide an edit.
 */
export const NO_STAT_TRUST = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.untrackedCache=false',
  '-c', 'core.ignoreStat=false',
  '-c', 'core.trustctime=true',
  '-c', 'core.checkStat=default',
];

/** Seconds after the epoch for the copy's time: every entry is newer, so git compares each one's content. */
const RACY_INDEX_TIME = 1;

type Run = (args: string[], input?: string) => SpawnSyncReturns<string>;

/** Dates the copy at 1 s after the epoch, so git treats every entry as racily clean (git's racy-git rule). */
function markRacy(index: string): void {
  if (fs.existsSync(index)) fs.utimesSync(index, RACY_INDEX_TIME, RACY_INDEX_TIME);
}

/**
 * Copies the real index and marks the copy racy. A missing index is legitimate before staging; an unreadable one
 * must never become an empty seed.
 */
export function seedFingerprintIndex(source: string, target: string): boolean {
  try {
    fs.copyFileSync(source, target);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT';
  }
  markRacy(target);
  return true;
}

/** The path exists as an entry on disk, a dangling link included; deletions are left to `add -A`. */
function onDisk(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/** Paths of `ls-files -v -z` whose tag passes `test`. */
function tagged(listing: string, test: (tag: string) => boolean): string[] {
  return listing.split('\0')
    .filter((line) => line.length > 2 && line[1] === ' ' && test(line[0]))
    .map((line) => line.slice(2));
}

/**
 * Clears in the copy the `assume-unchanged` bits (lower-case tags) and the `skip-worktree` bits (tag S or s) of
 * files present on disk; a skip-worktree file absent from disk (sparse checkout) keeps its entry. The copy is marked
 * racy again after each write. The real index keeps every bit.
 */
/**
 * Adds the content of every tracked file again, whatever its stat data (`--renormalize`). Entries still marked
 * skip-worktree are files absent from disk (sparse checkout) and keep their entry; `-A --sparse` then adds untracked
 * files and deletions without refusing the sparse paths.
 */
export function addEveryFile(run: Run, top: string): boolean {
  const listed = run(['ls-files', '-v', '-z']);
  if (listed.status !== 0) return false;
  const present = tagged(listed.stdout, (tag) => tag !== 'S' && tag !== 's')
    .filter((file) => onDisk(path.join(top, file)));
  if (present.length > 0) {
    const args = ['--literal-pathspecs', 'add', '--renormalize', '--pathspec-from-file=-', '--pathspec-file-nul'];
    if (run(args, present.join('\0')).status !== 0) return false;
  }
  return run(['add', '-A', '--sparse', '--', '.']).status === 0;
}

export function clearIndexFlags(run: Run, top: string, index: string): boolean {
  const listed = run(['ls-files', '-v', '-z']);
  if (listed.status !== 0) return false;
  const assumed = tagged(listed.stdout, (tag) => tag !== tag.toUpperCase());
  const skipped = tagged(listed.stdout, (tag) => tag === 'S' || tag === 's')
    .filter((file) => fs.existsSync(path.join(top, file)));
  const clears: Array<[string, string[]]> = [['--no-assume-unchanged', assumed], ['--no-skip-worktree', skipped]];
  for (const [flag, files] of clears) {
    if (files.length === 0) continue;
    if (run(['update-index', flag, '-z', '--stdin'], files.join('\0')).status !== 0) return false;
    markRacy(index);
  }
  return true;
}
