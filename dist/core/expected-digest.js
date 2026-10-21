/**
 * `sdlc approve <gate> --expect-digest <digest>`: approve only the version the person read. Only the full
 * `sha256:<hex>` is accepted: an agent that writes both versions can match a short prefix (a birthday search on 48
 * bits takes minutes). The value is parsed at the boundary, then compared with the gate's current digest before the
 * approval writes anything; a gate without a digest gives the error the approval gives without the option. The
 * preview collects the same parse and comparison as refusals.
 */
import { shortDigest } from './approval-hygiene.js';
import { SdlcError } from './errors.js';
import { assertReady } from './gate-ready.js';
export function parseExpectedDigest(raw) {
    if (/^sha256:[0-9a-f]{64}$/i.test(raw))
        return raw.toLowerCase();
    throw new SdlcError('invalid_option', {
        key: 'error.expectDigestInvalid', params: { value: JSON.stringify(raw.slice(0, 80)) },
    });
}
/** The option's values as commander collects them: none, one digest, or two different values (refused). */
export function parseExpectedOption(values) {
    if (!values?.length)
        return undefined;
    if (new Set(values).size > 1) {
        throw new SdlcError('invalid_option', { key: 'error.expectDigestTwice' });
    }
    return parseExpectedDigest(values[0]);
}
export function assertExpectedDigest(expected, change, gate) {
    if (expected === undefined)
        return;
    if (gate.digest === undefined) {
        assertReady(gate.id, gate);
        return;
    }
    if (expected === gate.digest)
        return;
    throw new SdlcError('digest_changed', { key: 'error.expectDigestChanged', params: {
            gate: gate.id, expected: shortDigest(expected), current: shortDigest(gate.digest),
        } }, { key: 'fix.expectDigestChanged', params: { gate: gate.id, change } });
}
