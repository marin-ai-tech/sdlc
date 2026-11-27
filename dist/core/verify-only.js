import { SdlcError } from './errors.js';
/** Refuse an unknown selector before verification can start or record a run. */
export function assertKnownCheckNames(verify, only) {
    if (!only)
        return;
    const available = [...verify.commands, ...(verify.mcp ?? [])].map((check) => check.name);
    const known = new Set(available);
    const unknown = [...new Set(only.filter((name) => !known.has(name)))];
    if (unknown.length === 0)
        return;
    throw new SdlcError('unknown_check_names', { key: 'error.unknown_check_names', params: { names: unknown.join(', '), available: available.join(', ') } }, { key: 'fix.unknown_check_names' });
}
