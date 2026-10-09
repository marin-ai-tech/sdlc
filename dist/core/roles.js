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
import { APPROVAL_GATES } from './config.js';
import { SdlcError } from './errors.js';
import { git, defaultBaseRef } from './git.js';
import { t } from './i18n.js';
export const ROLES_PATH = 'openspec/roles.yaml';
export const SIGNING_MODES = ['off', 'warn', 'required'];
/** Defaults written by `sdlc roles init` / `migrate`. */
export const DEFAULT_SEPARATION = {
    authorCannotApprove: ['review', 'release'],
    distinctApprovers: [['spec', 'review'], ['plan', 'review']],
    maxGatesPerPerson: 3,
};
/** A refusal whose English message comes from the same catalog key as its localized text. */
function refusal(rule, params) {
    const ref = { key: `roles.refusal.${rule}`, params };
    return { rule, message: t(ref.key, params, 'en'), ref };
}
function invalid(file, field, detail) {
    throw new SdlcError('invalid_roles', { key: 'error.x_x_x_2', params: { file: file, field: field, detail: detail } });
}
function mapping(value, file, field) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        invalid(file, field, 'must be a mapping');
    return value;
}
function strings(value, file, field) {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
        invalid(file, field, 'must be a list of nonempty strings');
    }
    return value;
}
function gates(value, file, field) {
    return strings(value, file, field).map((gate) => {
        if (!APPROVAL_GATES.includes(gate))
            invalid(file, field, `unknown gate ${gate}`);
        return gate;
    });
}
/** Parses roles.yaml text at the boundary (`invalid_roles` with the field on error). */
export function parseRolesFile(text, file = ROLES_PATH) {
    let parsed;
    try {
        parsed = parse(text);
    }
    catch (error) {
        invalid(file, 'yaml', String(error));
    }
    const raw = mapping(parsed, file, 'root');
    if (raw.version !== 1)
        invalid(file, 'version', 'must be 1');
    if (!SIGNING_MODES.includes(raw.signing))
        invalid(file, 'signing', 'must be off, warn or required');
    return { signing: raw.signing, people: parsePeople(raw.people, file),
        roles: parseRoles(raw.roles, raw.people, file), separation: parseSeparation(raw.separation, file) };
}
function parsePeople(value, file) {
    const peopleRaw = mapping(value, file, 'people');
    const seen = new Set();
    const people = Object.entries(peopleRaw).map(([id, value]) => {
        const item = mapping(value, file, `people.${id}`);
        if (typeof item.name !== 'string' || !item.name.trim())
            invalid(file, `people.${id}.name`, 'required');
        const emails = strings(item.emails, file, `people.${id}.emails`).map((email) => email.toLowerCase());
        if (!emails.length)
            invalid(file, `people.${id}.emails`, 'required');
        for (const email of emails) {
            if (seen.has(email))
                invalid(file, `people.${id}.emails`, `duplicate email ${email}`);
            seen.add(email);
        }
        if (item.signing_key !== undefined && typeof item.signing_key !== 'string') {
            invalid(file, `people.${id}.signing_key`, 'must be a string');
        }
        return { id, name: item.name, emails,
            ...(item.signing_key ? { signingKey: item.signing_key } : {}) };
    });
    return people;
}
function parseRoles(value, people, file) {
    const peopleRaw = mapping(people, file, 'people');
    const rolesRaw = mapping(value, file, 'roles');
    const roles = {};
    for (const [role, value] of Object.entries(rolesRaw)) {
        roles[role] = strings(value, file, `roles.${role}`);
        for (const id of roles[role]) {
            if (!(id in peopleRaw))
                invalid(file, `roles.${role}`, `unknown person ${id}`);
        }
    }
    return roles;
}
function parseSeparation(value, file) {
    const separation = value === undefined ? {} : mapping(value, file, 'separation');
    const authorCannotApprove = separation.author_cannot_approve === undefined
        ? DEFAULT_SEPARATION.authorCannotApprove
        : gates(separation.author_cannot_approve, file, 'separation.author_cannot_approve');
    const pairs = separation.distinct_approvers === undefined
        ? DEFAULT_SEPARATION.distinctApprovers : separation.distinct_approvers;
    if (!Array.isArray(pairs))
        invalid(file, 'separation.distinct_approvers', 'must be pairs of gates');
    const distinctApprovers = pairs.map((pair, index) => {
        const result = gates(pair, file, `separation.distinct_approvers.${index}`);
        if (result.length !== 2)
            invalid(file, `separation.distinct_approvers.${index}`, 'must contain two gates');
        return result;
    });
    const max = separation.max_gates_per_person ?? DEFAULT_SEPARATION.maxGatesPerPerson;
    if (!Number.isInteger(max) || max < 0) {
        invalid(file, 'separation.max_gates_per_person', 'must be nonnegative');
    }
    return { authorCannotApprove, distinctApprovers, maxGatesPerPerson: max };
}
export function approvalEmails(state) {
    const result = {};
    for (const [gate, value] of Object.entries(state?.gates ?? {})) {
        result[gate] = (value.approvals ?? []).map((approval) => /<([^>]+)>/.exec(approval.by)?.[1] ?? approval.by);
    }
    return result;
}
/** Reads `openspec/roles.yaml` under root; undefined when the file does not exist. */
export function readRolesFile(root) {
    const file = path.join(root, ROLES_PATH);
    return fs.existsSync(file) ? parseRolesFile(fs.readFileSync(file, 'utf8'), file) : undefined;
}
/** The person owning an email (case-insensitive), if any. */
export function personByEmail(roles, email) {
    return roles.people.find((person) => person.emails.includes(email.toLowerCase()));
}
/** Applies the role and separation rules to one approval attempt. Pure. */
export function checkApproval(roles, ctx) {
    const person = personByEmail(roles, ctx.email);
    const refusals = [];
    if (!person) {
        return { allowed: false, refusals: [refusal('unknown_person', { email: ctx.email })] };
    }
    const holders = ctx.roles.flatMap((role) => roles.roles[role] ?? []);
    if (!holders.includes(person.id))
        refusals.push(missingRole(roles, ctx, person, holders));
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
function owns(person, emails) {
    return emails.some((email) => person.emails.includes(email.toLowerCase()));
}
function missingRole(roles, ctx, person, holders) {
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
export function changeAuthors(root, base) {
    const ref = base ?? defaultBaseRef(root);
    if (!ref)
        return [];
    const merge = git(root, ['merge-base', ref, 'HEAD']);
    if (!merge.ok)
        return [];
    const log = git(root, [
        'log', '--format=%H%x1f%ae%x1f%B%x1e', `${merge.stdout}..HEAD`, '--', '.', ':(exclude)openspec/**',
    ]);
    if (!log.ok)
        return [];
    const emails = new Set();
    for (const record of log.stdout.split('\x1e')) {
        const [sha, author, body = ''] = record.trim().split('\x1f');
        if (!sha || !author)
            continue;
        emails.add(author.toLowerCase());
        for (const match of body.matchAll(/^Co-authored-by:.*<([^>]+)>/gim))
            emails.add(match[1].toLowerCase());
    }
    return [...emails];
}
/** git `allowed_signers` lines built from people with an ssh signing key. */
export function allowedSigners(roles) {
    return roles.people.flatMap((person) => person.signingKey?.startsWith('ssh-')
        ? person.emails.map((email) => `${email} ${person.signingKey}`) : []).join('\n') + '\n';
}
