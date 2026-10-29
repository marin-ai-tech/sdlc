import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { BIN, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F6 (close-the-digest-integrity-review-findings): a malformed approval entry is kept in `.sdlc.yaml` but never
 * counts, so a person must be told it is there. `sdlc doctor` warns (a warning, never an error) about each malformed
 * entry in an active change, naming the change, the gate and the entry's position in that gate's list.
 * The position may be counted from 0 or from 1, but the same way for every entry.
 */

interface Check {
  check: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
}

const VALID = { role: 'product-owner', by: 'Pat Owner <pat@example.com>', at: '2026-10-27T00:00:00.000Z',
  digest: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' };

function project() {
  const root = tempDir('sdlc-doctor-approvals-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const run = (args: string[]) => {
    const r = spawnSync(process.execPath, [BIN, ...args], { cwd: root, env, encoding: 'utf-8', timeout: 60000 });
    return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  };
  expect(run(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(run(['new', 'keep-entries', '--json']).code).toBe(0);
  const stateFile = path.join(root, 'openspec', 'changes', 'keep-entries', '.sdlc.yaml');
  const setGates = (gates: Record<string, unknown>) => {
    const raw = parse(read(stateFile));
    write(stateFile, stringify({ ...raw, gates: { ...(raw.gates ?? {}), ...gates } }));
  };
  const doctor = () => {
    const r = run(['doctor', '--json']);
    return { code: r.code, out: r.out, json: JSON.parse(r.stdout) as { healthy: boolean; checks: Check[] } };
  };
  return { setGates, doctor };
}

/** The check name and message together: either may carry the change, the gate or the position. */
function text(check: Check): string {
  return `${check.check} ${check.message}`;
}

/** The warnings that name the change and the gate. */
function warningsFor(checks: Check[], gate: string): string[] {
  return checks.filter((c) => c.status === 'warn' && text(c).includes('keep-entries') && text(c).includes(gate))
    .map(text);
}

function mentions(line: string, position: number): boolean {
  return new RegExp(`(^|\\D)${position}(\\D|$)`).test(line.replace('keep-entries', ''));
}

describe('F6: sdlc doctor warns about kept malformed approvals', () => {
  it('warns about a malformed approval with change, gate and position', () => {
    const p = project();
    p.setGates({
      intent: { approvals: [VALID, { ...VALID, by: 'Mallory', note: ['not', 'a', 'string'] }] },
      plan: { approvals: [{ ...VALID, role: 'engineer', at: 42 }, { ...VALID, role: 'engineer' }] },
    });
    const r = p.doctor();
    const intent = warningsFor(r.json.checks, 'intent');
    const plan = warningsFor(r.json.checks, 'plan');
    expect(intent, JSON.stringify(r.json.checks, null, 1)).toHaveLength(1);
    expect(plan, JSON.stringify(r.json.checks, null, 1)).toHaveLength(1);
    // Stored indexes: intent 1, plan 0. Counted from 0 or from 1, consistently.
    const fromZero = mentions(intent[0], 1) && mentions(plan[0], 0);
    const fromOne = mentions(intent[0], 2) && mentions(plan[0], 1);
    expect(fromZero || fromOne, `${intent[0]}\n${plan[0]}`).toBe(true);
    // Negative: the valid entries are not reported, and the warning is never an error.
    expect(r.json.checks.filter((c) => c.status === 'error' && text(c).includes('keep-entries'))).toEqual([]);
  }, 120000);

  it('exits 0 when that warning is the only finding', () => {
    const p = project();
    p.setGates({ intent: { approvals: [{ ...VALID, by: 'Mallory', note: ['not', 'a', 'string'] }] } });
    const r = p.doctor();
    expect(r.code, r.out).toBe(0);
    expect(r.json.healthy).toBe(true);
    expect(r.json.checks.filter((c) => c.status === 'error')).toEqual([]);
  }, 120000);

  it('gives no such warning without malformed entries', () => {
    const p = project();
    p.setGates({ intent: { approvals: [VALID] }, plan: { approvals: [{ ...VALID, role: 'engineer' }] } });
    const r = p.doctor();
    expect(r.code, r.out).toBe(0);
    expect(r.json.checks.filter((c) => c.status === 'warn' && text(c).includes('keep-entries'))).toEqual([]);
  }, 120000);
});
