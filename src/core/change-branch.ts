import { git } from './git.js';
import { listActiveChanges } from './changes.js';
import type { ProjectPaths } from './project.js';

/** Only verify opts into branch-based change selection. */
export function branchChange(root: string, paths: ProjectPaths): string | undefined {
  const branch = git(root, ['symbolic-ref', '--short', 'HEAD']);
  if (!branch.ok || !branch.stdout.startsWith('change/')) return undefined;
  const id = branch.stdout.slice('change/'.length);
  return listActiveChanges(paths).some((change) => change.id === id) ? id : undefined;
}
