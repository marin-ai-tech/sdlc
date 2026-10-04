/**
 * Roles and the people who hold them: `openspec/roles.yaml`, versioned in git
 * (protect it with CODEOWNERS / branch protection), so that one person cannot
 * push through someone else's work.
 *
 *   version: 1
 *   signing: off            # off | warn | required — see `sdlc approvals verify`
 *   people:
 *     alice: { name: Alice Ivanova, emails: [alice@corp.example], signing_key: "ssh-ed25519 AAAA… alice@corp" }
 *     bob:   { name: Bob Petrov,    emails: [bob@corp.example] }
 *   roles:
 *     product-owner: [alice]
 *     code-owner: [bob]
 *     maintainer: [alice]           # may approve changes to roles.yaml itself
 *   separation:
 *     author_cannot_approve: [review, release]
 *     distinct_approvers: [[spec, review], [plan, review]]
 *     max_gates_per_person: 3
 *
 * Without the file, 0.5.0 behaviour holds: `roles:` in sdlc.yaml, no separation.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from 'yaml';
import type { ChangeState } from './change-state.js';
import { APPROVAL_GATES, type ApprovalGateId } from './config.js';
import { SdlcError } from './errors.js';
import { git, defaultBaseRef } from './git.js';
import { t, type MessageParams, type MessageRef } from './i18n.js';

export const ROLES_PATH = 'openspec/roles.yaml';
export const SIGNING_MODES = ['off', 'warn', 'required'] as const;
export type SigningMode = (typeof SIGNING_MODES)[number];

export interface Person {
  /** Key in `people` (e.g. `alice`). */
  id: string;
  name: string;
  /** Lower-cased. */
  emails: string[];
  /** An `ssh-…` public key (or a GPG key id) used to sign approval commits. */
  signingKey?: string;
}

export interface SeparationRules {
  authorCannotApprove: ApprovalGateId[];
  distinctApprovers: ApprovalGateId[][];
  /** 0 = no limit. */
  maxGatesPerPerson: number;
}

export interface RolesFile {
  signing: SigningMode;
  people: Person[];
  /** role → person ids. */
  roles: Record<string, string[]>;
  separation: SeparationRules;
}

/** Defaults written by `sdlc roles init` / `migrate`. */
export const DEFAULT_SEPARATION: SeparationRules = {
  authorCannotApprove: ['review', 'release'],
  distinctApprovers: [['spec', 'review'], ['plan', 'review']],
  maxGatesPerPerson: 3,
};

/** Why a person may or may not act on a gate of a change. */
export interface ApprovalCheck {
  allowed: boolean;
  person?: Person;
  /** Rule ids that refuse approval; `message` is English (JSON), `ref` renders it in the current locale. */
  refusals: Refusal[];
}

export interface Refusal {
  rule: string;
  message: string;
  ref: MessageRef;
}

/** A refusal whose English message comes from the same catalog key as its localized text. */
function refusal(rule: string, params: MessageParams): Refusal {
  const ref = { key: `roles.refusal.${rule}`, params };
  return { rule, message: t(ref.key, params, 'en'), ref };
}

export interface ApprovalContext {
  gate: ApprovalGateId;
  /** Roles the gate accepts (from sdlc.yaml gates.*.approvers, high-risk extras included). */
  roles: string[];
  /** Email of the person acting (git identity). */
  email: string;
  /** Emails of the authors (and Co-authored-by) of the change's code commits. */
  authors: string[];
  /** Existing approvals in this change: gate → approver emails. */
  approvals: Partial<Record<ApprovalGateId, string[]>>;
}

function invalid(file: string, field: string, detail: string): never {
  throw new SdlcError('invalid_roles', { key: 'error.x_x_x_2', params: { file: file, field: field, detail: detail } });
}

function mapping(value: unknown, file: string, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(file, field, 'must be a mapping');
  return value as Record<string, unknown>;
}

function strings(value: unknown, file: string, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    invalid(file, field, 'must be a list of nonempty strings');
  }
  return value as string[];
}

