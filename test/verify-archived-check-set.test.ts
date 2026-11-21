import { describe, expect, it } from 'vitest';
import { newChangeState, type VerifyRecord } from '../src/core/change-state.js';
import { defaultConfig, type SdlcConfig } from '../src/core/config.js';
import type { SchemaInfo } from '../src/core/openspec-schema.js';
import { evaluateVerifyGate } from '../src/core/verify-gate.js';
import { tempDir } from './helpers.js';

/**
 * B330 (B282 review F6). An archived change keeps the verify state it was archived with: its record is not judged
 * against the checks configured today. Found by the replay of `status --archived --json` on copies of real projects,
 * where 19 archived changes verified with `typecheck` and `npm test` read stale once sdlc.yaml listed other checks.
 * An active change is still judged against today's checks, as the B282 spec requires.
 */

const OLD = 'git-tree:5b83b3cb1485a42b7f62d22cad4616f6a0eafd6b';
const NOW = 'git-tree:2222222222222222222222222222222222222222';

function today(): SdlcConfig {
  const c = defaultConfig();
  c.verify.commands = [
    { name: 'typecheck', run: 'node scripts/sandbox/remote-test.mjs npm run typecheck', required: true },
    { name: 'test-1-of-4', run: 'node scripts/sandbox/remote-test.mjs node scripts/test-shards.mjs', required: true },
  ];
  return c;
}

function record(status: 'passed' | 'failed', exit = 0): VerifyRecord {
  return { status, at: '2026-10-21T06:43:34.840Z', fingerprint: OLD, results: [
    { name: 'typecheck', command: 'npm run typecheck', exit_code: 0, duration_ms: 1, required: true },
    { name: 'test', command: 'npm test', exit_code: exit, duration_ms: 1, required: true },
  ] };
}

function gate(verify: VerifyRecord, archived: boolean, skipFingerprint = false) {
  const state = { ...newChangeState(), verify };
  const schema = { apply: { requires: [], tracks: 'tasks.md' } } as unknown as SchemaInfo;
  return evaluateVerifyGate({ ref: { id: 'digest-check', dir: tempDir('sdlc-archived-'), archived }, config: today(),
    state, decided: undefined, fingerprint: NOW, skipFingerprint, schema, tracks: 'tasks.md',
    taskProgress: { total: 1, complete: 1, remaining: 0, tasks: [] }, remaining: 0, planWaived: false });
}

describe('B330 an archived change keeps the verify state it was archived with', () => {
  it('A1 a passed record of an older check set reads passed and satisfies the gate', () => {
    const result = gate(record('passed'), true);
    expect(result.verification.status).toBe('passed');
    expect(result.evaluation.status).toBe('passed');
    expect(result.evaluation.satisfied).toBe(true);
  });

  it('A1b the same in fast mode', () => {
    expect(gate(record('passed'), true, true).verification.status).toBe('passed');
  });

  it('negative A2 a failed archived record still reads failed', () => {
    const result = gate(record('failed', 1), true);
    expect(result.verification.status).toBe('failed');
    expect(result.evaluation.satisfied).toBe(false);
  });

  it('negative A3 an active change is judged against today\'s checks', () => {
    const result = gate({ ...record('passed'), fingerprint: NOW }, false);
    expect(result.verification.status).not.toBe('passed');
    expect(result.evaluation.satisfied).toBe(false);
  });
});
