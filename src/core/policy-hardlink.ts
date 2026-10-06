import * as fs from 'node:fs';
import * as path from 'node:path';
import { changeDirs } from './policy-shell.js';

/**
 * Hard links to state files (B40). A hard link is the state file under another name: an edit through it writes the
 * record the CLI keeps, so the edit is a state write (rule `state-integrity`). The check stays cheap for the hook:
 * a target that does not exist, is not a file or has a single link is never compared; only a file with more than one
 * link is compared by device and inode with the state files of the project. The guard's own configuration (B41)
 * uses the same comparison with its files (`hardLinkedFiles`).
 */
const FIXED_STATE_FILES = ['openspec/roles.yaml', 'openspec/backlog.md', 'openspec/.sdlc/log.jsonl'];

interface FileId {
  dev: bigint;
  ino: bigint;
}

/** Device and inode of a file with more than one link; undefined for anything else. */
function linkedId(abs: string): FileId | undefined {
  try {
    const stat = fs.statSync(abs, { bigint: true });
    if (!stat.isFile() || stat.nlink <= 1n) return undefined;
    return { dev: stat.dev, ino: stat.ino };
  } catch {
    return undefined;
  }
}

/** The state files of the project, root-relative: the fixed ones and each change's `.sdlc.yaml`. */
function stateFiles(root: string): string[] {
  return [...FIXED_STATE_FILES, ...changeDirs(root).map((dir) => `${dir}/.sdlc.yaml`)];
}

function sameFile(id: FileId, abs: string): boolean {
  const other = linkedId(abs);
  return other !== undefined && other.dev === id.dev && other.ino === id.ino;
}

/** Edit targets that are hard links to a state file: the state files they share an inode with, root-relative. */
export function hardLinkedStateFiles(files: string[], root: string, cwd: string): string[] {
  return hardLinkedFiles(files, root, cwd, stateFiles);
}

/**
 * Edit targets that are hard links to one of `candidates` (root-relative, listed only when a target has more than
 * one link): the candidates they share an inode with, root-relative.
 */
export function hardLinkedFiles(files: string[], root: string, cwd: string, candidates: (root: string) => string[]) {
  const ids = files.map((file) => linkedId(path.resolve(cwd, file)));
  const linked = ids.filter((id): id is FileId => id !== undefined);
  if (linked.length === 0) return [];
  const hit = (rel: string) => linked.some((id) => sameFile(id, path.join(root, rel)));
  return candidates(root).filter(hit);
}
