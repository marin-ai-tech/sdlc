import { APPROVAL_GATES } from '../config.js';
import { readContextSources } from '../context-packs.js';
import { doctorChecks, type DoctorCheck } from '../doctor.js';
import type { MessageRef } from '../i18n.js';
import { readRolesFile, type RolesFile } from '../roles.js';
import type { HealthContext } from './context.js';
import type { FindingDraft, HealthLevel } from './model.js';

/** Configuration findings: checks, enforcement, roles, signing, context packs and the doctor's checks. */

/** config.no_verify: no `verify.commands` and no `verify.mcp`. */
export function noVerifyFinding(ctx: HealthContext): FindingDraft {
  const none = ctx.config.verify.commands.length === 0 && (ctx.config.verify.mcp?.length ?? 0) === 0;
  const facts: MessageRef[] = none ? [{ key: 'health.fact.noVerify' }] : [];
  return { id: 'config.no_verify', area: 'config', level: 'bad', facts };
}

/** config.enforcement: `enforcement.mode` off is bad, warn is a warning. */
export function enforcementFinding(ctx: HealthContext): FindingDraft {
  const mode = ctx.config.enforcement.mode;
  const level: HealthLevel = mode === 'off' ? 'bad' : 'warn';
  const facts: MessageRef[] = mode === 'block' ? [] : [{ key: 'health.fact.enforcement', params: { mode } }];
  return { id: 'config.enforcement', area: 'config', level, params: { mode }, facts };
}

/** Roles the required approval gates take approvals from. */
function gateRoles(ctx: HealthContext): string[] {
  const roles = new Set<string>();
  for (const id of APPROVAL_GATES) {
    const gate = ctx.config.gates[id];
    if (gate.required) gate.approvers.forEach((role) => roles.add(role));
  }
  return [...roles].sort();
}

function singleHolder(roles: RolesFile, used: string[]): string | undefined {
  const members = used.map((role) => roles.roles[role] ?? []);
  if (members.some((list) => list.length === 0)) return undefined;
  const people = new Set(members.flat());
  return people.size === 1 ? [...people][0] : undefined;
}

/** config.single_person: in roles.yaml one person holds every role the gates use. */
export function singlePersonFinding(ctx: HealthContext): FindingDraft {
  const roles = readRolesFile(ctx.root);
  const used = gateRoles(ctx);
  const holder = roles && used.length > 0 ? singleHolder(roles, used) : undefined;
  const person = holder ? roles?.people.find((entry) => entry.id === holder)?.name ?? holder : undefined;
  const params = { person: person ?? '-', roles: used.join(', ') };
  const facts: MessageRef[] = person ? [{ key: 'health.fact.singlePerson', params }] : [];
  return { id: 'config.single_person', area: 'config', level: 'warn', params, facts };
}

/** config.signing: roles.yaml has `signing: off`. */
export function signingFinding(ctx: HealthContext): FindingDraft {
  const roles = readRolesFile(ctx.root);
  const facts: MessageRef[] = roles?.signing === 'off' ? [{ key: 'health.fact.signing' }] : [];
  return { id: 'config.signing', area: 'config', level: 'info', facts };
}

/** config.context_stale: context packs past their freshness. */
export function contextStaleFinding(ctx: HealthContext): FindingDraft {
  const stale = readContextSources(ctx.root, new Date(ctx.now)).filter((source) => source.stale);
  const facts = stale.map((source) => ({
    key: 'health.fact.contextStale',
    params: { path: source.path, owner: source.owner, updated: source.updated, days: source.freshDays },
  }));
  return { id: 'config.context_stale', area: 'config', level: 'warn', facts };
}

/** The doctor's verify check is config.no_verify already. */
const COVERED = ['verify commands'];

function doctorFacts(checks: DoctorCheck[]): MessageRef[] {
  return checks.map((check) => ({
    key: 'health.fact.doctor',
    params: { check: check.check, message: check.message },
  }));
}

/** config.doctor: the `sdlc doctor` checks with an error (bad) or a warning (warn). */
export function doctorFinding(ctx: HealthContext): FindingDraft {
  const checks = doctorChecks({ root: ctx.root, locale: ctx.locale }).filter((c) => !COVERED.includes(c.check));
  const errors = checks.filter((check) => check.status === 'error');
  const warnings = checks.filter((check) => check.status === 'warn');
  const level: HealthLevel = errors.length > 0 ? 'bad' : 'warn';
  const facts = doctorFacts([...errors, ...warnings]);
  return { id: 'config.doctor', area: 'config', level, params: { errors: errors.length }, facts };
}
