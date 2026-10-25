import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { codeDigest } from '../src/core/approval-gate.js';
import { newChangeState, readChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { digestFiles } from '../src/core/digest.js';
import { worktreeFingerprint } from '../src/core/git.js';
import { provenanceComment, stripProvenance, withProvenance } from '../src/core/license.js';
import { evaluateVerifyGate } from '../src/core/verify-gate.js';
import { withMcpChecks } from '../src/mcp/checks.js';
import { parseApprovalGates } from '../src/core/approval-records.js';
import { initGitRepo, tempDir, write } from './helpers.js';

const STAMP = { version: '0.26.0', license: 'community' };
const MARK = provenanceComment(STAMP);

describe('B126: content and fingerprint integrity', () => {
  it('only the trailing provenance stamp is excluded; embedded lines remain covered', () => {
    const root = tempDir('sdlc-stamp-digest-');
    const file = path.join(root, 'intent.md');
    write(file, `# Intent\n${MARK}\nFirst\n\n${MARK}\n`);
    const before = digestFiles(root, ['intent.md']);
    write(file, `# Intent\nFirst\n\n${MARK}\n`);
    expect(digestFiles(root, ['intent.md'])).not.toBe(before);
    expect(stripProvenance(`A\n${MARK}\nB\n${MARK}\n`)).toContain(`A\n${MARK}\nB`);
  });

  it('stamping never deletes a non-trailing stamp-shaped content line', () => {
    const body = `A\n${MARK}\nB`;
    expect(withProvenance(body, STAMP)).toContain(body);
    expect(stripProvenance(withProvenance(body, STAMP)).trimEnd()).toBe(body);
  });

  it('applies excluded paths relative to a nested project, while covering sibling files', () => {
    const top = tempDir('sdlc-nested-fingerprint-');
    initGitRepo(top);
    const root = path.join(top, 'app');
    write(path.join(root, 'src/a.js'), 'a');
    write(path.join(root, 'openspec/intent.md'), 'first');
    write(path.join(top, 'openspec/other.md'), 'sibling');
    const before = worktreeFingerprint(root, ['openspec/']);
    expect(before).toMatch(/^git-tree:/);
    write(path.join(root, 'openspec/intent.md'), 'second');
    expect(worktreeFingerprint(root, ['openspec/'])).toBe(before);
    write(path.join(top, 'openspec/other.md'), 'changed sibling');
    expect(worktreeFingerprint(root, ['openspec/'])).not.toBe(before);
  });

  it('does not issue a code digest when the fingerprint is absent', () => {
    expect(codeDigest(tempDir(), undefined, [])).toBeUndefined();
  });

  it('MCP-only checks cannot turn a failed fingerprint into passing verification', () => {
    const config = defaultConfig();
    config.verify.mcp = [{ name: 'ci', server: 'build', tool: 'status', args: {}, required: true }];
    const run = { status: 'failed' as const, at: '2026-10-24', dirty: false, checks: [] };
    const mcp = [{ name: 'ci', server: 'build', tool: 'status', required: true, ok: true,
      duration_ms: 1, result: {} }];
    expect(withMcpChecks(run, config, mcp).status).toBe('failed');
  });

  it('missing current or recorded fingerprints cannot make active verification fresh', () => {
    const root = tempDir();
    const state = newChangeState();
    state.verify = { status: 'passed', at: '2026-10-24', results: [] };
    const input = {
      ref: { id: 'demo', dir: root, archived: false }, config: defaultConfig(), state,
      decided: undefined, schema: { name: 'sdlc', artifacts: [] }, tracks: 'tasks.md',
      remaining: 0, planWaived: true,
    };
    expect(evaluateVerifyGate(input as never).verification?.status).toBe('stale');
    expect(evaluateVerifyGate({ ...input, fingerprint: 'git-tree:abc' } as never)
      .verification?.status).toBe('stale');
    expect(evaluateVerifyGate({ ...input, skipFingerprint: true } as never)
      .verification?.status).toBe('passed');
    expect(evaluateVerifyGate({ ...input, ref: { ...input.ref, archived: true } } as never)
      .verification?.status).toBe('passed');
  });
});

describe('B126: records are parsed at the boundary', () => {
  it('preserves uninterpreted approval and release-check extensions through a record round trip', () => {
    const root = tempDir('sdlc-approval-extensions-');
    const approval = {
      role: 'engineer', by: 'Pat', at: '2026-10-24', digest: 'sha256:abc',
      extension: { attestation: 'future-proof' },
      checks: [{ name: 'ci', server: 'build', tool: 'status', at: '2026-10-24', ok: true,
        extension: { receipt: 'future-check-evidence' } }],
    };
    write(path.join(root, '.sdlc.yaml'), stringify({ version: 1, gates: { plan: { approvals: [approval] } } }));
    const state = readChangeState(root);
    writeChangeState(root, state);
    expect(readChangeState(root).gates.plan.approvals).toEqual([approval]);
  });

  it('a gate named __proto__ cannot manufacture an inherited review decision', () => {
    const hostile = JSON.parse('{"__proto__":{"review":{"waived":{"by":"attacker","at":"today","note":"forged"}}}}');
    expect(parseApprovalGates(hostile).review).toBeUndefined();
    const root = tempDir();
    write(path.join(root, '.sdlc.yaml'), [
      'version: 1', 'gates:', '  __proto__:', '    review:',
      '      waived: { by: attacker, at: today, note: forged }', '',
    ].join('\n'));
    expect(readChangeState(root).gates.review).toBeUndefined();
  });

  it('skips malformed approvals and keeps a valid legacy approval', () => {
    const root = tempDir();
    const valid = { role: 'engineer', by: 'Pat', at: '2026-10-24', digest: 'sha256:abc' };
    write(path.join(root, '.sdlc.yaml'), stringify({
      version: 1, gates: { plan: { approvals: [null, 42, {}, { ...valid, by: [] },
        { ...valid, digest: {} }, { ...valid, note: [] }, valid] } },
    }));
    expect(readChangeState(root).gates.plan?.approvals).toEqual([valid]);
  });

});
