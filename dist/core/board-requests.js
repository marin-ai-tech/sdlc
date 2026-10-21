import * as crypto from 'node:crypto';
import { SdlcError, toDiagnostic } from './errors.js';
export class RequestReplay {
    result;
    exitCode;
    constructor(result, exitCode) {
        this.result = result;
        this.exitCode = exitCode;
    }
}
function invalid(detail) {
    throw new SdlcError('board_invalid', {
        key: 'error.the_board_file_x_is_broken_x',
        params: { file: 'openspec/.sdlc/board.json', detail },
    });
}
export function parseRequests(value) {
    if (value === undefined)
        return [];
    if (!Array.isArray(value))
        invalid('requests must be a list');
    const requests = value.map((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            invalid('request must be a mapping');
        const raw = entry;
        if (typeof raw.key !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(raw.key)
            || typeof raw.command !== 'string' || !raw.command
            || typeof raw.digest !== 'string' || !/^[0-9a-f]{64}$/.test(raw.digest)
            || typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at))
            || !Number.isInteger(raw.exitCode) || !('result' in raw))
            invalid('request fields are invalid');
        return raw;
    });
    if (new Set(requests.map((entry) => entry.key)).size !== requests.length) {
        invalid('duplicate request key');
    }
    return requests;
}
export function validateRequest(key) {
    if (key !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
        throw new SdlcError('invalid_request', { key: 'error.board_invalid_request' });
    }
}
function digest(spec) {
    return crypto.createHash('sha256').update(JSON.stringify([spec.command, spec.args])).digest('hex');
}
export function replayRequest(requests, spec) {
    if (!spec?.key)
        return;
    const match = requests.find((entry) => entry.key === spec.key);
    if (!match)
        return;
    if (match.command !== spec.command || match.digest !== digest(spec)) {
        throw new SdlcError('request_conflict', { key: 'error.board_request_conflict' });
    }
    throw new RequestReplay((match.value ?? match.result), match.exitCode);
}
export function recordFailure(requests, spec, error) {
    if (!spec?.key)
        return;
    requests.push({ key: spec.key, command: spec.command, digest: digest(spec),
        result: { status: [toDiagnostic(error)] }, exitCode: 1, at: new Date().toISOString() });
}
function publicClaim(value) {
    const { id, item, executor, agent, claimedAt, expiresAt, leaseSeconds, state, reason, reopenedAt, escalate } = value;
    return { id, item, executor, agent, claimedAt, expiresAt, leaseSeconds, state,
        ...(reason ? { reason, reopenedAt, escalate } : {}) };
}
function jsonResult(command, value) {
    if (command === 'bid')
        return { bid: value };
    if (command === 'claim') {
        const result = value;
        return { claim: publicClaim(result.claim), item: result.item };
    }
    if (command === 'submit') {
        const result = value;
        return { claim: publicClaim(result.claim), result: result.result };
    }
    return { claim: publicClaim(value) };
}
export function recordRequest(requests, spec, result) {
    if (!spec?.key)
        return;
    const value = JSON.parse(JSON.stringify(result));
    const output = jsonResult(spec.command, value);
    const exitCode = spec.command === 'submit'
        && !value.result.ok ? 1 : 0;
    requests.push({ key: spec.key, command: spec.command, digest: digest(spec),
        result: output, value, exitCode, at: new Date().toISOString() });
}
export function pruneRequests(requests, now) {
    return requests.filter((entry) => Date.parse(entry.at) > now - 86_400_000);
}
