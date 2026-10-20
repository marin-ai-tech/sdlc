import { describe, expect, it } from 'vitest';
import { SdlcError } from '../src/core/errors.js';
import { assertExpectedDigest, parseExpectedDigest, shortDigest } from '../src/core/expected-digest.js';

/**
 * The expected digest of `sdlc approve --expect-digest` (change digest-check): the two accepted forms, case, and the
 * comparison with the gate's current digest. The command-level behaviour is in test/e2e-0240-digest-check.test.ts.
 */

const HEX = '5686b708f959805888bc3743b17b92b15fa7cb771bdda161a4f1fafa4e692c2f';
const CURRENT = `sha256:${HEX}`;
const OTHER = `sha256:${'0'.repeat(64)}`;
const TARGET = { gate: 'intent', change: 'a' };

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
  it('accepts the full digest and the 12 characters approve prints, in any case', () => {
    expect(parseExpectedDigest(CURRENT)).toEqual({ kind: 'full', value: CURRENT });
    expect(parseExpectedDigest(CURRENT.toUpperCase())).toEqual({ kind: 'full', value: CURRENT });
    expect(parseExpectedDigest(HEX.slice(0, 12))).toEqual({ kind: 'short', value: HEX.slice(0, 12) });
    expect(parseExpectedDigest(HEX.slice(0, 12).toUpperCase())).toEqual({ kind: 'short', value: HEX.slice(0, 12) });
  });

  it('negative: refuses every other form with invalid_option', () => {
    const values = ['', 'abc', HEX, HEX.slice(0, 11), HEX.slice(0, 13), `sha256:${HEX.slice(0, 12)}`,
      `sha256:${HEX}0`, ` ${CURRENT}`, `${CURRENT} `, `sha1:${HEX}`, `sha256:${'g'.repeat(64)}`];
    for (const value of values) {
      const error = failure(() => parseExpectedDigest(value));
      expect(error.code, value).toBe('invalid_option');
    }
  });
});

describe('shortDigest', () => {
  it('is the 12 characters after the prefix', () => {
    expect(shortDigest(CURRENT)).toBe(HEX.slice(0, 12));
  });
});

describe('assertExpectedDigest', () => {
  it('passes without an expected digest, and when the full or the short form matches', () => {
    expect(() => assertExpectedDigest(undefined, TARGET, CURRENT)).not.toThrow();
    expect(() => assertExpectedDigest(undefined, TARGET, undefined)).not.toThrow();
    expect(() => assertExpectedDigest(parseExpectedDigest(CURRENT), TARGET, CURRENT)).not.toThrow();
    expect(() => assertExpectedDigest(parseExpectedDigest(HEX.slice(0, 12)), TARGET, CURRENT)).not.toThrow();
  });

  it('negative: a different version is digest_changed naming both short forms', () => {
    const error = failure(() => assertExpectedDigest(parseExpectedDigest(OTHER), TARGET, CURRENT));
    expect(error.code).toBe('digest_changed');
    expect(error.message).toContain('0'.repeat(12));
    expect(error.message).toContain(HEX.slice(0, 12));
    expect(error.fix).toContain('--preview');
  });

  it('negative: a short form that is not the start of the current digest is digest_changed', () => {
    const error = failure(() => assertExpectedDigest(parseExpectedDigest(HEX.slice(1, 13)), TARGET, CURRENT));
    expect(error.code).toBe('digest_changed');
  });

  it('negative: a gate with no version is gate_not_ready', () => {
    const error = failure(() => assertExpectedDigest(parseExpectedDigest(CURRENT), TARGET, undefined));
    expect(error.code).toBe('gate_not_ready');
  });
});
