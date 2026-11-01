import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { decisionProject } from './e20-decision-fixture.js';
import { read, write } from './helpers.js';

function previous(p: ReturnType<typeof decisionProject>, independent: boolean): void {
  const state = parse(read(p.stateFile));
  const digest = p.gate().digest;
  const approval = (by: string, role: string) => ({ by, role, digest, at: '2026-10-29T00:00:00Z' });
  state.gates.intent = { approvals: [approval('Pat Owner <pat@example.com>', 'product-owner'),
    ...(independent ? [approval('Other Owner <other@example.com>', 'product-owner')] : [])] };
  write(p.stateFile, stringify(state));
}

describe('Replacement feedback', () => {
  it('names the replaced role and missing independent authority', () => {
    const p = decisionProject(true);
    previous(p, false);
    const out = p.cli(['approve', 'intent', '--change', 'demo', '--as', 'tech-lead']);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toMatch(/replac.*product-owner/i);
    expect(out.stdout).toMatch(/another person|independent/i);
    expect(p.gate().status).toBe('pending');
  }, 120000);

  it('reports completion when the other role already has an independent approval', () => {
    const p = decisionProject(true);
    previous(p, true);
    const out = p.cli(['approve', 'intent', '--change', 'demo', '--as', 'tech-lead', '--json']);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json()).toMatchObject({ status: 'approved', missingRoles: [], replacedRoles: ['product-owner'] });
    expect(out.json().remainingAuthority).toEqual({ roles: [], people: 0 });
    expect(p.gate().status).toBe('approved');
    const plain = p.cli(['gate', 'read', 'intent', '--change', 'demo']);
    expect(plain.stdout).not.toMatch(/another person|independent/i);
  }, 120000);
});
