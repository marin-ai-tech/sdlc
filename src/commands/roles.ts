import * as fs from 'node:fs';
import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { readChangeState } from '../core/change-state.js';
import { resolveChange } from '../core/changes.js';
import { APPROVAL_GATES, type ApprovalGateId } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import {
  approvalEmails, changeAuthors, checkApproval, DEFAULT_SEPARATION, readRolesFile, ROLES_PATH,
} from '../core/roles.js';
import { defaultBaseRef } from '../core/git.js';
import { readYamlObject, writeYaml } from '../core/yaml-io.js';

interface Options { change?: string; base?: string; json?: boolean }

function matrix(gate: ApprovalGateId, opts: Options) {
  const ctx = loadProject();
  const roles = readRolesFile(ctx.root);
  if (!roles) {
    throw new SdlcError('missing_roles', `${ROLES_PATH} does not exist.`);
  }
  const ref = opts.change ? resolveChange(ctx.paths, opts.change) : undefined;
  const state = ref ? readChangeState(ref.dir) : undefined;
  const accepted = [...ctx.config.gates[gate].approvers, ...ctx.config.gates[gate].highRiskApprovers];
  const approvals = approvalEmails(state);
  const authors = ref ? changeAuthors(ctx.root, opts.base ?? ctx.config.review.base ?? defaultBaseRef(ctx.root)) : [];
  const allowed = [];
  const refused = [];
  for (const person of roles.people) {
    const check = checkApproval(roles, { gate, roles: accepted, email: person.emails[0], authors, approvals });
    if (check.allowed) {
      allowed.push(person);
    } else {
      refused.push({ person: person.id, name: person.name, rules: check.refusals.map((item) => item.rule),
        messages: check.refusals.map((item) => item.message) });
    }
  }
  return { gate, ...(ref ? { change: ref.id } : {}), roles: accepted, allowed, refused };
}

function textMatrix(result: ReturnType<typeof matrix>): void {
  line(`${result.gate}${result.change ? ` · ${result.change}` : ''} — may approve: ${result.allowed
    .map((person) => `${person.name} (${person.id})`).join(', ') || 'no one'}`);
  for (const item of result.refused) {
    line(`  ${item.name} (${item.person}): ${item.rules.map((rule, index) =>
      `${rule} — ${item.messages[index]}`).join('; ')}`);
  }
}

function peopleTable(): void {
  const ctx = loadProject();
  const roles = readRolesFile(ctx.root);
  if (!roles) {
    throw new SdlcError('missing_roles', `${ROLES_PATH} does not exist.`);
  }
  const rows = roles.people.map((person) => {
    const held = Object.entries(roles.roles).filter(([, ids]) => ids.includes(person.id)).map(([role]) => role);
    return [person.id, person.name, held.join(', ')];
  });
  const idWidth = Math.max(2, ...rows.map((row) => row[0].length));
  const nameWidth = Math.max(4, ...rows.map((row) => row[1].length));
  for (const [id, name, held] of [['ID', 'Name', 'Roles'], ...rows]) {
    line(`${id.padEnd(idWidth)}  ${name.padEnd(nameWidth)}  ${held}`);
  }
}

export function rolesWho(gate: string, opts: Options): void {
  try {
    if (!(APPROVAL_GATES as readonly string[]).includes(gate)) {
      throw new SdlcError('invalid_gate', `Unknown gate ${gate}.`);
    }
    const { roles: _roles, ...result } = matrix(gate as ApprovalGateId, opts);
    if (opts.json) {
      printJson(result);
    } else {
      textMatrix(matrix(gate as ApprovalGateId, opts));
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function rolesCheck(opts: Options): void {
  try {
    const gates = APPROVAL_GATES.map((gate) => matrix(gate, opts));
    if (opts.json) {
      printJson({ gates });
    } else if (!opts.change) {
      peopleTable();
    } else {
      gates.forEach(textMatrix);
    }
  } catch (error) {
    reportFailure(error, opts.json);
  }
}

export function rolesMigrate(opts: Options): void {
  try {
    if (agentEnvironment()) throw new SdlcError('agent_cannot_edit_roles', 'Only a person may migrate roles.');
    const ctx = loadProject();
    const file = path.join(ctx.root, ROLES_PATH);
    if (fs.existsSync(file)) throw new SdlcError('roles_exist', `${ROLES_PATH} already exists.`);
    const source = readYamlObject(path.join(ctx.root, 'openspec/sdlc.yaml')) ?? {};
    const sourceRoles = source.roles as Record<string, string[]> | undefined ?? {};
    const people: Record<string, { name: string; emails: string[] }> = {};
    const roles: Record<string, string[]> = {};
    for (const [role, emails] of Object.entries(sourceRoles)) {
      roles[role] = emails.map((email) => {
        const id = email.split('@')[0];
        if (people[id] && !people[id].emails.includes(email)) {
          throw new SdlcError('invalid_roles', `Email local part ${id} is duplicated.`);
        }
        people[id] = { name: email, emails: [email] };
        return id;
      });
    }
    writeYaml(file, { version: 1, signing: 'off', people, roles,
      separation: { author_cannot_approve: DEFAULT_SEPARATION.authorCannotApprove,
        distinct_approvers: DEFAULT_SEPARATION.distinctApprovers,
        max_gates_per_person: DEFAULT_SEPARATION.maxGatesPerPerson } });
    if (opts.json) printJson({ file: ROLES_PATH, people: Object.keys(people).length });
    else line(`Created ${ROLES_PATH}.`);
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
