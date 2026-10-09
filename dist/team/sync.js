import * as fs from 'node:fs';
import * as path from 'node:path';
import { normalizeNewlines, readText, writeTextAtomic } from '../core/fs-utils.js';
import { registryDraft } from './draft.js';
import { packDrafts } from './packs.js';
import { acceptedPath, draftPath, readTeam, writeTeam } from './record.js';
import { failure, listed, RegistryItemError, registryServer, withRegistry, } from './registry-client.js';
import { ROLE_ID } from './role-file.js';
import { builtinSource, builtinVersion, teamLocale } from './sources.js';
import { vetRole } from './vetting.js';
async function fetchRole(call, want) {
    try {
        const vetted = vetRole(await call('get_role', { id: want.id, locale: want.locale }), want.id, want.listed);
        if (!('ok' in vetted))
            return { id: want.id, reason: vetted.reason };
        const role = vetted.ok;
        const text = registryDraft(role, want.server);
        const { version, checksum } = role;
        return { id: role.id, text, source: 'registry', version, server: want.server, checksum };
    }
    catch (error) {
        if (error instanceof RegistryItemError)
            return { id: want.id, reason: error.message };
        throw error;
    }
}
async function fetchRoles(call, locale, server, refused) {
    const drafts = [];
    const seen = new Set();
    for (const item of listed(await call('list_roles'), 'roles')) {
        const id = typeof item.id === 'string' && ROLE_ID.test(item.id) ? item.id : undefined;
        if (id === undefined || seen.has(id)) {
            refused.push({ id: String(item.id).slice(0, 64), reason: id ? 'listed twice' : 'not a role id' });
            continue;
        }
        seen.add(id);
        const draft = await fetchRole(call, { id, locale, server, listed: item.checksum });
        if ('reason' in draft)
            refused.push(draft);
        else
            drafts.push(draft);
    }
    return drafts;
}
async function registryDrafts(config, locale, result) {
    const server = registryServer(config);
    if (!server)
        return [];
    try {
        const drafts = await withRegistry(server, (call) => fetchRoles(call, locale, server.name, result.refused));
        result.registry = { server: server.name, reachable: true, roles: drafts.map((draft) => draft.id) };
        return drafts;
    }
    catch (error) {
        result.registry = { server: server.name, reachable: false, roles: [], error: failure(error) };
        return [];
    }
}
/** The drafts of the packs; each pack's outcome goes to `result.packs`, a role refused by its check to `refused`. */
function packSources(root, config, locale, result) {
    if (!config.packs || config.packs.length === 0)
        return [];
    const found = packDrafts(root, config, locale);
    result.packs = found.reports;
    result.refused.push(...found.refused);
    return found.drafts;
}
/** True when the accepted role is what the draft would bring: a built-in, or the same version of its source. */
function acceptedCovers(entry, draft) {
    if (draft.source === 'builtin')
        return true;
    const same = entry?.version === draft.version && entry?.checksum === draft.checksum;
    return entry?.source === draft.source && same;
}
/** Why an existing draft stays: the same version, someone's edits, or a draft sdlc did not record. */
function keepDraft(team, draft, current) {
    const record = team.drafts[draft.id];
    if (!record)
        return draft.source !== 'builtin' && builtinVersion(draft.id, current) ? undefined : 'draft';
    const same = record.kind === draft.source && record.version === draft.version && record.checksum === draft.checksum;
    if (same || (record.kind !== 'builtin' && draft.source === 'builtin'))
        return 'draft';
    return normalizeNewlines(record.text) === normalizeNewlines(current) ? undefined : 'edited';
}
function placeDraft(root, team, draft, result) {
    const accepted = fs.existsSync(path.join(root, acceptedPath(draft.id)));
    if (accepted && acceptedCovers(team.roles[draft.id], draft)) {
        result.kept.push({ id: draft.id, reason: 'accepted' });
        return false;
    }
    const current = readText(path.join(root, draftPath(draft.id)));
    const keep = current === undefined ? undefined : keepDraft(team, draft, current);
    if (keep) {
        result.kept.push({ id: draft.id, reason: keep });
        return false;
    }
    writeTextAtomic(path.join(root, draftPath(draft.id)), draft.text);
    const { server, version, checksum } = draft;
    const pack = draft.pack ? { pack: draft.pack } : {};
    team.drafts[draft.id] = { kind: draft.source, ...pack, server, version, checksum, text: draft.text };
    result.created.push(draftPath(draft.id));
    return true;
}
/** Writes the drafts; never overwrites an accepted role, a draft of the same version or an edited draft. */
export async function syncTeam(root, config) {
    const locale = teamLocale(config);
    const result = { locale, created: [], kept: [], refused: [] };
    const team = readTeam(root);
    const fromRegistry = await registryDrafts(config, locale, result);
    const taken = new Set(fromRegistry.map((draft) => draft.id));
    const fromPacks = packSources(root, config, locale, result).filter((draft) => !taken.has(draft.id));
    for (const draft of fromPacks)
        taken.add(draft.id);
    const builtins = builtinSource.drafts(locale).filter((draft) => !taken.has(draft.id));
    let wrote = false;
    const drafts = [...fromRegistry, ...fromPacks, ...builtins];
    for (const draft of drafts)
        wrote = placeDraft(root, team, draft, result) || wrote;
    if (wrote)
        writeTeam(root, team);
    return result;
}
