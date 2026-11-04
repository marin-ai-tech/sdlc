import type { ProjectContext } from '../cli/context.js';
import { changeFolders } from './audit-change.js';
import type { ChangeRef } from './changes.js';
import { commitsTouching, defaultBaseRef, git } from './git.js';

/**
 * The oldest commit in the history of the change's `.openspec.yaml`, following renames. It can only widen what a
 * reviewer sees: a reused id may bring in the older change, and removing and adding back the file hides nothing.
 */
function changeStart(root: string, folders: string[]): string | undefined {
  const history = git(root, ['log', '--follow', '--format=%H', '--', `${folders[0]}/.openspec.yaml`]);
  const oldest = history.ok ? history.stdout.split(/\r?\n/).filter(Boolean).pop() : undefined;
  return oldest ?? commitsTouching(root, folders)[0]?.sha;
}

/** Choose the review diff base for a change, including work committed directly on the base branch. */
export function changeBase(ctx: ProjectContext, ref: ChangeRef, explicit?: string): string | undefined {
  if (explicit !== undefined) return explicit;
  const base = defaultBaseRef(ctx.root);
  if (!base) return base;
  const branch = git(ctx.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const onBase = branch.ok && branch.stdout === base.replace(/^origin\//, '');
  if (!onBase && !git(ctx.root, ['merge-base', '--is-ancestor', 'HEAD', base]).ok) return base;
  const first = changeStart(ctx.root, changeFolders(ctx.paths, ref));
  if (!first) return base;
  const parent = git(ctx.root, ['rev-parse', '--verify', `${first}^`]);
  if (parent.ok) return parent.stdout;
  if (git(ctx.root, ['rev-parse', '--is-shallow-repository']).stdout === 'true') return base;
  const empty = git(ctx.root, ['hash-object', '-t', 'tree', '--stdin']);
  return empty.ok ? empty.stdout : base;
}
