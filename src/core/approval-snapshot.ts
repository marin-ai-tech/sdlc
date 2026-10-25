import * as path from 'node:path';
import type { CheckpointTree } from './checkpoint.js';
import type { CapturedDigest } from './digest.js';
import { withoutCheckboxState } from './digest.js';
import { SdlcError } from './errors.js';
import { normalizeNewlines } from './fs-utils.js';
import { stripProvenance } from './license.js';

/** Compare the immutable checkpoint's artifact bytes with the normalized bytes the evaluation hashed. */
export function assertSnapshotContent(root: string, changeDir: string, gate: string, snapshot: CheckpointTree,
  expected: CapturedDigest | undefined, tracks: string, initialTree?: string): void {
  if (initialTree && initialTree !== snapshot.ordinaryTree) changed(gate);
  const relative = path.relative(root, changeDir).replace(/\\/g, '/');
  for (const file of expected?.files ?? []) {
    const raw = snapshot.read(`${relative}/${file.path}`);
    if (raw === undefined) changed(gate);
    const normalized = stripProvenance(normalizeNewlines(raw!));
    const planning = gate === 'intent' || gate === 'spec' || gate === 'plan';
    const text = planning && file.path === tracks ? withoutCheckboxState(normalized) : normalized;
    if (text.trimEnd() !== file.text) changed(gate);
  }
}

function changed(gate: string): never {
  throw new SdlcError('digest_changed', { key: 'error.approvalSnapshotChanged', params: { gate } });
}
