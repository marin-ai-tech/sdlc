import * as path from 'node:path';
import { withoutCheckboxState } from './digest.js';
import { SdlcError } from './errors.js';
import { normalizeNewlines } from './fs-utils.js';
import { stripProvenance } from './license.js';
/** Compare the immutable checkpoint's artifact bytes with the normalized bytes the evaluation hashed. */
export function assertSnapshotContent(root, changeDir, gate, snapshot, expected, tracks, initialTree) {
    if (initialTree && initialTree !== snapshot.ordinaryTree)
        changed(gate);
    const relative = path.relative(root, changeDir).replace(/\\/g, '/');
    for (const file of expected?.files ?? []) {
        const artifact = `${relative}/${file.path}`;
        const raw = snapshot.read(artifact);
        if (raw === undefined)
            changed(gate);
        if (matches(raw, file.path, gate, tracks, file.text))
            continue;
        const filtered = snapshot.readFiltered(artifact);
        if (filtered !== undefined && matches(filtered, file.path, gate, tracks, file.text))
            continue;
        changed(gate);
    }
}
function matches(content, file, gate, tracks, expected) {
    const normalized = stripProvenance(normalizeNewlines(content));
    const planning = gate === 'intent' || gate === 'spec' || gate === 'plan';
    const text = planning && file === tracks ? withoutCheckboxState(normalized) : normalized;
    return text.trimEnd() === expected;
}
function changed(gate) {
    throw new SdlcError('digest_changed', { key: 'error.approvalSnapshotChanged', params: { gate } });
}
