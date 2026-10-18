import * as fs from 'node:fs';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { agentEnvironment } from '../core/agent-env.js';
import { parseConfig } from '../core/config.js';
import { integrationEmptyWarnings } from '../core/config-integration-findings.js';
import { type ConfigProposal, type ConfigTarget, digest, listProposals, nextProposalId, preserveHeader, proposedContent,
  readProposal, targetFile, unifiedDiff, validateContent, weakeningWarnings, writeProposal } from
  '../core/config-proposals.js';
import { SdlcError } from '../core/errors.js';
import { writeTextAtomic } from '../core/fs-utils.js';
import { git } from '../core/git.js';
import { t, type MessageParams } from '../core/i18n.js';
import { appendLog } from '../core/log.js';
import { parseRolesFile, personByEmail, readRolesFile } from '../core/roles.js';
import { resolveSigningSince, isPreSigningCommit } from '../core/signing-since.js';
import { parse } from 'yaml';
import { allChanges } from '../core/approval-signatures.js';
import { exportApprovals } from '../core/evidence-export.js';
import { projectPaths } from '../core/project.js';

interface Options { json?: boolean; target?: string; set?: string[]; file?: string; reason?: string; yes?: boolean;
  note?: string }

function identity(root: string): { name: string; email: string } {
  const name = git(root, ['config', 'user.name']).stdout;
  const email = git(root, ['config', 'user.email']).stdout.toLowerCase();
  return { name: name || email || 'unknown', email };
}

function namedIdentity(root: string): string {
  const person = identity(root);
  return `${person.name} <${person.email}>`;
}

function validateProposalCommit(root: string, target: ConfigTarget, content: string): string | undefined {
  if (target !== 'roles') return undefined;
  const since = parseRolesFile(content).signingSince;
  if (since) resolveSigningSince(root, since);
  return since;
}

function target(value: string | undefined): ConfigTarget {
  if (!value || value === 'sdlc') return 'sdlc';
  if (value === 'roles') return 'roles';
  throw new SdlcError('invalid_config', { key: 'config.error.unknownTarget', params: { target: value } });
}

function assertPerson(action: string): void {
  if (agentEnvironment()) {
    throw new SdlcError('agent_cannot_approve',
      { key: 'config.error.agentAction', params: { action } },
      { key: 'config.fix.agentAction', params: { action } });
  }
}

function status(root: string, proposal: ConfigProposal): string {
  if (proposal.status !== 'open') return proposal.status;
  const current = fs.readFileSync(targetFile(root, proposal.target), 'utf8');
  return digest(current) === proposal.baseDigest ? 'open' : 'stale';
}

