import { describe, expect, it } from 'vitest';
import { SdlcError } from '../src/core/errors.js';
import { assertExpectedDigest, parseExpectedDigest } from '../src/core/expected-digest.js';
import type { GateEvaluation } from '../src/core/lifecycle.js';

/**
 * The expected digest of `sdlc approve --expect-digest` (change digest-check): only the full form is accepted (the
 * 12-character form can be collided by an agent that writes both versions), the refused value is shown escaped and
 * cut, and a gate without a digest gives the error approve gives without the option. The command-level behaviour is
 * in test/e2e-0240-digest-check.test.ts.
 */

const HEX = '5686b708f959805888bc3743b17b92b15fa7cb771bdda161a4f1fafa4e692c2f';
const CURRENT = `sha256:${HEX}`;
const OTHER = `sha256:${'0'.repeat(64)}`;

function gate(fields: Partial<GateEvaluation>): GateEvaluation {
  return {
    id: 'intent', stage: 'plan', required: true, status: 'pending', satisfied: false, artifacts: [],
    approvals: [], staleApprovals: [], missingRoles: [], ...fields,
  } as GateEvaluation;
}

function failure(run: () => unknown): SdlcError {
  try {
    run();
  } catch (error) {
    if (error instanceof SdlcError) return error;
    throw error;
  }
  throw new Error('expected an SdlcError');
}

describe('parseExpectedDigest', () => {
  it('accepts the full digest in any case and returns it in lower case', () => {
    expect(parseExpectedDigest(CURRENT)).toBe(CURRENT);
    expect(parseExpectedDigest(CURRENT.toUpperCase())).toBe(CURRENT);
  });

  it('negative: refuses every other form with invalid_option, the 12 characters included', () => {
    const values = ['', 'abc', HEX, HEX.slice(0, 12), HEX.slice(0, 12).toUpperCase(), `sha256:${HEX.slice(0, 12)}`,
      `sha256:${HEX}0`, ` ${CURRENT}`, `${CURRENT} `, `${CURRENT}\r`, `sha1:${HEX}`, `sha256:${'g'.repeat(64)}`];
    for (const value of values) {
      const error = failure(() => parseExpectedDigest(value));
      expect(error.code, JSON.stringify(value)).toBe('invalid_option');
    }
  });

  it('shows the refused value escaped and cut to 80 characters', () => {
    expect(failure(() => parseExpectedDigest(`${CURRENT}\r`)).message).toContain('\\r');
    const long = failure(() => parseExpectedDigest('x'.repeat(500))).message;
    expect(long).toContain('x'.repeat(80));
    expect(long).not.toContain('x'.repeat(81));
  });
});

describe('assertExpectedDigest', () => {
  it('passes without an expected digest, and when the digest matches', () => {
    expect(() => assertExpectedDigest(undefined, 'a', gate({ digest: CURRENT }))).not.toThrow();
    expect(() => assertExpectedDigest(undefined, 'a', gate({ status: 'blocked' }))).not.toThrow();
    expect(() => assertExpectedDigest(CURRENT, 'a', gate({ digest: CURRENT }))).not.toThrow();
  });

  it('negative: a different version is digest_changed naming both and pointing to the preview', () => {
    const error = failure(() => assertExpectedDigest(OTHER, 'a', gate({ digest: CURRENT })));
    expect(error.code).toBe('digest_changed');
    expect(error.message).toContain('0'.repeat(12));
    expect(error.message).toContain(HEX.slice(0, 12));
    expect(error.fix).toContain('--preview');
  });

  it('negative: a blocked gate without a digest is gate_blocked with its reason', () => {
    const blocked = gate({ status: 'blocked', reason: 'missing artifacts: intent' });
    const error = failure(() => assertExpectedDigest(CURRENT, 'a', blocked));
    expect(error.code).toBe('gate_blocked');
    expect(error.message).toContain('missing artifacts: intent');
  });

  it('negative: a gate that is not blocked and has no digest is gate_not_ready', () => {
    const error = failure(() => assertExpectedDigest(CURRENT, 'a', gate({ status: 'pending' })));
    expect(error.code).toBe('gate_not_ready');
  });
});
