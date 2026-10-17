import { listActiveChanges, listArchivedChanges, resolveChange } from './changes.js';
import { readChangeDeltas } from './deltas.js';
const SECTION = {
    added: 'added',
    modified: 'changed',
    renamed: 'changed',
    removed: 'removed',
};
const ARCHIVE_DATE = /^(\d{4}-\d{2}-\d{2})-/;
/** The archive folder date (`YYYY-MM-DD-` prefix) of an archived change; undefined for anything else. */
export function archiveDate(ref) {
    return ARCHIVE_DATE.exec(ref.archivedAs ?? '')?.[1];
}
/**
 * `--change`: that change (active or archived); `--since`: the archived changes from that date on; neither: every
 * active change.
 */
export function changelogRefs(paths, scope) {
    if (scope.change !== undefined)
        return [resolveChange(paths, scope.change, { allowArchived: true })];
    if (scope.sinceDate === undefined)
        return listActiveChanges(paths);
    const since = scope.sinceDate;
    return listArchivedChanges(paths).filter((ref) => {
        const date = archiveDate(ref);
        return date !== undefined && date >= since;
    });
}
export function buildChangelog(refs) {
    const log = { added: [], changed: [], removed: [] };
    for (const ref of refs) {
        for (const delta of readChangeDeltas(ref.dir)) {
            for (const entry of delta.entries) {
                const requirement = entry.op === 'renamed' && entry.to ? entry.to : entry.requirement;
                log[SECTION[entry.op]].push({ requirement, capability: delta.capability, change: ref.id });
            }
        }
    }
    return log;
}
const HEADINGS = [
    ['added', '### Added'],
    ['changed', '### Changed'],
    ['removed', '### Removed'],
];
/** Markdown with only the sections that have entries; `nothing` alone when there are none. */
export function changelogMarkdown(log, nothing) {
    const lines = [];
    for (const [key, heading] of HEADINGS) {
        if (log[key].length === 0)
            continue;
        if (lines.length > 0)
            lines.push('');
        lines.push(heading);
        lines.push('');
        for (const entry of log[key])
            lines.push(`- ${entry.requirement} (${entry.capability}, ${entry.change})`);
    }
    if (lines.length === 0)
        lines.push(nothing);
    return `${lines.join('\n')}\n`;
}
