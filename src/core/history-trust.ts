import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { git, type GitResult } from './git.js';

/**
 * B114: the roles history check reads commit parents and old roles.yaml versions, so it trusts only a complete
 * history that nothing rewrites. Its git calls run with replace objects disabled, a failed call is an error (never
 * an empty answer), and historyErrors names a shallow clone or a grafts file.
 */

/** Runs git with replace objects disabled (`GIT_NO_REPLACE_OBJECTS=1`), so `git replace` cannot swap commits. */
export function trustedGit(root: string, args: string[]): GitResult {
  return git(root, args, { env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' } });
}

/** Like trustedGit, but a failed call throws `history_unreadable` instead of reading as an empty answer. */
export function requiredGit(root: string, args: string[]): string {
  const result = trustedGit(root, args);
  if (!result.ok) throw historyUnreadable(args);
  return result.stdout;
}

function historyUnreadable(args: string[]): SdlcError {
  const params = { command: `git ${args.join(' ')}` };
  return new SdlcError('history_unreadable', { key: 'error.history_unreadable', params }, {
    key: 'fix.history_unreadable',
  });
}

/** The absolute path of `name` inside the git dir (`git rev-parse --git-path`, which follows the git environment). */
function gitPath(root: string, name: string): string {
  return path.resolve(root, requiredGit(root, ['rev-parse', '--git-path', name]));
}

/** Shallow when git says so, or when the `shallow` file exists (git before 2.15 has no --is-shallow-repository). */
function shallowError(root: string): SdlcError | undefined {
  const flagged = requiredGit(root, ['rev-parse', '--is-shallow-repository']) === 'true';
  if (!flagged && !fs.existsSync(gitPath(root, 'shallow'))) return undefined;
  return new SdlcError('shallow_history', { key: 'error.shallow_history' }, { key: 'fix.shallow_history' });
}

function graftsError(root: string): SdlcError | undefined {
  const grafts = gitPath(root, 'info/grafts');
  if (!fs.existsSync(grafts)) return undefined;
  const params = { path: grafts };
  return new SdlcError('rewritten_history', { key: 'error.rewritten_history', params }, {
    key: 'fix.rewritten_history',
    params,
  });
}

/** B114: why the history cannot be trusted (shallow clone, grafts), in that order; empty when it can be. */
export function historyErrors(root: string): SdlcError[] {
  const errors = [shallowError(root), graftsError(root)];
  return errors.filter((error): error is SdlcError => error !== undefined);
}