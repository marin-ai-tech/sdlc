import { describe, expect, it } from 'vitest';
import { newChangeState, type VerifyRecord } from '../src/core/change-state.js';
import { defaultConfig, type SdlcConfig } from '../src/core/config.js';
import type { SchemaInfo } from '../src/core/openspec-schema.js';
import { evaluateVerifyGate } from '../src/core/verify-gate.js';
import { failedSelection } from '../src/core/verify-merge.js';
import { tempDir } from './helpers.js';

/**
 * B282 review round 1. R1: the gate never passes a record whose own status is failed (a failing pack check is part
 * of the recorded run but not of sdlc.yaml, so the configured checks alone looked passed). R2: `--failed` reruns a
 * legacy MCP result without an arguments digest instead of refusing it; a changed digest is still refused.
 */

const FP = 'git-tree:1111111111111111111111111111111111111111';

function config(): SdlcConfig {
  const c = defaultConfig();
  c.verify.commands = [{ name: 'stable', run: 'node -e 0', required: true }];
  return c;
}

const passedCommand = { name: 'stable', command: 'node -e 0', exit_code: 0, duration_ms: 1, required: true,
  fingerprint: FP, run_id: 'r1', attempt: 1 };

function gate(record: VerifyRecord, c: SdlcConfig = config()) {
  const state = { ...newChangeState(), verify: record };
  const schema = { apply: { requires: [], tracks: 'tasks.md' } } as unknown as SchemaInfo;
  return evaluateVerifyGate({ ref: { id: 'x', dir: tempDir('sdlc-gate-'), archived: false }, config: c, state,
    decided: undefined, fingerprint: FP, schema, tracks: 'tasks.md',
    taskProgress: { total: 1, complete: 1, remaining: 0, tasks: [] }, remaining: 0, planWaived: false });
}

describe('B282 review R1: a failed record never passes the gate', () => {
  it('R1: every configured check passed, but the record (with a failing pack check) says failed', () => {
    const record: VerifyRecord = { status: 'failed', at: '2026-11-19T00:00:00.000Z', fingerprint: FP, id: 'r1',
      results: [passedCommand,
        { name: 'pack lint', command: 'node lint.cjs', exit_code: 1, duration_ms: 1, required: true,
          fingerprint: FP, run_id: 'r1', attempt: 1 }] };
    expect(gate(record).verification.status).not.toBe('passed');
    expect(gate(record).evaluation.satisfied).toBe(false);
  });

  it('negative R1b: a passed record of the same checks passes', () => {
    const record: VerifyRecord = { status: 'passed', at: '2026-11-19T00:00:00.000Z', fingerprint: FP, id: 'r1',
      results: [passedCommand] };
    expect(gate(record).verification.status).toBe('passed');
  });
});

describe('B282 review R2: --failed reruns a legacy MCP result', () => {
  function withMcp(): SdlcConfig {
    const c = config();
    c.verify.mcp = [{ name: 'ci-green', server: 'build', tool: 'pipeline_status', args: { ref: 'main' },
      expect: { status: 'success' }, required: true, wait_seconds: 0 }] as unknown as SdlcConfig['verify']['mcp'];
    return c;
  }

  it('R2: a legacy MCP result without args_digest is selected for the rerun, not refused', () => {
    const record: VerifyRecord = { status: 'failed', at: '2026-11-19T00:00:00.000Z', fingerprint: FP, id: 'r1',
      results: [passedCommand],
      mcp: [{ name: 'ci-green', server: 'build', tool: 'pipeline_status', required: true, ok: true, duration_ms: 1 }] };
    expect(failedSelection(record, withMcp(), FP)).toEqual(['ci-green']);
  });

  it('negative R2b: an MCP result whose args digest differs is still refused', () => {
    const record: VerifyRecord = { status: 'failed', at: '2026-11-19T00:00:00.000Z', fingerprint: FP, id: 'r1',
      results: [passedCommand],
      mcp: [{ name: 'ci-green', server: 'build', tool: 'pipeline_status', required: true, ok: true, duration_ms: 1,
        args_digest: '0'.repeat(64), fingerprint: FP, run_id: 'r1', attempt: 1 }] };
    expect(() => failedSelection(record, withMcp(), FP)).toThrow(/ci-green/);
  });
});
