import * as path from 'node:path';
import * as fs from 'node:fs';
import { isFile, isWithin, toPosix } from './fs-utils.js';
import { t } from './i18n.js';
const ARTIFACTS = [
    'intent.md', 'proposal.md', 'design.md', 'plan.md', 'tasks.md',
    'review.md', 'release.md', 'verification.md',
];
/** A misplaced root artifact is named only when its destination is inside this change. */
export function rootArtifactHints(root, ref) {
    if (ref.archived || !isWithin(root, ref.dir))
        return [];
    const hints = [];
    const names = new Set(fs.readdirSync(root));
    for (const file of ARTIFACTS) {
        const source = path.join(root, file);
        const target = path.join(ref.dir, file);
        if (!isWithin(root, source) || !isWithin(ref.dir, target))
            continue;
        if (!names.has(file) || !isFile(source) || isFile(target))
            continue;
        hints.push(t('hint.rootArtifact', { file, path: toPosix(path.relative(root, target)) }));
    }
    return hints;
}
