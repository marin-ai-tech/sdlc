import { isSeq } from './decision-order.js';
import { recordObject, stringFields } from './record-values.js';
function releaseChecks(value) {
    if (!Array.isArray(value))
        return undefined;
    const out = [];
    for (const entry of value) {
        const raw = recordObject(entry);
        if (!raw || !stringFields(raw, ['name', 'server', 'tool', 'at']) || typeof raw.ok !== 'boolean')
            return undefined;
        out.push({ ...raw, name: raw.name, server: raw.server,
            tool: raw.tool, at: raw.at, ok: raw.ok });
    }
    return out;
}
/** Malformed decisions never become an approval. Legacy decisions need no new fields. */
export function parseApproval(value) {
    const raw = recordObject(value);
    const optional = ['person', 'note', 'sdlc', 'license'];
    if (!raw || !stringFields(raw, ['role', 'by', 'at', 'digest'], optional))
        return undefined;
    if (raw.seq !== undefined && !isSeq(raw.seq))
        return undefined;
    const base = raw.base === undefined ? undefined : recordObject(raw.base);
    if (raw.base !== undefined && (!base || Object.values(base).some((item) => typeof item !== 'string'))) {
        return undefined;
    }
    const checks = raw.checks === undefined ? undefined : releaseChecks(raw.checks);
    if (raw.checks !== undefined && !checks)
        return undefined;
    return {
        ...raw,
        role: raw.role, by: raw.by, at: raw.at, digest: raw.digest,
        ...(raw.person !== undefined ? { person: raw.person } : {}),
        ...(raw.note !== undefined ? { note: raw.note } : {}),
        ...(raw.sdlc !== undefined ? { sdlc: raw.sdlc } : {}),
        ...(raw.license !== undefined ? { license: raw.license } : {}),
        ...(isSeq(raw.seq) ? { seq: raw.seq } : {}),
        ...(base ? { base: base } : {}),
        ...(checks ? { checks } : {}),
    };
}
/** Gate envelopes remain backward compatible; every approval is independently parsed. */
export function parseApprovalGatesWithRejected(value) {
    const raw = recordObject(value);
    if (!raw)
        return { gates: {}, rejected: {} };
    const gates = Object.create(null);
    const rejected = Object.create(null);
    for (const [name, value] of Object.entries(raw)) {
        const gate = recordObject(value);
        if (!gate)
            continue;
        const approvals = Array.isArray(gate.approvals) ? gate.approvals.flatMap((entry) => {
            const parsed = parseApproval(entry);
            if (!parsed)
                (rejected[name] ??= []).push(entry);
            return parsed ? [parsed] : [];
        }) : [];
        gates[name] = { ...gate, ...(gate.approvals !== undefined ? { approvals } : {}) };
    }
    return { gates, rejected };
}
export function parseApprovalGates(value) {
    return parseApprovalGatesWithRejected(value).gates;
}
