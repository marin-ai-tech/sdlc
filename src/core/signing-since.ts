import { SdlcError } from './errors.js';
import { trustedGit } from './history-trust.js';

/** Resolve one commit reference without allowing it to become a git option or a revision range. */
export function resolveSigningSince(root: string, reference: string): string {
  const result = trustedGit(root, ['rev-parse', '--verify', '--end-of-options', `${reference}^{commit}`]);
  if (result.ok && /^[a-f0-9]{40,64}$/.test(result.stdout)) return result.stdout;
  throw new SdlcError('invalid_roles', {
    key: 'error.x_x_x_2',
    params: { file: 'openspec/roles.yaml', field: 'signing_since', detail: 'must resolve to a commit' },
  });
}

export function isPreSigningCommit(root: string, commit: string, cutoff: string): boolean {
  return trustedGit(root, ['merge-base', '--is-ancestor', commit, cutoff]).ok;
}
