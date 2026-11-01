import * as path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { approveCommand } from '../src/commands/gates.js';
import { defaultConfig } from '../src/core/config.js';
import { newChangeState } from '../src/core/change-state.js';
import { decisionProject } from './e20-decision-fixture.js';
import { preloadCli, waiveFixtureGates } from './audit-decision-preload.js';
import { initGitRepo, read, tempDir } from './helpers.js';

const audit = vi.hoisted(() => ({ root: '', gate: 'spec', fail: 'rework', calls: [] as string[], approved: false }));
const DIGEST = `sha256:${'1'.repeat(64)}`;

function check(name: string): void {
  audit.calls.push(name);
  if (audit.fail === name) throw new Error(`refused:${name}`);
}

vi.mock('../src/cli/context.js', () => ({ loadProject: () => ({ root: audit.root, paths: {}, config: defaultConfig(),
  stamp: { tool: 'sdlc', version: '0.29.0', license: 'community' } }), recordChangeEvent: vi.fn() }));
vi.mock('../src/core/changes.js', () => ({ resolveChange: () => ({ id: 'demo', dir: audit.root }) }));
vi.mock('../src/core/agent-env.js', () => ({ agentEnvironment: () => undefined }));
vi.mock('../src/core/roles.js', async (original) => ({
  ...await original<typeof import('../src/core/roles.js')>(), readRolesFile: () => undefined,
}));
vi.mock('../src/core/change-state.js', async (original) => ({
  ...await original<typeof import('../src/core/change-state.js')>(),
  readChangeState: () => ({ ...newChangeState(), gates: audit.approved ? { [audit.gate]: { approvals: [{
    by: 'Pat Owner <pat@example.com>', role: audit.gate === 'spec' ? 'product-owner' : 'release-manager',
    at: '2026-10-29', digest: DIGEST,
  }] } } : {} }),
}));
vi.mock('../src/core/lifecycle.js', () => ({ evaluateChange: () => ({ tasks: {}, artifacts: [],
  gates: [{ id: audit.gate, digest: DIGEST, status: audit.approved ? 'approved' : 'pending', missingRoles: [] }] }) }));
vi.mock('../src/core/awaiting.js', () => ({ recordAwaiting: vi.fn() }));
vi.mock('../src/core/approval-hygiene.js', async (original) => ({
  ...await original<typeof import('../src/core/approval-hygiene.js')>(), assertChangedSinceRework: () => check('rework'),
}));
vi.mock('../src/core/answers.js', () => ({ assertQuestionsAnswered: () => check('questions') }));
vi.mock('../src/core/debate.js', () => ({ assertDebateRecorded: () => check('debate') }));
vi.mock('../src/core/judge-gate.js', () => ({ assertJudgeCleared: () => check('judge') }));
vi.mock('../src/core/validate-change.js', () => ({ validateOne: () => {
  check('validation');
  return { valid: true, issues: [] };
} }));
vi.mock('../src/mcp/release-checks.js', () => ({ approvalChecks: async () => { check('release'); return []; } }));
vi.mock('../src/core/checkpoint.js', () => ({ captureCheckpoint: () => undefined, recordCheckpoint: () => false }));
vi.mock('../src/core/stamp.js', () => ({ changeMarkdown: () => [], tryStampArtifacts: () => ({ stamped: [] }) }));
vi.mock('../src/cli/next-hint.js', () => ({ resolveNext: () => undefined, emitNextHint: vi.fn() }));
vi.mock('../src/cli/output.js', () => ({ c: {}, printJson: vi.fn(), line: vi.fn(), warn: vi.fn(),
  reportFailure: (error: unknown) => { throw error; } }));

describe('Retro approval steps audit A1/A2', () => {
  beforeEach(() => {
    audit.root = tempDir('sdlc-approval-order-audit-');
    initGitRepo(audit.root);
    audit.gate = 'spec';
    audit.approved = false;
    audit.calls = [];
  });

  it.each(['rework', 'questions', 'debate', 'judge', 'validation'])('A1 retains first refusal at %s', async (fail) => {
    audit.fail = fail;
    await expect(approveCommand('spec', { json: true })).rejects.toThrow(`refused:${fail}`);
    const order = ['rework', 'questions', 'debate', 'judge', 'validation'];
    expect(audit.calls).toEqual(order.slice(0, order.indexOf(fail) + 1));
  });

  it('A1 release checks follow all preceding ordinary artifact checks', async () => {
    audit.gate = 'release';
    audit.fail = 'release';
    await expect(approveCommand('release', { json: true })).rejects.toThrow('refused:release');
    expect(audit.calls).toEqual(['rework', 'questions', 'debate', 'judge', 'release']);
  });

  it('A2 already-approved returns before every later failing check', async () => {
    audit.approved = true;
    audit.fail = 'rework';
    await expect(approveCommand('spec', { json: true })).resolves.toBeUndefined();
    expect(audit.calls).toEqual([]);
  });
});

describe('Retro approval stamp audit A4', () => {
  it('actual CLI reports the successful stamp prefix and skipped remainder when a later artifact drifts', () => {
    const p = decisionProject();
    waiveFixtureGates(p, ['intent', 'spec']);
    const plan = path.join(p.dir, 'plan.md');
    const tasks = path.join(p.dir, 'tasks.md');
    const script = ['const original = fs.renameSync;', 'let edited = false;',
      'fs.renameSync = function(from, to) {', '  const result = original.apply(this, arguments);',
      `  if (!edited && String(to) === ${JSON.stringify(plan)}) {`, '    edited = true;',
      `    fs.appendFileSync(${JSON.stringify(tasks)}, '\\n- [ ] 1.3 Newly discovered task\\n');`,
      '  }', '  return result;', '};'].join('\n');
    const out = preloadCli(p, ['approve', 'plan', '--change', 'demo', '--json'], script);
    expect(out.code, out.stdout + out.stderr).toBe(0);
    expect(out.json().stamping).toMatchObject({ stamped: ['plan.md'], stampedCount: 1, skippedCount: 1 });
    expect(out.json().stamping.skipped[0]).toMatchObject({ file: 'tasks.md' });
    expect(out.json().stamping.skipped[0].reason).toMatch(/changed/i);
    expect(read(plan)).toContain('sdlc-provenance');
    expect(read(tasks)).not.toContain('sdlc-provenance');
  }, 120000);
});
