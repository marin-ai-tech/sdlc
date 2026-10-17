import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { approvalTrailer } from './approval-hygiene.js';
import { readChangeState, type ApprovalRecord } from './change-state.js';
import { listActiveChanges, listArchivedChanges, type ChangeRef } from './changes.js';
import { requiredGit, trustedGit } from './history-trust.js';
import type { ProjectPaths } from './project.js';
import { allowedSigners, parseRolesFile, personByEmail, ROLES_PATH, type RolesFile } from './roles.js';
import { isPreSigningCommit } from './signing-since.js';

/**
 * Signature checks of approvals and of roles.yaml commits (`sdlc approvals verify`, B21 evidence export). An approval
 * is valid when the commit that first recorded it is signed by the person who approved; roles.yaml commits must be
 * signed by a maintainer of the previous roles file once signing keys exist.
 */
export type SignatureStatus =
  | 'valid' | 'unsigned' | 'wrong-signer' | 'bad-signature' | 'not-committed' | 'not-maintainer'
  | 'pre-signing' | 'bootstrap' | 'bootstrap-conflict' | 'merge';

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

function approvalFile(root: string, ref: ChangeRef, beforeArchive = false): string {
  const dir = beforeArchive ? path.join(path.dirname(path.dirname(ref.dir)), ref.id) : ref.dir;
  return path.relative(root, path.join(dir, '.sdlc.yaml')).replaceAll('\\', '/');
}