function safeText(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

function proposalValidation(proposal: ConfigProposal): { validation: string; validationReason?: string } {
  if (proposal.status !== 'open') return { validation: 'historical' };
  try {
    validateContent(proposal.content, proposal.target);
    return { validation: 'valid' };
  } catch (error) {
    const reason = error instanceof SdlcError ? error.localizedMessage() : String(error);
    return { validation: 'failed', validationReason: reason };
  }
}

function warnings(root: string, proposal: ConfigProposal): string[] {
  const current = fs.readFileSync(targetFile(root, proposal.target), 'utf8');
  if (proposal.target === 'roles') {
    const before = parseRolesFile(current);
    const after = parseRolesFile(proposal.content);
    const result: string[] = [];
    const rank = { off: 0, warn: 1, required: 2 };
    if (rank[after.signing] < rank[before.signing]) result.push('signing is lower');
    const beforeSince = before.signingSince ? resolveSigningSince(root, before.signingSince) : undefined;
    const afterSince = after.signingSince === before.signingSince
      ? beforeSince : after.signingSince ? resolveSigningSince(root, after.signingSince) : undefined;
    const movesCutoff = beforeSince && afterSince && afterSince !== beforeSince
      && isPreSigningCommit(root, beforeSince, afterSince);
    if (after.signingSince && (!before.signingSince || movesCutoff)) {
      result.push('signing_since is later or newly added');
    }
    if (before.signing === 'off' && after.signing !== 'off' && !after.signingSince) {
      const unsigned = exportApprovals(root, allChanges(projectPaths(root)), after)
        .filter((approval) => approval.signature === 'unsigned').length;
      if (unsigned) result.push(`${unsigned} approvals are unsigned and will fail sdlc approvals verify; `
        + 'set signing_since to keep them as pre-signing');
    }
    for (const [role, people] of Object.entries(before.roles)) {
      if (people.length && !(after.roles[role]?.length)) result.push(`${role} role is empty`);
    }
    return result;
  }
  const content = parse(proposal.content) as Record<string, unknown>;
  return [...weakeningWarnings(parseConfig(parse(current)), parseConfig(content)),
    ...integrationEmptyWarnings(content)];
}

function localizedWarning(warning: string): string {
  if (warning === 'enforcement mode is lower') return t('config.warning.enforcement');
  if (warning === 'signing is lower') return t('config.warning.signing');
  if (warning === 'signing_since is later or newly added') return t('config.warning.signingSince');
  const unsigned = /^(\d+) approvals are unsigned and will fail /.exec(warning);
  if (unsigned) return t('config.warning.unsignedHistory', { count: Number(unsigned[1]) });
  const patterns: Array<[RegExp, string, string]> = [
    [/^(.+) gate is no longer required$/, 'config.warning.gate', 'gate'],
    [/^(.+) gate auto_waive includes lite$/, 'config.warning.autoWaive', 'gate'],
    [/^(.+) min_approvals is lower$/, 'config.warning.approvals', 'gate'],
    [/^verify command removed: (.+)$/, 'config.warning.command', 'name'],
    [/^(protectedPaths|testPaths) removed: (.+)$/, 'config.warning.path', 'path'],
    [/^(.+) role is empty$/, 'config.warning.role', 'role'],
  ];
  for (const [pattern, key, field] of patterns) {
    const match = warning.match(pattern);
    if (match) {
      const params: MessageParams = { [field]: match[1] };
      if (key === 'config.warning.path') {
        params.path = match[2];
        params.field = match[1];
      }
      return t(key, params);
    }
  }
  return warning;
}

function isWeakening(warning: string): boolean {
  return !warning.includes('approvals are unsigned') && !warning.includes(' is empty;');
}

export function proposeConfig(opts: Options): void {
  try {
    const ctx = loadProject();
    const chosen = target(opts.target);
    if (!opts.reason?.trim() || (!opts.file && !opts.set?.length)) {
      throw new SdlcError('invalid_config', { key: 'config.error.proposeArgs' });
    }
    const current = fs.readFileSync(targetFile(ctx.root, chosen), 'utf8');
    const currentSince = validateProposalCommit(ctx.root, chosen, current);
    const raw = proposedContent(current, opts.set ?? [], opts.file);
    const content = preserveHeader(current, raw, chosen);
    validateContent(content, chosen);
    const proposedSince = chosen === 'roles' ? parseRolesFile(content).signingSince : undefined;
    if (proposedSince !== currentSince) validateProposalCommit(ctx.root, chosen, content);
    const proposal: ConfigProposal = {
      id: nextProposalId(ctx.root), target: chosen, reason: opts.reason.trim(),
      by: identity(ctx.root).name, ...(agentEnvironment() ? { agent: agentEnvironment() } : {}),
      when: new Date().toISOString(), baseDigest: digest(current), content, status: 'open',
      reviewedDiff: unifiedDiff(current, content),
    };
    writeProposal(ctx.root, proposal, true);
    appendLog(ctx.root, ctx.config, { event: 'config.proposed', by: namedIdentity(ctx.root),
      detail: proposal.id }, ctx.stamp);
    const others = listProposals(ctx.root).filter((item) => item.id !== proposal.id
      && item.target === chosen && item.status === 'open');
    const otherWarnings = others.map((other) => t('config.warning.openProposal', {
        id: other.id, file: chosen === 'roles' ? 'openspec/roles.yaml' : 'openspec/sdlc.yaml',
      }));
    if (opts.json) printJson({ id: proposal.id, warnings: otherWarnings });
    else {
      line(t('config.proposed', { id: proposal.id }));
      for (const warning of otherWarnings) line(t('config.warning', { warning }));
    }
  } catch (error) { reportFailure(error, opts.json); }
}

export function showConfig(id: string | undefined, opts: Options): void {
  try {
    const ctx = loadProject();
    if (!id) {
      const proposals = listProposals(ctx.root).map((proposal) => ({
        id: proposal.id, target: proposal.target, status: status(ctx.root, proposal),
        reason: proposal.reason, by: proposal.by,
      }));
      if (opts.json) printJson({ proposals });
      else for (const proposal of proposals) {
        line(t('config.listItem', { id: proposal.id, target: proposal.target,
          status: { key: `config.status.${proposal.status}` },
          reason: safeText(proposal.reason), by: safeText(proposal.by) }));
      }
      return;
    }
    const proposal = readProposal(ctx.root, id);
    const closed = proposal.status !== 'open';
    const validation = proposalValidation(proposal);
    const current = closed && proposal.reviewedDiff ? undefined
      : fs.readFileSync(targetFile(ctx.root, proposal.target), 'utf8');
    const diff = current === undefined ? proposal.reviewedDiff! : unifiedDiff(current, proposal.content);
    const alerts = validation.validation === 'valid' ? warnings(ctx.root, proposal) : [];
    const result = { id, status: status(ctx.root, proposal), reason: proposal.reason,
      by: proposal.by, diff, ...validation, warnings: alerts,
      weakens: alerts.some(isWeakening),
      ...(closed && !proposal.reviewedDiff ? { diffNote: t('config.legacyDiff') } : {}) };
    if (opts.json) printJson(result);
    else {
      line(t('config.showItem', { id, status: { key: `config.status.${result.status}` },
        reason: safeText(proposal.reason), by: safeText(proposal.by) }));
      line(diff.replace('--- current\n+++ proposed', t('config.diffHeader')));
      if (closed && !proposal.reviewedDiff) line(t('config.legacyDiff'));
      const validationText = t(`config.status.${validation.validation}`);
      const reason = validation.validationReason ? `: ${safeText(validation.validationReason)}` : '';
      line(t('config.validation', { validation: `${validationText}${reason}` }));
      for (const warning of alerts) line(t('config.warning', { warning: safeText(localizedWarning(warning)) }));
    }
  } catch (error) { reportFailure(error, opts.json); }
}

export function applyConfig(id: string, opts: Options): void {
  try {
    assertPerson('apply');
    const ctx = loadProject();
    const proposal = readProposal(ctx.root, id);
    if (proposal.status !== 'open') {
      throw new SdlcError('proposal_closed', { key: 'config.error.closed',
        params: { id, status: { key: `config.status.${proposal.status}` } } },
      { key: 'config.fix.closed' });
    }
    const file = targetFile(ctx.root, proposal.target);
    const current = fs.readFileSync(file, 'utf8');
    if (digest(current) !== proposal.baseDigest) {
      throw new SdlcError('stale_proposal', { key: 'config.error.stale', params: { id } },
        { key: 'config.fix.stale' });
    }
    validateContent(proposal.content, proposal.target);
    const alerts = warnings(ctx.root, proposal);
    if (alerts.some(isWeakening) && !opts.yes) {
      throw new SdlcError('weakening_requires_yes',
        { key: 'config.error.weakening', params: { id } },
        { key: 'config.fix.weakening' });
    }
    if (fs.existsSync(targetFile(ctx.root, 'roles'))) {
      const roles = readRolesFile(ctx.root)!;
      const person = personByEmail(roles, identity(ctx.root).email);
      if (!person || !roles.roles.maintainer?.includes(person.id)) {
        throw new SdlcError('maintainer_required', { key: 'config.error.maintainer' },
          { key: 'config.fix.maintainer' });
      }
    }
    proposal.reviewedDiff = unifiedDiff(current, proposal.content);
    writeTextAtomic(file, proposal.content);
    proposal.status = 'applied';
    writeProposal(ctx.root, proposal);
    appendLog(ctx.root, ctx.config, { event: 'config.applied', by: namedIdentity(ctx.root),
      detail: id }, ctx.stamp);
    const message = `Apply config proposal ${id}: ${proposal.reason}`;
    if (opts.json) printJson({ id, status: 'applied', suggested_commit: message });
    else line(t('config.applied', { id, message: t('config.commitMessage',
      { id, reason: safeText(proposal.reason) }) }));
  } catch (error) { reportFailure(error, opts.json); }
}

export function dismissConfig(id: string, opts: Options): void {
  try {
    assertPerson('dismiss');
    if (!opts.note?.trim()) throw new SdlcError('note_required', { key: 'config.error.noteRequired' });
    const ctx = loadProject();
    const proposal = readProposal(ctx.root, id);
    if (proposal.status !== 'open') {
      throw new SdlcError('proposal_closed', { key: 'config.error.closed',
        params: { id, status: { key: `config.status.${proposal.status}` } } },
      { key: 'config.fix.closed' });
    }
    const current = fs.readFileSync(targetFile(ctx.root, proposal.target), 'utf8');
    proposal.reviewedDiff = unifiedDiff(current, proposal.content);
    proposal.status = 'dismissed';
    proposal.note = opts.note.trim();
    writeProposal(ctx.root, proposal);
    appendLog(ctx.root, ctx.config, { event: 'config.dismissed', by: namedIdentity(ctx.root),
      detail: `${id}: ${proposal.note}` }, ctx.stamp);
    if (opts.json) printJson({ id, status: 'dismissed' });
    else line(t('config.dismissed', { id }));
  } catch (error) { reportFailure(error, opts.json); }
}
