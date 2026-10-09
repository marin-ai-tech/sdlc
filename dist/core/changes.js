import * as fs from 'node:fs';
import * as path from 'node:path';
import { SdlcError } from './errors.js';
import { isDirectory } from './fs-utils.js';
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidChangeId(id) {
    return KEBAB.test(id);
}
export function assertValidChangeId(id) {
    if (!isValidChangeId(id)) {
        throw new SdlcError('invalid_change_name', { key: 'error.change_name_x_must_be_lowercase_kebab_case_lette', params: { id: id } }, { key: 'fix.example_add_claims_status_panel' });
    }
}
function subdirs(dir) {
    if (!isDirectory(dir))
        return [];
    return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
}
export function listActiveChanges(paths) {
    return subdirs(paths.changesDir)
        .filter((name) => name !== 'archive')
        .map((name) => ({ id: name, dir: path.join(paths.changesDir, name), archived: false }));
}
export function listArchivedChanges(paths) {
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
export function resolveChange(paths, id, options = {}) {
    const active = listActiveChanges(paths);
    if (!id) {
        if (active.length === 1)
            return active[0];
        if (active.length === 0) {
            throw new SdlcError('no_active_changes', { key: 'error.there_are_no_active_changes' }, { key: 'fix.start_one_with_sdlc_new_name' });
        }
        throw new SdlcError('change_required', { key: 'error.several_active_changes_exist_x_name_one_with_cha', params: { p1: active.map((c) => c.id).join(', ') } });
    }
    const found = active.find((c) => c.id === id);
    if (found)
        return found;
    if (options.allowArchived) {
        const archived = listArchivedChanges(paths).filter((c) => c.id === id || c.archivedAs === id);
        if (archived.length > 0)
            return archived[archived.length - 1];
    }
    throw new SdlcError('change_not_found', { key: 'error.change_x_not_found', params: { id: id } }, active.length > 0
        ? { key: 'fix.active_changes_x', params: { p1: active.map((c) => c.id).join(', ') } }
        : { key: 'fix.start_one_with_sdlc_new_name' });
}
