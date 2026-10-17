import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { parseDocument, stringify } from 'yaml';
import { CONFIG_HEADER, parseConfig, type SdlcConfig } from './config.js';
import { parseRolesFile } from './roles.js';
import { SdlcError } from './errors.js';
import { writeTextAtomic } from './fs-utils.js';

export type ConfigTarget = 'sdlc' | 'roles';
export type ProposalStatus = 'open' | 'applied' | 'dismissed';
export interface ConfigProposal {
  id: string;
  target: ConfigTarget;
  reason: string;
  by: string;
  agent?: string;
  when: string;
  baseDigest: string;
  content: string;
  status: ProposalStatus;
  note?: string;
  integrity?: string;
}

const MAX_SIZE = 1024 * 1024;
const STORE = 'openspec/.sdlc/config-proposals';

export function targetFile(root: string, target: ConfigTarget): string {
  return path.join(root, 'openspec', target === 'sdlc' ? 'sdlc.yaml' : 'roles.yaml');
}

export function digest(text: string): string {
  return `sha256:${createHash('sha256').update(text).digest('hex')}`;
}

export function validateContent(text: string, target: ConfigTarget): void {
  if (Buffer.byteLength(text) > MAX_SIZE) {
    throw new SdlcError('invalid_config', { key: 'config.error.fileTooLarge' });
  }
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length || /(?:^|\s)[&*][A-Za-z0-9_-]+/.test(text)) {
    throw new SdlcError('invalid_config', { key: 'config.error.yaml' });
  }
  const value = document.toJS();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SdlcError('invalid_config', { key: 'config.error.mapping' });
  }
  const keys = target === 'roles'
    ? ['version', 'signing', 'people', 'roles', 'separation']
    : ['version', 'schema', 'cli', 'statusline', 'stages', 'project', 'mcp', 'events', 'issues',
      'team', 'packs', 'board', 'context', 'tools', 'delivery', 'gates', 'roles', 'verify',
      'review', 'release', 'enforcement', 'license', 'log', 'rework', 'health', 'questions',
      'design', 'locale', 'layout'];
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) {
      throw new SdlcError('invalid_config', { key: 'config.error.unknownKey', params: { key } });
    }
  }
  validateKnownFields(value as Record<string, unknown>, target);
  try {
    if (target === 'roles') parseRolesFile(text);
    else parseConfig(value as Record<string, unknown>);
  } catch (error) {
    // The CLI parsers raise localized diagnostics that name the key; keep them for the person.
    if (error instanceof SdlcError) throw error;
    throw new SdlcError('invalid_config', { key: 'config.error.invalidContent' });
  }
}

function checkFields(value: unknown, allowed: string[], where: string): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new SdlcError('invalid_config', {
        key: 'config.error.unknownKey', params: { key: `${where}.${key}` },
      });
    }
  }
}

function validateKnownFields(raw: Record<string, unknown>, target: ConfigTarget): void {
  if (target === 'roles') {
    const people = raw.people && typeof raw.people === 'object' && !Array.isArray(raw.people)
      ? raw.people as Record<string, unknown> : {};
    for (const [id, person] of Object.entries(people)) {
      checkFields(person, ['name', 'emails', 'handles', 'signing_key', 'chat'], `people.${id}`);
    }
    checkFields(raw.separation, ['author_cannot_approve', 'distinct_approvers', 'max_gates_per_person'],
      'separation');
    return;
  }
  const fields: Record<string, string[]> = {
    project: ['name'], context: ['sources'], mcp: ['serve', 'servers'],
    verify: ['commands', 'mcp', 'timeout_seconds', 'output_lines', 'require_behaviour'],
    review: ['policy', 'base', 'block_on', 'passes', 'lenses', 'require_lens_coverage'],
    release: ['commands', 'mcp'],
    enforcement: ['mode', 'require_approved_plan', 'exempt_paths', 'protected_paths', 'secret_allow',
      'test_paths', 'forbid_agent_approvals', 'session_context', 'verify_before_stop'],
    license: ['type', 'agreement', 'licensee'], log: ['enabled', 'hook_decisions'],
    rework: ['reasons', 'max_cycles'],
  };
  for (const [key, allowed] of Object.entries(fields)) checkFields(raw[key], allowed, key);
  const gates = raw.gates && typeof raw.gates === 'object' && !Array.isArray(raw.gates)
    ? raw.gates as Record<string, unknown> : {};
  for (const [id, gate] of Object.entries(gates)) {
    const allowed = id === 'verify' ? ['required', 'auto_waive']
      : ['required', 'approvers', 'high_risk_approvers', 'artifacts', 'min_approvals',
        'overdue_hours', 'auto_waive', 'judge'];
    checkFields(gate, allowed, `gates.${id}`);
  }
}

export function proposedContent(current: string, sets: string[], file: string | undefined): string {
  const base = file ? fs.readFileSync(file, 'utf8') : current;
  if (!sets.length) return base;
  const document = parseDocument(base, { uniqueKeys: true });
  for (const setting of sets) {
    const separator = setting.indexOf('=');
    if (separator < 1) {
      throw new SdlcError('invalid_config', { key: 'config.error.invalidSet', params: { setting } });
    }
    const key = setting.slice(0, separator);
    const value = parseDocument(setting.slice(separator + 1), { uniqueKeys: true });
    if (value.errors.length || !key.split('.').every((part) => /^[\w-]+$/.test(part))) {
      throw new SdlcError('invalid_config', { key: 'config.error.invalidSet', params: { setting } });
    }
    document.setIn(key.split('.'), value.toJS());
  }
  return document.toString({ lineWidth: 0 });
}

