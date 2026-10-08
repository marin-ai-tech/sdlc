import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { approvalTrailer } from './approval-hygiene.js';
import { readChangeState, type ApprovalRecord } from './change-state.js';
import { listActiveChanges, listArchivedChanges, type ChangeRef } from './changes.js';
import { git } from './git.js';
import type { ProjectPaths } from './project.js';
import { allowedSigners, parseRolesFile, personByEmail, ROLES_PATH, type RolesFile } from './roles.js';

/**
 * Signature checks of approvals and of roles.yaml commits (`sdlc approvals verify`, B21 evidence export). An approval
 * is valid when the commit that first recorded it is signed by the person who approved; roles.yaml commits must be
 * signed by a maintainer of the previous roles file.
 */
export type SignatureStatus =
  | 'valid' | 'unsigned' | 'wrong-signer' | 'bad-signature' | 'not-committed' | 'not-maintainer';

export type TrailerStatus = 'found' | 'missing';

export interface SignatureCheck {
  status: SignatureStatus;
  commit?: string;
  signer?: string;
}

/** One approval found in a change record, with the record file relative to the project root. */
export interface ApprovalSite {
  ref: ChangeRef;
  file: string;
  gate: string;
  record: ApprovalRecord;
}

function commitSignature(root: string, sha: string, signers: string): { status: SignatureStatus; signer?: string } {
  const result = git(root, ['-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '-1', '--format=%G?%x1f%GS', sha]);
  const [code, principal] = result.stdout.split('\x1f');
  if (!result.ok || !code) return { status: 'bad-signature' };
  if (code === 'N') return { status: 'unsigned' };
  if (!['G', 'U'].includes(code) || !principal) return { status: 'bad-signature' };
  return { status: 'valid', signer: principal.trim() };
}

/** Writes the allowed-signers file of `roles` into a temporary folder, runs `work`, then removes the folder. */
export function withAllowedSigners<T>(roles: RolesFile, work: (signers: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-signers-'));
  const signers = path.join(dir, 'allowed_signers');
  try {
    fs.writeFileSync(signers, allowedSigners(roles), 'utf8');
    return work(signers);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Every approval of the given changes, in change, gate and record order. */
export function approvalSites(root: string, refs: ChangeRef[]): ApprovalSite[] {
  const sites: ApprovalSite[] = [];
  for (const ref of refs) {
    const file = path.relative(root, path.join(ref.dir, '.sdlc.yaml')).replaceAll('\\', '/');
    const state = readChangeState(ref.dir);
    for (const [gate, value] of Object.entries(state.gates)) {
      for (const record of value?.approvals ?? []) sites.push({ ref, file, gate, record });
    }
  }
  return sites;
}

/** Active changes first, then archived ones: the order `sdlc approvals verify` reports them in. */
export function allChanges(paths: ProjectPaths): ChangeRef[] {
  return [...listActiveChanges(paths), ...listArchivedChanges(paths)];
}

/** B60: whether the commit the approval proposed (its trailer) is reachable; informational only. */
export function trailerStatus(trailers: Set<string>, change: string, gate: string, digest?: string): TrailerStatus {
  const found = digest !== undefined && trailers.has(approvalTrailer(change, gate, digest));
  return found ? 'found' : 'missing';
}

function approverOf(roles: RolesFile, record: ApprovalRecord) {
  if (record.person) return roles.people.find((person) => person.id === record.person);
  const email = /<([^>]+)>/.exec(record.by)?.[1] ?? record.by;
  return personByEmail(roles, email);
}

/** The signature status of one approval: the first commit that recorded it must be signed by the approver. */
export function approvalSignature(root: string, roles: RolesFile, signers: string, site: ApprovalSite): SignatureCheck {
  const { file, record } = site;
  const history = git(root, ['log', '--reverse', '--format=%H', `-S${record.at}`, '--', 'openspec/changes']);
  const sha = history.ok ? history.stdout.split('\n')[0] : '';
  const committed = git(root, ['show', `HEAD:${file}`]);
  if (!sha || !committed.ok || !committed.stdout.includes(record.at)) {
    return { status: 'not-committed', commit: sha || undefined, signer: undefined };
  }
  const checked = commitSignature(root, sha, signers);
  if (checked.status !== 'valid') return { commit: sha, ...checked };
  const signer = personByEmail(roles, checked.signer!);
  const approver = approverOf(roles, record);
  const status: SignatureStatus = !signer ? 'bad-signature' : signer.id === approver?.id ? 'valid' : 'wrong-signer';
  return { commit: sha, signer: checked.signer, status };
}

function rolesCommitResult(root: string, roles: RolesFile, signers: string, sha: string) {
  const author = git(root, ['show', '-s', '--format=%ae', sha]).stdout;
  const parent = git(root, ['rev-parse', `${sha}^`]);
  const old = parent.ok
    ? git(root, ['show', `${parent.stdout}:${ROLES_PATH}`])
    : git(root, ['show', `${sha}:${ROLES_PATH}`]);
  const prior = old.ok ? parseRolesFile(old.stdout) : roles;
  fs.writeFileSync(signers, allowedSigners(prior), 'utf8');
  const checked = commitSignature(root, sha, signers);
  const signer = checked.signer ? personByEmail(prior, checked.signer) : undefined;
  const status: SignatureStatus = checked.status !== 'valid' ? checked.status
    : !signer ? 'bad-signature'
      : prior.roles.maintainer?.includes(signer.id) ? 'valid' : 'not-maintainer';
  return { file: ROLES_PATH, commit: sha, by: author, signer: checked.signer, status };
}

/** Every commit of roles.yaml must be signed by a maintainer of the roles file before it. Rewrites `signers`. */
export function rolesSignatures(root: string, roles: RolesFile, signers: string) {
  const history = git(root, ['log', '--format=%H', '--', ROLES_PATH]);
  if (!history.ok || !history.stdout) return [];
  return history.stdout.split('\n').map((sha) => rolesCommitResult(root, roles, signers, sha));
}