function commitSignature(root: string, sha: string, signers: string): { status: SignatureStatus; signer?: string } {
  const args = ['-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '-1', '--format=%G?%x1f%GS', sha];
  const result = trustedGit(root, args);
  const [code, principal] = result.stdout.split('\x1f');
  if (!result.ok || !code) return { status: 'bad-signature' };
  if (code === 'N') return { status: 'unsigned' };
  if (!['G', 'U'].includes(code) || !principal) return { status: 'bad-signature' };
  return { status: 'valid', signer: principal.trim() };
}

/** Writes `content` as an allowed-signers file into a temporary folder, runs `work`, then removes the folder. */
export function withSignersFile<T>(content: string, work: (signers: string) => T): T {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-signers-'));
  const signers = path.join(dir, 'allowed_signers');
  try {
    fs.writeFileSync(signers, content, 'utf8');
    return work(signers);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Writes the allowed-signers file of `roles` into a temporary folder, runs `work`, then removes the folder. */
export function withAllowedSigners<T>(roles: RolesFile, work: (signers: string) => T): T {
  return withSignersFile(allowedSigners(roles), work);
}

/** Every approval of the given changes, in change, gate and record order. */
export function approvalSites(root: string, refs: ChangeRef[]): ApprovalSite[] {
  const sites: ApprovalSite[] = [];
  for (const ref of refs) {
    const file = approvalFile(root, ref);
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
export function approvalSignature(root: string, roles: RolesFile, signers: string, site: ApprovalSite,
  signingSince?: string): SignatureCheck {
  const { file, record } = site;
  const history = trustedGit(root, ['log', '--reverse', '--format=%H', `-S${record.at}`, '--', 'openspec/changes']);
  const sha = history.ok ? history.stdout.split('\n')[0] : '';
  const committed = trustedGit(root, ['show', `HEAD:${file}`]);
  const fallback = site.ref.archived && !committed.ok
    ? trustedGit(root, ['show', `HEAD:${approvalFile(root, site.ref, true)}`])
    : undefined;
  const inHead = committed.ok
    ? committed.stdout.includes(record.at)
    : fallback?.ok === true && fallback.stdout.includes(record.at);
  if (!sha || !inHead) {
    return { status: 'not-committed', commit: sha || undefined, signer: undefined };
  }
  if (signingSince && isPreSigningCommit(root, sha, signingSince)) {
    return { status: 'pre-signing', commit: sha };
  }
  const checked = commitSignature(root, sha, signers);
  if (checked.status !== 'valid') return { commit: sha, ...checked };
  const signer = personByEmail(roles, checked.signer!);
  const approver = approverOf(roles, record);
  const status: SignatureStatus = !signer ? 'bad-signature' : signer.id === approver?.id ? 'valid' : 'wrong-signer';
  return { commit: sha, signer: checked.signer, status };
}

function hasSigningKeys(roles: RolesFile | undefined): boolean {
  return roles?.people.some((person) => Boolean(person.signingKey)) ?? false;
}

/** Parents of `sha` in order (none for a root commit). A failed call is an error, not "no parents". */
function commitParents(root: string, sha: string): string[] {
  const ancestry = requiredGit(root, ['rev-list', '--parents', '-n', '1', sha]);
  return ancestry.split(' ').slice(1);
}

/** The blob id of roles.yaml at `rev`, or undefined when the file is absent there. A failed call is an error. */
function rolesBlob(root: string, rev: string): string | undefined {
  const entry = requiredGit(root, ['ls-tree', '--full-tree', rev, '--', ROLES_PATH]);
  const [type, oid] = entry.split('\t')[0].split(' ').slice(1);
  return type === 'blob' ? oid : undefined;
}

function rolesAt(root: string, rev: string): RolesFile | undefined {
  const blob = rolesBlob(root, rev);
  return blob ? parseRolesFile(requiredGit(root, ['cat-file', 'blob', blob])) : undefined;
}

function previousRoles(root: string, sha: string): RolesFile | undefined {
  const [parent] = commitParents(root, sha);
  return parent ? rolesAt(root, parent) : undefined;
}

function mergeParents(root: string, sha: string): string[] | undefined {
  const parents = commitParents(root, sha);
  return parents.length < 2 ? undefined : parents;
}

/** B114: whether every merge base of `a` and `b` has a roles.yaml with signing keys (one git call). */
function mergeBasesHaveKeys(root: string, a: string, b: string): boolean {
  const bases = trustedGit(root, ['merge-base', '--all', a, b]);
  if (!bases.ok || !bases.stdout) return false;
  const shas = bases.stdout.split('\n');
  return shas.every((base) => hasSigningKeys(rolesAt(root, base)));
}

/** First parent that has signing keys, in parent order (first parent preferred). */
function parentWithKeys(root: string, parents: string[]): string | undefined {
  return parents.find((parent) => hasSigningKeys(rolesAt(root, parent)));
}

/**
 * B114: keeping parent P's roles.yaml is `merge` only if every other parent Q that has keys shares merge bases that
 * also have keys. A keyless Q constrains nothing. Independent of whether P is first or later.
 */
function keptParentPasses(root: string, parents: string[], kept: string): boolean {
  for (const other of parents) {
    if (other === kept) continue;
    if (!hasSigningKeys(rolesAt(root, other))) continue;
    if (!mergeBasesHaveKeys(root, kept, other)) return false;
  }
  return true;
}

function mergeStatus(root: string, sha: string): 'merge' | 'skip' | undefined {
  const parents = mergeParents(root, sha);
  if (!parents) return undefined;
  const ownBlob = rolesBlob(root, sha);
  const parentBlobs = parents.map((parent) => rolesBlob(root, parent));
  if (!ownBlob && parentBlobs.every((blob) => !blob)) return 'skip';
  const keptIndex = parentBlobs.findIndex((blob) => blob === ownBlob);
  if (keptIndex < 0) return undefined;
  return keptParentPasses(root, parents, parents[keptIndex]) ? 'merge' : undefined;
}

/**
 * Prior roles for a normal check: for merges, the first parent that has keys (else undefined, so own keys or
 * bootstrap); for non-merges, the first parent's roles.yaml.
 */
function priorRoles(root: string, sha: string): RolesFile | undefined {
  const parents = mergeParents(root, sha);
  if (parents) {
    const keyed = parentWithKeys(root, parents);
    return keyed ? rolesAt(root, keyed) : undefined;
  }
  return previousRoles(root, sha);
}

function rolesCommitResult(root: string, signers: string, sha: string) {
  const merge = mergeStatus(root, sha);
  if (merge === 'skip') return undefined;
  const author = requiredGit(root, ['show', '-s', '--format=%ae', sha]);
  if (merge === 'merge') {
    return { file: ROLES_PATH, commit: sha, by: author, signer: undefined, status: merge };
  }
  const current = rolesAt(root, sha);
  const prior = priorRoles(root, sha);
  const hadKeys = hasSigningKeys(prior);
  const roles = hadKeys ? prior! : current;
  if (!roles || (!hadKeys && !hasSigningKeys(current))) {
    return { file: ROLES_PATH, commit: sha, by: author, signer: undefined, status: 'pre-signing' as const };
  }
  fs.writeFileSync(signers, allowedSigners(roles), 'utf8');
  const checked = commitSignature(root, sha, signers);
  const signer = checked.signer ? personByEmail(roles, checked.signer) : undefined;
  const status: SignatureStatus = checked.status !== 'valid' ? checked.status
    : !signer ? 'bad-signature'
      : roles.roles.maintainer?.includes(signer.id) ? (hadKeys ? 'valid' : 'bootstrap') : 'not-maintainer';
  return { file: ROLES_PATH, commit: sha, by: author, signer: checked.signer, status };
}

/** Whether the repository has a commit at all: with none there is no history to check (an unborn HEAD). */
function hasCommits(root: string): boolean {
  if (trustedGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']).ok) return true;
  return requiredGit(root, ['rev-list', '-n', '1', '--all']) !== '';
}

/** Commits that touched roles.yaml (its deletion included), newest first. A failed git log is an error. */
function rolesHistory(root: string): string[] {
  if (!hasCommits(root)) return [];
  const history = requiredGit(root, ['log', '--full-history', '--format=%H', '--', ROLES_PATH]);
  return history ? history.split('\n') : [];
}

/** B114: whether roles.yaml has a history, even when it is deleted at HEAD. */
export function hasRolesHistory(root: string): boolean {
  return rolesHistory(root).length > 0;
}

/**
 * Checks each roles.yaml commit against the prior keys, or its own keys when first introduced. Rewrites `signers`.
 * Fails closed: a git call the check depends on that fails throws `history_unreadable`.
 */
export function rolesSignatures(root: string, signers: string) {
  const results = rolesHistory(root).flatMap((sha) => {
    const result = rolesCommitResult(root, signers, sha);
    return result ? [result] : [];
  });
  if (results.filter((result) => result.status === 'bootstrap').length > 1) {
    for (const result of results) {
      if (result.status === 'bootstrap') result.status = 'bootstrap-conflict';
    }
  }
  return results;
}
