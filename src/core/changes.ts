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
      { key: 'error.change_name_x_must_be_lowercase_kebab_case_lette', params: { id: id } },
      { key: 'fix.example_add_claims_status_panel' }
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

/**
 * The active changes that reads and suggested commands are built from: a folder whose name is not a change id is left
 * out, so its name never reaches a command a person copies (B129).
 */
export function listActiveChanges(paths: ProjectPaths): ChangeRef[] {
  return listChangeFolders(paths).filter((change) => isValidChangeId(change.id));
}

/** Every change folder, valid name or not: enforcement (locked tests, the plan gate, takeovers) sees them all. */
export function listChangeFolders(paths: ProjectPaths): ChangeRef[] {
  return subdirs(paths.changesDir)
    .filter((name) => name !== 'archive')
    .map((name) => ({ id: name, dir: path.join(paths.changesDir, name), archived: false }));
}

/** The folder names `listActiveChanges` leaves out, for the doctor and the text warnings. */
export function invalidChangeFolders(paths: ProjectPaths): string[] {
  return listChangeFolders(paths).filter((change) => !isValidChangeId(change.id)).map((change) => change.id);
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

export function assertUnusedArchivedId(paths: ProjectPaths, id: string): void {
  const previous = listArchivedChanges(paths).find((change) => change.id === id);
  if (previous) {
    throw new SdlcError('archived_change_id',
      { key: 'error.archivedChangeId', params: { id, folder: previous.archivedAs ?? '' } });
  }
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
      throw new SdlcError(
        'no_active_changes',
        { key: 'error.there_are_no_active_changes' },
        { key: 'fix.start_one_with_sdlc_new_name' }
      );
    }
    throw new SdlcError(
      'change_required',
      { key: 'error.several_active_changes_exist_x_name_one_with_cha', params: { p1: active.map((c) => c.id).join(', ') } }
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
      { key: 'error.change_x_not_found', params: { id: id } },
      active.length > 0
      ? { key: 'fix.active_changes_x', params: { p1: active.map((c) => c.id).join(', ') } }
      : { key: 'fix.start_one_with_sdlc_new_name' }
    );
}
