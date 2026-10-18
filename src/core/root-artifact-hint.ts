import * as path from 'node:path';
import type { ChangeRef } from './changes.js';
import { isFile, isWithin, toPosix } from './fs-utils.js';

const ARTIFACTS = [
  'intent.md', 'proposal.md', 'design.md', 'plan.md', 'tasks.md',
  'review.md', 'release.md', 'verification.md',
];

/** A misplaced root artifact is named only when its destination is inside this change. */
export function rootArtifactHints(root: string, ref: ChangeRef): string[] {
  if (ref.archived || !isWithin(root, ref.dir)) return [];
  const hints: string[] = [];
  for (const file of ARTIFACTS) {
    const source = path.join(root, file);
    const target = path.join(ref.dir, file);
    if (!isWithin(root, source) || !isWithin(ref.dir, target)) continue;
    if (!isFile(source) || isFile(target)) continue;
    hints.push(`${file} belongs at ${toPosix(path.relative(root, target))}`);
  }
  return hints;
}
