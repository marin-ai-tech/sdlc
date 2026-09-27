import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isDirectory } from './fs-utils.js';
import type { ProjectPaths } from './project.js';

export interface ChangeRef {
  id: string;
  dir: string;
  archived: boolean;
  /** Archive folder name (`YYYY-MM-DD-<id>`) for archived changes. */
  archivedAs?: string;
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidChangeId(id: string): boolean {
  return KEBAB.test(id);
}

export function assertValidChangeId(id: string): void {
  if (!isValidChangeId(id)) {
    throw new SdlcError(
      'invalid_change_name',
      `Change name '${id}' must be lowercase kebab-case (letters, digits, single hyphens).`,
      'Example: add-claims-status-panel'
    );
  }
}

function subdirs(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

export function listActiveChanges(paths: ProjectPaths): ChangeRef[] {
  return subdirs(paths.changesDir)
    .filter((name) => name !== 'archive')
    .map((name) => ({ id: name, dir: path.join(paths.changesDir, name), archived: false }));
}

export function listArchivedChanges(paths: ProjectPaths): ChangeRef[] {
  return subdirs(paths.archiveDir).map((name) => {
    const match = name.match(/^\d{4}-\d{2}-\d{2}-(.+)$/);
    return {
      id: match ? match[1] : name,
      dir: path.join(paths.archiveDir, name),
      archived: true,
      archivedAs: name,
    };
  });
}

/**
 * Resolves the change a command should act on. With no id, a single active
 * change is selected automatically (the same convenience OpenSpec's apply
 * offers); otherwise the caller must name one.
 */
export function resolveChange(paths: ProjectPaths, id?: string, options: { allowArchived?: boolean } = {}): ChangeRef {
  const active = listActiveChanges(paths);
  if (!id) {
    if (active.length === 1) return active[0];
    if (active.length === 0) {
      throw new SdlcError('no_active_changes', 'There are no active changes.', 'Start one with `sdlc new <name>`.');
    }
    throw new SdlcError(
      'change_required',
      `Several active changes exist (${active.map((c) => c.id).join(', ')}); name one with --change <id>.`
    );
  }
  const found = active.find((c) => c.id === id);
  if (found) return found;
  if (options.allowArchived) {
    const archived = listArchivedChanges(paths).filter((c) => c.id === id || c.archivedAs === id);
    if (archived.length > 0) return archived[archived.length - 1];
  }
  throw new SdlcError(
    'change_not_found',
    `Change '${id}' not found.`,
    active.length > 0 ? `Active changes: ${active.map((c) => c.id).join(', ')}` : 'Start one with `sdlc new <name>`.'
  );
}