function gates(value: unknown, file: string, field: string): ApprovalGateId[] {
  return strings(value, file, field).map((gate) => {
    if (!(APPROVAL_GATES as readonly string[]).includes(gate)) invalid(file, field, `unknown gate ${gate}`);
    return gate as ApprovalGateId;
  });
}

/** Parses roles.yaml text at the boundary (`invalid_roles` with the field on error). */
export function parseRolesFile(text: string, file = ROLES_PATH): RolesFile {
  let parsed: unknown;
  try {
    parsed = parse(text);
  } catch (error) {
    invalid(file, 'yaml', String(error));
  }
  const raw = mapping(parsed, file, 'root');
  if (raw.version !== 1) invalid(file, 'version', 'must be 1');
  if (!SIGNING_MODES.includes(raw.signing as SigningMode)) invalid(file, 'signing', 'must be off, warn or required');
  return { signing: raw.signing as SigningMode, people: parsePeople(raw.people, file),
    roles: parseRoles(raw.roles, raw.people, file), separation: parseSeparation(raw.separation, file) };
}

function parsePeople(value: unknown, file: string): Person[] {
  const peopleRaw = mapping(value, file, 'people');
  const seen = new Set<string>();
  const people = Object.entries(peopleRaw).map(([id, value]) => {
    const item = mapping(value, file, `people.${id}`);
    if (typeof item.name !== 'string' || !item.name.trim()) invalid(file, `people.${id}.name`, 'required');
    const emails = strings(item.emails, file, `people.${id}.emails`).map((email) => email.toLowerCase());
    if (!emails.length) invalid(file, `people.${id}.emails`, 'required');
    for (const email of emails) {
      if (seen.has(email)) invalid(file, `people.${id}.emails`, `duplicate email ${email}`);
      seen.add(email);
    }
    if (item.signing_key !== undefined && typeof item.signing_key !== 'string') {
      invalid(file, `people.${id}.signing_key`, 'must be a string');
    }
    return { id, name: item.name as string, emails,
      ...(item.signing_key ? { signingKey: item.signing_key as string } : {}) };
  });
  return people;
}

function parseRoles(value: unknown, people: unknown, file: string): Record<string, string[]> {
  const peopleRaw = mapping(people, file, 'people');
  const rolesRaw = mapping(value, file, 'roles');
  const roles: Record<string, string[]> = {};
  for (const [role, value] of Object.entries(rolesRaw)) {
    roles[role] = strings(value, file, `roles.${role}`);
    for (const id of roles[role]) {
      if (!(id in peopleRaw)) invalid(file, `roles.${role}`, `unknown person ${id}`);
    }
  }
  return roles;
}

function parseSeparation(value: unknown, file: string): SeparationRules {
  const separation = value === undefined ? {} : mapping(value, file, 'separation');
  const authorCannotApprove = separation.author_cannot_approve === undefined
    ? DEFAULT_SEPARATION.authorCannotApprove
    : gates(separation.author_cannot_approve, file, 'separation.author_cannot_approve');
  const pairs = separation.distinct_approvers === undefined
    ? DEFAULT_SEPARATION.distinctApprovers : separation.distinct_approvers;
  if (!Array.isArray(pairs)) invalid(file, 'separation.distinct_approvers', 'must be pairs of gates');
  const distinctApprovers = pairs.map((pair, index) => {
    const result = gates(pair, file, `separation.distinct_approvers.${index}`);
    if (result.length !== 2) invalid(file, `separation.distinct_approvers.${index}`, 'must contain two gates');
    return result;
  });
  const max = separation.max_gates_per_person ?? DEFAULT_SEPARATION.maxGatesPerPerson;
  if (!Number.isInteger(max) || (max as number) < 0) {
    invalid(file, 'separation.max_gates_per_person', 'must be nonnegative');
  }
  return { authorCannotApprove, distinctApprovers, maxGatesPerPerson: max as number };
}

export function approvalEmails(state: ChangeState | undefined): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const [gate, value] of Object.entries(state?.gates ?? {})) {
    result[gate] = (value.approvals ?? []).map((approval) => /<([^>]+)>/.exec(approval.by)?.[1] ?? approval.by);
  }
  return result;
}

