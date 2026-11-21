import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { git } from './git.js';

/** The committed tree with the same exclusions as a worktree fingerprint. */
export function commitFingerprint(root: string, commit: string, excludes: string[]): string | undefined {
  const noReplace = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  const top = git(root, ['rev-parse', '--show-toplevel'], { env: noReplace });
  const prefix = git(root, ['rev-parse', '--show-prefix'], { env: noReplace });
  if (!top.ok || !prefix.ok) return undefined;
  const tmpIndex = path.join(
    os.tmpdir(), `sdlc-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  const env = { ...noReplace, GIT_INDEX_FILE: tmpIndex };
  const run = (args: string[]) => git(top.stdout, args, { env });
  try {
    if (!run(['read-tree', commit]).ok) return undefined;
    for (const excluded of excludes) {
      const name = `${prefix.stdout}${excluded}`;
      if (!run(['--literal-pathspecs', 'rm', '-r', '--cached', '-q', '-f', '--ignore-unmatch', '--', name]).ok) {
        return undefined;
      }
    }
    const tree = run(['write-tree']);
    return tree.ok && tree.stdout ? `git-tree:${tree.stdout}` : undefined;
  } catch {
    return undefined;
  } finally {
    try {
      fs.rmSync(tmpIndex, { force: true });
    } catch {
      // best effort
    }
  }
}

/** Repository-relative paths whose content or presence differs between two tree fingerprints. */
export function treeDifference(root: string, a: string, b: string): string[] | undefined {
  const treeId = (fingerprint: string) => fingerprint.startsWith('git-tree:')
    ? fingerprint.slice('git-tree:'.length) : undefined;
  const first = treeId(a);
  const second = treeId(b);
  if (!first || !second) return undefined;
  const env = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' };
  const diff = git(root, ['diff-tree', '-r', '--name-only', '--no-renames', first, second], { env });
  return diff.ok ? diff.stdout.split('\n').filter(Boolean) : undefined;
}
