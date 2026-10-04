import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadProject } from '../cli/context.js';
import { line, printJson, reportFailure } from '../cli/output.js';
import { readChangeState } from '../core/change-state.js';
import { listActiveChanges, listArchivedChanges } from '../core/changes.js';
import { SdlcError } from '../core/errors.js';
import { git } from '../core/git.js';
import {
  allowedSigners, parseRolesFile, personByEmail, readRolesFile, ROLES_PATH,
  SIGNING_MODES, type RolesFile, type SigningMode,
} from '../core/roles.js';
import { t } from '../core/i18n.js';

type Status = 'valid' | 'unsigned' | 'wrong-signer' | 'bad-signature' | 'not-committed' | 'not-maintainer';
interface Result { status: Status; commit?: string; signer?: string }

function signature(root: string, sha: string, signers: string): { status: Status; signer?: string } {
  const result = git(root, ['-c', `gpg.ssh.allowedSignersFile=${signers}`, 'log', '-1', '--format=%G?%x1f%GS', sha]);
  const [code, principal] = result.stdout.split('\x1f');
  if (!result.ok || !code) return { status: 'bad-signature' };
  if (code === 'N') return { status: 'unsigned' };
  if (!['G', 'U'].includes(code) || !principal) return { status: 'bad-signature' };
  return { status: 'valid', signer: principal.trim() };
}

function approvalResult(
  root: string, roles: RolesFile, signers: string, file: string,
  change: string, gate: string, record: { at: string; by: string; person?: string; role: string },
) {
  const base = { change, gate, role: record.role, by: record.by, person: record.person };
  const history = git(root, ['log', '--reverse', '--format=%H', `-S${record.at}`, '--',
    'openspec/changes']);
  const sha = history.ok ? history.stdout.split('\n')[0] : '';
  const committed = git(root, ['show', `HEAD:${file}`]);
  if (!sha || !committed.ok || !committed.stdout.includes(record.at)) {
    return { ...base, commit: sha || undefined, signer: undefined, status: 'not-committed' as Status };
  }
  const checked = signature(root, sha, signers);
  if (checked.status !== 'valid') return { ...base, commit: sha, ...checked };
  const signer = personByEmail(roles, checked.signer!);
  const approver = record.person
    ? roles.people.find((person) => person.id === record.person)
    : personByEmail(roles, /<([^>]+)>/.exec(record.by)?.[1] ?? record.by);
  const status: Status = !signer ? 'bad-signature' : signer.id === approver?.id ? 'valid' : 'wrong-signer';
  return { ...base, commit: sha, signer: checked.signer, status };
}

function rolesResults(root: string, roles: RolesFile, signers: string) {
  const history = git(root, ['log', '--format=%H', '--', ROLES_PATH]);
  if (!history.ok || !history.stdout) return [];
  return history.stdout.split('\n').map((sha) => {
    const author = git(root, ['show', '-s', '--format=%ae', sha]).stdout;
    const parent = git(root, ['rev-parse', `${sha}^`]);
    const old = parent.ok
      ? git(root, ['show', `${parent.stdout}:${ROLES_PATH}`])
      : git(root, ['show', `${sha}:${ROLES_PATH}`]);
    const prior = old.ok ? parseRolesFile(old.stdout) : roles;
    fs.writeFileSync(signers, allowedSigners(prior), 'utf8');
    const checked = signature(root, sha, signers);
    const signer = checked.signer ? personByEmail(prior, checked.signer) : undefined;
    const status: Status = checked.status !== 'valid' ? checked.status
      : !signer ? 'bad-signature'
        : prior.roles.maintainer?.includes(signer.id) ? 'valid' : 'not-maintainer';
    return { file: ROLES_PATH, commit: sha, by: author, signer: checked.signer, status };
  });
}

function verify(root: string, roles: RolesFile, signers: string) {
  const ctx = loadProject();
  const results: Array<Record<string, unknown> & Result> = [];
  for (const ref of [...listActiveChanges(ctx.paths), ...listArchivedChanges(ctx.paths)]) {
    const file = path.relative(root, path.join(ref.dir, '.sdlc.yaml')).replaceAll('\\', '/');
    const state = readChangeState(ref.dir);
    for (const [gate, value] of Object.entries(state.gates)) {
      for (const record of value?.approvals ?? []) {
        results.push(approvalResult(root, roles, signers, file, ref.id, gate, record));
      }
    }
  }
  results.push(...rolesResults(root, roles, signers));
  return results;
}

function printResults(results: ReturnType<typeof verify>, mode: string): void {
  for (const result of results) {
    const subject = result.file ?? `${result.change}/${result.gate}`;
    const mark = result.status === 'valid' ? '✓' : '✗';
    const status = t(`approvals.status.${result.status}`);
    line(`${mark} ${subject} ${result.person ?? result.by} ${status} ${result.commit?.slice(0, 8) ?? '-'}`);
  }
  const approvals = results.filter((result) => result.change).length;
  const failures = results.filter((result) => result.status !== 'valid');
  const blocking = mode === 'warn' ? t('approvals.warnNotBlocking') : '';
  line(t('approvals.summary', { approvals, invalid: failures.length, blocking }));
  if (failures.length) line(t('approvals.signHint'));
}

export function approvalsVerify(opts: { mode?: string; json?: boolean }): void {
  try {
    const ctx = loadProject();
    const roles = readRolesFile(ctx.root);
    const mode = opts.mode ?? roles?.signing ?? 'off';
    if (!SIGNING_MODES.includes(mode as SigningMode)) {
      throw new SdlcError('invalid_mode', { key: 'error.unknown_signing_mode_x', params: { mode: mode } });
    }
    if (mode === 'off' || !roles) {
      if (opts.json) printJson({ mode, ok: true, results: [] });
      else line(t('approvals.off'));
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdlc-signers-'));
    const signers = path.join(dir, 'allowed_signers');
    let results: ReturnType<typeof verify>;
    try {
      fs.writeFileSync(signers, allowedSigners(roles), 'utf8');
      results = verify(ctx.root, roles, signers);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    const ok = results.every((result) => result.status === 'valid');
    if (opts.json) printJson({ mode, ok, results });
    else printResults(results, mode);
    if (mode === 'required' && !ok) process.exitCode = 1;
  } catch (error) {
    reportFailure(error, opts.json);
  }
}
