/**
 * The people who may take a gate decision now. With `openspec/roles.yaml`, an approve-gate Next hint carries
 * `people`: the people `sdlc roles who <gate> --change <id>` lists as allowed (the same role and separation
 * rules), minus those who already gave a valid approval of the gate. Its text names them instead of the role.
 * Without roles.yaml the hint is unchanged.
 */
import type { ChangeState } from './change-state.js';
import type { ApprovalGateId, SdlcConfig } from './config.js';
import { t, type MessageRef } from './i18n.js';
import type { GateEvaluation, LifecycleView, NextAction } from './lifecycle.js';
import { approverEmail } from './approval-quorum.js';
import { approvalEmails, changeAuthors, checkApproval, readRolesFile, type Person, type RolesFile } from './roles.js';

export interface NamedApprover {
  id: string;
  name: string;
  /** The role of the gate this person approves in. */
  role: string;
}

/** Approve hints and their variants that name the people. */
const PEOPLE_KEYS: Record<string, string> = {
  'next.approve': 'next.approvePeople',
  'next.reapprove': 'next.reapprovePeople',
  'next.reviewApprove': 'next.reviewApprovePeople',
  'next.reviewReapprove': 'next.reviewReapprovePeople',
  'next.releaseApprove': 'next.releaseApprovePeople',
};

/** Adds `people` to an approve-gate hint and names them in its text. */
export function nameApprovers(root: string, config: SdlcConfig, view: LifecycleView, state: ChangeState,
  next: NextAction): NextAction {
  const key = next.key ? PEOPLE_KEYS[next.key] : undefined;
  const gate = view.gates.find((item) => item.id === next.gate);
  if (next.action !== 'approve-gate' || !key || !gate || gate.id === 'verify') return next;
  const roles = rolesOrNothing(root);
  if (!roles) return next;
  const people = allowedNow(root, config, roles, gate, state);
  if (people.length === 0) return { ...next, people };
  const params = { ...next.params, people: peopleText(people, gate.missingRoles.length > 1 ? 'and' : 'or') };
  return { ...next, people, key, params, message: t(key, params, 'en') };
}

/**
 * The people who may decide the change's open approval gate now, whatever the next step is (the dashboard page of
 * a change names them while an artifact is being revised too). Undefined without roles.yaml or an open approval gate.
 */
export function openGateDeciders(root: string, config: SdlcConfig, view: LifecycleView,
  state: ChangeState): { gate: string; people: NamedApprover[] } | undefined {
  const gate = view.gates.find((item) => !item.satisfied);
  if (view.archived || !gate || gate.id === 'verify') return undefined;
  const roles = rolesOrNothing(root);
  if (!roles) return undefined;
  return { gate: gate.id, people: allowedNow(root, config, roles, gate, state) };
}

/**
 * roles.yaml, or undefined when it is absent or cannot be read: a broken file is reported by the commands that
 * decide (`sdlc approve`, `sdlc roles check`); the hint then names the role as before.
 */
function rolesOrNothing(root: string): RolesFile | undefined {
  try {
    return readRolesFile(root);
  } catch {
    return undefined;
  }
}

/** The inputs `sdlc roles who` uses: every accepted role, the change's code authors, all recorded approvals. */
function allowedNow(root: string, config: SdlcConfig, roles: RolesFile, gate: GateEvaluation,
  state: ChangeState): NamedApprover[] {
  const id = gate.id as ApprovalGateId;
  const accepted = [...config.gates[id].approvers, ...config.gates[id].highRiskApprovers];
  const authors = changeAuthors(root, config.review.base);
  const approvals = approvalEmails(state);
  const missing = gate.missingRoles.flatMap((entry) => entry.split(' | ')).filter((role) => accepted.includes(role));
  const wanted = missing.length > 0 ? missing : accepted;
  return roles.people
    .filter((person) => checkApproval(roles, { gate: id, roles: accepted, email: person.emails[0], authors,
      approvals }).allowed)
    .filter((person) => !approvedAlready(gate, person))
    .flatMap((person) => {
      const role = wanted.find((item) => roles.roles[item]?.includes(person.id));
      return role ? [{ id: person.id, name: person.name, role }] : [];
    });
}

function approvedAlready(gate: GateEvaluation, person: Person): boolean {
  return gate.approvals.some((record) => record.person === person.id
    || person.emails.includes(approverEmail(record.by)));
}

/** "Alice Ivanova or Carol Smirnova (product-owner)", rendered in the reader's locale. */
function peopleText(people: NamedApprover[], joiner: 'and' | 'or'): MessageRef[] {
  const roles = [...new Set(people.map((person) => person.role))];
  const groupKey = joiner === 'and' ? 'next.andPeopleGroup' : 'next.orPeopleGroup';
  return roles.map((role, index) => {
    const names: MessageRef[] = people.filter((person) => person.role === role).map((person, at) => ({
      key: at === 0 ? 'next.personName' : 'next.orPersonName', params: { name: person.name },
    }));
    return { key: index === 0 ? 'next.peopleGroup' : groupKey, params: { names, role } };
  });
}