/** Reads `openspec/roles.yaml` under root; undefined when the file does not exist. */
export function readRolesFile(root: string): RolesFile | undefined {
  const file = path.join(root, ROLES_PATH);
  return fs.existsSync(file) ? parseRolesFile(fs.readFileSync(file, 'utf8'), file) : undefined;
}

/** The person owning an email (case-insensitive), if any. */
export function personByEmail(roles: RolesFile, email: string): Person | undefined {
  return roles.people.find((person) => person.emails.includes(email.toLowerCase()));
}

/** Applies the role and separation rules to one approval attempt. Pure. */
export function checkApproval(roles: RolesFile, ctx: ApprovalContext): ApprovalCheck {
  const person = personByEmail(roles, ctx.email);
  const refusals: Refusal[] = [];
  if (!person) {
    return { allowed: false, refusals: [refusal('unknown_person', { email: ctx.email })] };
  }
  const holders = ctx.roles.flatMap((role) => roles.roles[role] ?? []);
  if (!holders.includes(person.id)) refusals.push(missingRole(roles, ctx, person, holders));
  if (roles.separation.authorCannotApprove.includes(ctx.gate) && owns(person, ctx.authors)) {
    refusals.push(refusal('author_cannot_approve', { name: person.name }));
  }
  for (const pair of roles.separation.distinctApprovers) {
    if (pair.includes(ctx.gate) && pair.some((gate) => gate !== ctx.gate && owns(person, ctx.approvals[gate] ?? []))) {
      refusals.push(refusal('distinct_approvers', { name: person.name, pair: pair.join('/') }));
    }
  }
  const count = Object.entries(ctx.approvals)
    .filter(([gate, emails]) => gate !== ctx.gate && owns(person, emails ?? [])).length;
  if (roles.separation.maxGatesPerPerson > 0 && count >= roles.separation.maxGatesPerPerson) {
    refusals.push(refusal('max_gates_per_person', { name: person.name }));
  }
  return { allowed: refusals.length === 0, person, refusals };
}

function owns(person: Person, emails: string[]): boolean {
  return emails.some((email) => person.emails.includes(email.toLowerCase()));
}

function missingRole(roles: RolesFile, ctx: ApprovalContext, person: Person, holders: string[]) {
  const names = [...new Set(holders)].map((id) => roles.people.find((candidate) => candidate.id === id)?.name ?? id);
  // `roles` reads "a or b" in English; other languages use `roleList` with their own wording.
  return refusal('missing_role', {
    name: person.name, roles: ctx.roles.join(' or '), roleList: ctx.roles.join(', '), holders: names.join(', '),
  });
}

/**
 * Authors of the change's code: authors and `Co-authored-by` trailers of the
 * commits between the merge base with `base` and HEAD that touch files outside
 * `openspec/` (lower-cased emails, unique).
 */
export function changeAuthors(root: string, base: string | undefined): string[] {
  const ref = base ?? defaultBaseRef(root);
  if (!ref) return [];
  const merge = git(root, ['merge-base', ref, 'HEAD']);
  if (!merge.ok) return [];
  const log = git(root, [
    'log', '--format=%H%x1f%ae%x1f%B%x1e', `${merge.stdout}..HEAD`, '--', '.', ':(exclude)openspec/**',
  ]);
  if (!log.ok) return [];
  const emails = new Set<string>();
  for (const record of log.stdout.split('\x1e')) {
    const [sha, author, body = ''] = record.trim().split('\x1f');
    if (!sha || !author) continue;
    emails.add(author.toLowerCase());
    for (const match of body.matchAll(/^Co-authored-by:.*<([^>]+)>/gim)) emails.add(match[1].toLowerCase());
  }
  return [...emails];
}

/** git `allowed_signers` lines built from people with an ssh signing key. */
export function allowedSigners(roles: RolesFile): string {
  return roles.people.flatMap((person) => person.signingKey?.startsWith('ssh-')
    ? person.emails.map((email) => `${email} ${person.signingKey}`) : []).join('\n') + '\n';
}
