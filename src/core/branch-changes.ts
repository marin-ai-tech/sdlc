import * as path from 'node:path';
import { listActiveChanges, listArchivedChanges, isValidChangeId } from './changes.js';
import { git } from './git.js';
import { projectPaths } from './project.js';

export interface BranchChange { id: string; branch: string }

/** Changes visible on other refs as of the last fetch. Reads refs and trees only. */
export function otherBranchChanges(root: string): BranchChange[] {
  const top = git(root, ['rev-parse', '--show-toplevel']);
  if (!top.ok || path.resolve(top.stdout) !== path.resolve(root)) return [];
  const current = git(root, ['symbolic-ref', '--quiet', 'HEAD']).stdout;
  const refs = git(root, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  if (!refs.ok) return [];
  const paths = projectPaths(root);
  const excluded = new Set([
    ...listActiveChanges(paths).map((change) => change.id),
    ...listArchivedChanges(paths).map((change) => change.id),
  ]);
  const found = new Map<string, BranchChange>();
  const branches = refs.stdout.split('\n').filter(Boolean).filter((ref) => ref !== current && !ref.endsWith('/HEAD'));
  branches.sort((a, b) => Number(b.startsWith('refs/heads/')) - Number(a.startsWith('refs/heads/'))
    || a.localeCompare(b));
  for (const ref of branches) {
    const branch = ref.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, '');
    const tree = git(root, ['ls-tree', '-d', '--name-only', `${ref}:openspec/changes`]);
    if (!tree.ok) continue;
    for (const id of tree.stdout.split('\n')) {
      if (id === 'archive' || !isValidChangeId(id) || excluded.has(id) || found.has(id)) continue;
      found.set(id, { id, branch });
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}
