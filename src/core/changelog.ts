import { listActiveChanges, listArchivedChanges, resolveChange, type ChangeRef } from './changes.js';
import { readChangeDeltas, type DeltaOp } from './deltas.js';
import type { ProjectPaths } from './project.js';

/**
 * Changelog from the delta specs (B22, `sdlc changelog`): ADDED requirements are added, MODIFIED and RENAMED ones
 * changed (a rename under its new name), REMOVED ones removed. A change without delta specs adds nothing.
 */
export interface ChangelogEntry {
  requirement: string;
  capability: string;
  change: string;
}

export interface Changelog {
  added: ChangelogEntry[];
  changed: ChangelogEntry[];
  removed: ChangelogEntry[];
}

export interface ChangelogScope {
  change?: string;
  /** YYYY-MM-DD: archived changes whose archive folder date is on or after it. */
  sinceDate?: string;
}

const SECTION: Record<DeltaOp, keyof Changelog> = {
  added: 'added',
  modified: 'changed',
  renamed: 'changed',
  removed: 'removed',
};

const ARCHIVE_DATE = /^(\d{4}-\d{2}-\d{2})-/;

/** The archive folder date (`YYYY-MM-DD-` prefix) of an archived change; undefined for anything else. */
export function archiveDate(ref: ChangeRef): string | undefined {
  return ARCHIVE_DATE.exec(ref.archivedAs ?? '')?.[1];
}

/**
 * `--change`: that change (active or archived); `--since`: the archived changes from that date on; neither: every
 * active change.
 */
export function changelogRefs(paths: ProjectPaths, scope: ChangelogScope): ChangeRef[] {
  if (scope.change !== undefined) return [resolveChange(paths, scope.change, { allowArchived: true })];
  if (scope.sinceDate === undefined) return listActiveChanges(paths);
  const since = scope.sinceDate;
  return listArchivedChanges(paths).filter((ref) => {
    const date = archiveDate(ref);
    return date !== undefined && date >= since;
  });
}

export function buildChangelog(refs: ChangeRef[]): Changelog {
  const log: Changelog = { added: [], changed: [], removed: [] };
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

const HEADINGS: Array<[keyof Changelog, string]> = [
  ['added', '### Added'],
  ['changed', '### Changed'],
  ['removed', '### Removed'],
];

/** Markdown with only the sections that have entries; `nothing` alone when there are none. */
export function changelogMarkdown(log: Changelog, nothing: string): string {
  const lines: string[] = [];
  for (const [key, heading] of HEADINGS) {
    if (log[key].length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(heading);
    lines.push('');
    for (const entry of log[key]) lines.push(`- ${entry.requirement} (${entry.capability}, ${entry.change})`);
  }
  if (lines.length === 0) lines.push(nothing);
  return `${lines.join('\n')}\n`;
}