export function preserveHeader(current: string, proposed: string, target: ConfigTarget): string {
  const header = current.match(/^(?:#[^\n]*\n)+/)?.[0] ?? (target === 'sdlc' ? CONFIG_HEADER : '');
  return proposed.startsWith(header) ? proposed : `${header}${proposed}`;
}

function proposalPath(root: string, id: string): string {
  if (!/^C[1-9]\d*$/.test(id)) {
    throw new SdlcError('invalid_proposal', { key: 'config.error.invalidId', params: { id } },
      { key: 'config.fix.unknownId' });
  }
  return path.join(root, STORE, `${id}.yaml`);
}

export function readProposal(root: string, id: string): ConfigProposal {
  const file = proposalPath(root, id);
  if (!fs.existsSync(file)) {
    throw new SdlcError('proposal_not_found', { key: 'config.error.notFound', params: { id } },
      { key: 'config.fix.unknownId' });
  }
  const text = fs.readFileSync(file, 'utf8');
  if (Buffer.byteLength(text) > MAX_SIZE * 2) {
    throw new SdlcError('invalid_proposal', { key: 'config.error.proposalTooLarge' },
      { key: 'config.fix.invalidProposal' });
  }
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length) {
    throw new SdlcError('invalid_proposal', { key: 'config.error.invalidProposal', params: { id } },
      { key: 'config.fix.invalidProposal' });
  }
  const p = document.toJS() as Partial<ConfigProposal>;
  const allowed = ['id', 'target', 'reason', 'by', 'agent', 'when', 'baseDigest', 'content', 'status',
    'note', 'integrity'];
  const valid = p && p.id === id && (p.target === 'sdlc' || p.target === 'roles')
    && typeof p.reason === 'string' && !!p.reason.trim() && typeof p.by === 'string'
    && typeof p.when === 'string' && typeof p.baseDigest === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(p.baseDigest) && typeof p.content === 'string'
    && ['open', 'applied', 'dismissed'].includes(p.status ?? '');
  const { integrity, ...body } = p;
  if (!valid || Object.keys(p).some((key) => !allowed.includes(key))
    || integrity !== digest(JSON.stringify(body))) {
    throw new SdlcError('invalid_proposal', { key: 'config.error.invalidProposal', params: { id } },
      { key: 'config.fix.invalidProposal' });
  }
  try {
    validateContent(p.content!, p.target!);
  } catch {
    throw new SdlcError('invalid_proposal', { key: 'config.error.invalidProposalContent', params: { id } },
      { key: 'config.fix.invalidProposal' });
  }
  return p as ConfigProposal;
}

export function writeProposal(root: string, proposal: ConfigProposal, create = false): void {
  const file = proposalPath(root, proposal.id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const { integrity: _old, ...body } = proposal;
  const text = stringify({ ...body, integrity: digest(JSON.stringify(body)) }, { lineWidth: 0 });
  if (create) fs.writeFileSync(file, text, { encoding: 'utf8', flag: 'wx' });
  else writeTextAtomic(file, text);
}

export function listProposals(root: string): ConfigProposal[] {
  const directory = path.join(root, STORE);
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => /^C[1-9]\d*\.yaml$/.test(name))
    .map((name) => readProposal(root, name.slice(0, -5)))
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
}

export function nextProposalId(root: string): string {
  const ids = listProposals(root).map((p) => Number(p.id.slice(1)));
  return `C${Math.max(0, ...ids) + 1}`;
}

export function weakeningWarnings(before: SdlcConfig, after: SdlcConfig): string[] {
  const warnings: string[] = [];
  const rank = { off: 0, warn: 1, block: 2 };
  if (rank[after.enforcement.mode] < rank[before.enforcement.mode]) warnings.push('enforcement mode is lower');
  for (const [name, gate] of Object.entries(before.gates)) {
    const changed = after.gates[name as keyof SdlcConfig['gates']];
    if (gate.required && !changed.required) warnings.push(`${name} gate is no longer required`);
    if ('autoWaive' in changed && changed.autoWaive?.tracks?.includes('lite')) {
      warnings.push(`${name} gate auto_waive includes lite`);
    }
    if ('minApprovals' in gate && 'minApprovals' in changed
      && (changed.minApprovals ?? 1) < (gate.minApprovals ?? 1)) {
      warnings.push(`${name} min_approvals is lower`);
    }
  }
  for (const command of before.verify.commands) {
    if (!after.verify.commands.some((item) => item.name === command.name && item.run === command.run)) {
      warnings.push(`verify command removed: ${command.name}`);
    }
  }
  for (const field of ['protectedPaths', 'testPaths'] as const) {
    for (const item of before.enforcement[field]) {
      if (!after.enforcement[field].includes(item)) warnings.push(`${field} removed: ${item}`);
    }
  }
  return warnings;
}

export function unifiedDiff(before: string, after: string): string {
  const oldLines = before.split('\n');
  const newLines = after.split('\n');
  let prefix = 0;
  while (prefix < oldLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
    && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) suffix++;
  return [
    '--- current', '+++ proposed',
    `@@ -${prefix + 1},${oldLines.length - prefix - suffix} +${prefix + 1},${newLines.length - prefix - suffix} @@`,
    ...oldLines.slice(prefix, oldLines.length - suffix).map((line) => `-${escapeLine(line)}`),
    ...newLines.slice(prefix, newLines.length - suffix).map((line) => `+${escapeLine(line)}`),
  ].join('\n');
}

function escapeLine(line: string): string {
  return line.replace(/[\x00-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
