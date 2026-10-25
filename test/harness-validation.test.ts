import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { candidatePassed } from '../src/executors/harness-validation.js';

const commit = 'a'.repeat(40);
const fingerprint = `git-tree:${'b'.repeat(40)}`;
const verification = { ...defaultConfig().verify,
  commands: [{ name: 'test', run: 'node check.cjs', required: true }] };

function evidence() {
  return { fingerprint, run: {
    status: 'passed', commit, fingerprint, at: '2026-10-24', dirty: false,
    checks: [{ name: 'test', command: 'node check.cjs', required: true, exit_code: 0,
      duration_ms: 1, output: '' }],
  } };
}

describe('B124: isolated validator evidence boundary', () => {
  it('refuses a dirty or unspecified initial checkout even when both fingerprints match', () => {
    const value = evidence();
    for (const dirty of [true, undefined]) {
      expect(candidatePassed({ ...value, run: { ...value.run, dirty } }, commit, verification, fingerprint)).toBe(false);
    }
  });

  it('requires the exact commit, complete trusted checks and a fresh post-check fingerprint', () => {
    expect(candidatePassed(evidence(), commit, verification, fingerprint)).toBe(true);
    expect(candidatePassed(evidence(), 'c'.repeat(40), verification, fingerprint)).toBe(false);
    for (const invalid of [null, {}, { fingerprint },
      { ...evidence(), fingerprint: undefined }, { ...evidence(), fingerprint: 'git-tree:different' },
      { run: { ...evidence().run, fingerprint: undefined } },
      { ...evidence(), run: { ...evidence().run, checks: [] } },
      { ...evidence(), run: { ...evidence().run, status: 'failed' } }]) {
      expect(candidatePassed(invalid, commit, verification, fingerprint)).toBe(false);
    }
    expect(candidatePassed(evidence(), commit, verification, `git-tree:${'c'.repeat(40)}`)).toBe(false);
  });

  it('refuses an omitted, renamed, failed or timed-out required command', () => {
    for (const replacement of [{ name: 'other' }, { command: 'true' }, { required: false },
      { exit_code: 1 }, { exit_code: null }, { timed_out: true }, { timed_out: 'false' }]) {
      const value = evidence();
      const check = { ...value.run.checks[0], ...replacement };
      expect(candidatePassed({ ...value, run: { ...value.run, checks: [check] } }, commit, verification, fingerprint))
        .toBe(false);
    }
    expect(candidatePassed(evidence(), commit, { ...verification, commands: [] }, fingerprint)).toBe(false);
  });
});
