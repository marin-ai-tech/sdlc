import type { ProjectContext } from '../cli/context.js';
import { changeFolders } from './audit-change.js';
import type { ChangeRef } from './changes.js';
import { SdlcError } from './errors.js';
import { commitsTouching, defaultBaseRef, git } from './git.js';
import { shownValue } from './shown-value.js';

/**
 * The oldest commit in the history of the change's `.openspec.yaml`, following renames. It can only widen what a
 * reviewer sees: a reused id may bring in the older change, and removing and adding back the file hides nothing.
 */
function changeStart(root: string, folders: string[]): string | undefined {
  const history = git(root, ['log', '--follow', '--format=%H', '--', `${folders[0]}/.openspec.yaml`]);
  const oldest = history.ok ? history.stdout.split(/\r?\n/).filter(Boolean).pop() : undefined;
  return oldest ?? commitsTouching(root, folders)[0]?.sha;
}

/**
 * The full hash of the commit `base` names, or of the tree when `tree` (the empty tree of a root commit), for the
 * diff command the review context prints (B249 review F2): a person may paste that command, so it carries the hash,
 * never the base text. A base that names neither is refused as an unknown ref.
 */
export function resolvedBase(root: string, base: string, tree: boolean): string {
  const wanted = `${base}^{${tree ? 'tree' : 'commit'}}`;
  const resolved = git(root, ['rev-parse', '--verify', '--quiet', '--end-of-options', wanted]);
  if (resolved.ok && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(resolved.stdout)) return resolved.stdout;
  throw new SdlcError('unknown_ref', { key: 'error.unknown_git_ref_x', params: { ref: shownValue(base) } });
}

/** Choose the review diff base for a change, including work committed directly on the base branch. */
export function changeBase(ctx: ProjectContext, ref: ChangeRef, explicit?: string): string | undefined {
  if (explicit !== undefined) return explicit;
  const base = defaultBaseRef(ctx.root);
  if (!base) return base;
  const branch = git(ctx.root, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const onBase = branch.ok && branch.stdout === base.replace(/^origin\//, '');
  if (!onBase && !git(ctx.root, ['merge-base', '--is-ancestor', '--end-of-options', 'HEAD', base]).ok) return base;
  const first = changeStart(ctx.root, changeFolders(ctx.paths, ref));
  if (!first) return base;
  const parent = git(ctx.root, ['rev-parse', '--verify', `${first}^`]);
  if (parent.ok) return parent.stdout;
  if (git(ctx.root, ['rev-parse', '--is-shallow-repository']).stdout === 'true') return base;
  const empty = git(ctx.root, ['hash-object', '-t', 'tree', '--stdin']);
  return empty.ok ? empty.stdout : base;
}
