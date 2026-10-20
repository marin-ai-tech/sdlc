/**
 * `sdlc approve <gate> --expect-digest <digest>`: approve only the version the person read. The expected digest is
 * parsed at the boundary (the full `sha256:<hex>`, or the 12 characters `approve` prints) and compared with the gate's
 * current digest before the approval writes anything; the preview collects the same comparison as a refusal.
 */
import { SdlcError } from './errors.js';

export interface ExpectedDigest {
  kind: 'full' | 'short';
  value: string;
}

export function parseExpectedDigest(raw: string): ExpectedDigest {
  if (/^sha256:[0-9a-f]{64}$/i.test(raw)) return { kind: 'full', value: raw.toLowerCase() };
  if (/^[0-9a-f]{12}$/i.test(raw)) return { kind: 'short', value: raw.toLowerCase() };
  throw new SdlcError('invalid_option', { key: 'error.expectDigestInvalid', params: { value: raw } });
}

export function shortDigest(digest: string): string {
  return digest.slice(7, 19);
}

export function assertExpectedDigest(
  expected: ExpectedDigest | undefined,
  target: { gate: string; change: string },
  current: string | undefined,
): void {
  if (!expected) return;
  const { gate, change } = target;
  if (!current) {
    throw new SdlcError('gate_not_ready', {
      key: 'error.nothing_to_approve_for_the_x_gate_yet', params: { gate },
    });
  }
  if (expected.value === (expected.kind === 'full' ? current : shortDigest(current))) return;
  const expectedShort = expected.kind === 'full' ? shortDigest(expected.value) : expected.value;
  throw new SdlcError(
    'digest_changed',
    { key: 'error.expectDigestChanged', params: { gate, expected: expectedShort, current: shortDigest(current) } },
    { key: 'fix.expectDigestChanged', params: { gate, change } },
  );
}
