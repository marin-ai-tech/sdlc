import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { normalizeNewlines, readText, writeTextAtomic } from '../core/fs-utils.js';
import type { Locale } from '../core/i18n.js';
import { shownValue } from '../core/shown-value.js';
import { refreshPackWorkflows } from '../integrations/install.js';
import { assertRolesReadable } from './accepted.js';
import { registryDraft } from './draft.js';
import { packDrafts, type PackReport } from './packs.js';
import { acceptedPath, draftPath, readTeam, writeTeam, type TeamEntry, type TeamRecord } from './record.js';
import {
  failure, listed, RegistryItemError, registryServer, RegistryToolsMissing, withRegistry, type RegistryCall,
} from './registry-client.js';
import { ROLE_ID } from './role-file.js';
import { builtinSource, builtinVersion, teamLocale, type RoleDraft } from './sources.js';
import { vetMarker, vetRole, type SourceMarker } from './vetting.js';

/**
 * `sdlc team sync` (B69, B71, B76): the roles of the team registry first (in the project's locale), then those of
 * the packs (`packs` in sdlc.yaml, the first pack that has an id wins), the built-in set for the ids none has. A pack
 * that cannot be fetched is reported in `packs` and skipped. A role whose answer fails its check is refused and the
 * next source's role, if any, takes its place. An accepted role is never replaced: a new version from the registry
 * or a pack arrives as a draft next to it. A draft of the same version is left alone, and so is a draft someone
 * edited. A registry that does not answer leaves the built-ins to fill what is missing; the result says so, it is
 * not an error. Each pack's report also lists its lenses, workflows and checks (B18) and why it cannot be accepted
 * (`pack_not_pinned`, `pack_forbidden_command`, `pack_invalid_content`); none of them is in effect before
 * `sdlc team accept --pack`.
 */
export interface Refused {
  id: string;
  reason: string;
}

export type KeptReason = 'accepted' | 'draft' | 'edited';

export interface SyncResult {
  locale: Locale;
  created: string[];
  kept: Array<{ id: string; reason: KeptReason }>;
  refused: Refused[];
  warnings?: Refused[];
  /** B316: accepted roles whose draft differs only by the registry's source marker. */
  markerOnly?: string[];
  registry?: { server: string; reachable: boolean; roles: string[]; error?: string };
  packs?: PackReport[];
}

interface Wanted {
  id: string;
  locale: Locale;
  server: string;
  listed: unknown;
}

async function fetchRole(call: RegistryCall, want: Wanted, warnings: Refused[]): Promise<RoleDraft | Refused> {
  try {
    const answer = await call('get_role', { id: want.id, locale: want.locale });
    const vetted = vetRole(answer, want.id, want.listed);
    if (!('ok' in vetted)) return { id: want.id, reason: vetted.reason };
    const role = vetted.ok;
    const raw = answer as Record<string, unknown>;
    if (raw.marker !== undefined) {
      const marker = vetMarker(raw.marker);
      if (!('ok' in marker)) warnings.push({ id: want.id, reason: marker.reason });
    }
    const text = registryDraft(role, want.server);
    const { version, checksum } = role;
    return { id: role.id, text, source: 'registry', version, server: want.server, checksum, marker: role.marker };
  } catch (error) {
    if (error instanceof RegistryItemError) return { id: want.id, reason: error.message };
    throw error;
  }
}

/** A listed id as it is printed (B249 review F5): a role id as it is; anything else through `shownValue`. */
function shownId(value: unknown): string {
  return typeof value === 'string' && ROLE_ID.test(value) ? value : shownValue(value);
}

async function fetchRoles(
  call: RegistryCall,
  locale: Locale,
  server: string,
  refused: Refused[],
  warnings: Refused[],
): Promise<RoleDraft[]> {
  const drafts: RoleDraft[] = [];
  const seen = new Set<string>();
  for (const item of listed(await call('list_roles'), 'roles')) {
    const id = typeof item.id === 'string' && ROLE_ID.test(item.id) ? item.id : undefined;
    if (id === undefined || seen.has(id)) {
      refused.push({ id: shownId(item.id), reason: id ? 'listed twice' : 'not a role id' });
      continue;
    }
    seen.add(id);
    const draft = await fetchRole(call, { id, locale, server, listed: item.checksum }, warnings);
    if ('reason' in draft) refused.push(draft);
    else drafts.push(draft);
  }
  return drafts;
}

async function registryDrafts(config: SdlcConfig, locale: Locale, result: SyncResult): Promise<RoleDraft[]> {
  const server = registryServer(config);
  if (!server) return [];
  try {
    const warnings = result.warnings ?? [];
    const drafts = await withRegistry(server, (call) => fetchRoles(call, locale, server.name, result.refused, warnings));
    if (warnings.length > 0) result.warnings = warnings;
    result.registry = { server: server.name, reachable: true, roles: drafts.map((draft) => draft.id) };
    return drafts;
  } catch (error) {
    if (error instanceof RegistryToolsMissing) throw error;
    result.registry = { server: server.name, reachable: false, roles: [], error: failure(error) };
    return [];
  }
}

/** The drafts of the packs; each pack's outcome goes to `result.packs`, a role refused by its check to `refused`. */
function packSources(root: string, config: SdlcConfig, locale: Locale, result: SyncResult): RoleDraft[] {
  if (!config.packs || config.packs.length === 0) return [];
  const found = packDrafts(root, config, locale);
  result.packs = found.reports;
  result.refused.push(...found.refused);
  return found.drafts;
}

/** True when the accepted role is the same version of the draft's source, whatever its marker. */
function sameVersion(entry: TeamEntry | undefined, draft: RoleDraft): boolean {
  const same = entry?.version === draft.version && entry?.checksum === draft.checksum;
  return entry?.source === draft.source && same;
}

/** B316: the registry gives a marker the accepted role does not have (accepted before 0.32.0, or another one). */
function markerDiffers(entry: { marker?: SourceMarker } | undefined, draft: RoleDraft): boolean {
  if (!draft.marker) return false;
  return entry?.marker?.key !== draft.marker.key || entry?.marker?.value !== draft.marker.value;
}

/** True when the accepted role is what the draft would bring: a built-in, or the same version and marker. */
function acceptedCovers(entry: TeamEntry | undefined, draft: RoleDraft): boolean {
  if (draft.source === 'builtin') return true;
  return sameVersion(entry, draft) && !markerDiffers(entry, draft);
}

/** Why an existing draft stays: the same version, someone's edits, or a draft sdlc did not record. */
function keepDraft(team: TeamRecord, draft: RoleDraft, current: string): KeptReason | undefined {
  const record = team.drafts[draft.id];
  if (!record) return draft.source !== 'builtin' && builtinVersion(draft.id, current) ? undefined : 'draft';
  const sameItem = record.kind === draft.source && record.version === draft.version
    && record.checksum === draft.checksum;
  const same = sameItem && !markerDiffers(record, draft);
  if (same || (record.kind !== 'builtin' && draft.source === 'builtin')) return 'draft';
  return normalizeNewlines(record.text) === normalizeNewlines(current) ? undefined : 'edited';
}

function placeDraft(root: string, team: TeamRecord, draft: RoleDraft, result: SyncResult): boolean {
  const accepted = fs.existsSync(path.join(root, acceptedPath(draft.id)));
  const entry = team.roles[draft.id];
  if (accepted && acceptedCovers(entry, draft)) {
    result.kept.push({ id: draft.id, reason: 'accepted' });
    return false;
  }
  const markerOnly = accepted && sameVersion(entry, draft);
  const placed = markerOnly ? markerOnlyDraft(root, draft) : draft;
  const current = readText(path.join(root, draftPath(draft.id)));
  const keep = current === undefined ? undefined : keepDraft(team, placed, current);
  if (keep) {
    result.kept.push({ id: draft.id, reason: keep });
    // Review F2: a kept draft is marker-only only when it already carries the registry's marker.
    if (markerOnly && keep === 'draft' && !markerDiffers(team.drafts[draft.id], draft)) markOnly(result, draft.id);
    return false;
  }
  writeTextAtomic(path.join(root, draftPath(draft.id)), placed.text);
  const { server, version, checksum, marker } = placed;
  const pack = placed.pack ? { pack: placed.pack } : {};
  team.drafts[draft.id] = { kind: placed.source, ...pack, server, version, checksum, marker, text: placed.text };
  result.created.push(draftPath(draft.id));
  if (markerOnly) markOnly(result, draft.id);
  return true;
}

function markOnly(result: SyncResult, id: string): void {
  (result.markerOnly ??= []).push(id);
}

/**
 * Review F1: a draft that differs only by the marker is the accepted role's own text, so accepting it keeps what a
 * person added (its project rules) and changes only the marker that team.json records.
 */
function markerOnlyDraft(root: string, draft: RoleDraft): RoleDraft {
  const own = readText(path.join(root, acceptedPath(draft.id)));
  return own === undefined ? draft : { ...draft, text: own };
}

/** Writes the drafts; never overwrites an accepted role, a draft of the same version or an edited draft. */
export async function syncTeam(root: string, config: SdlcConfig): Promise<SyncResult> {
  const packs = (config.packs ?? []).length > 0;
  // With packs the sync ends with a refresh that reads the roles: a refused one stops it first (B249 review F3).
  if (packs) assertRolesReadable(root);
  const locale = teamLocale(config);
  const result: SyncResult = { locale, created: [], kept: [], refused: [] };
  const team = readTeam(root);
  const fromRegistry = await registryDrafts(config, locale, result);
  const taken = new Set(fromRegistry.map((draft) => draft.id));
  const fromPacks = packSources(root, config, locale, result).filter((draft) => !taken.has(draft.id));
  for (const draft of fromPacks) taken.add(draft.id);
  const builtins = builtinSource.drafts(locale).filter((draft) => !taken.has(draft.id));
  let wrote = false;
  const drafts = [...fromRegistry, ...fromPacks, ...builtins];
  for (const draft of drafts) wrote = placeDraft(root, team, draft, result) || wrote;
  if (wrote) writeTeam(root, team);
  // A new version of a pack is not in effect until accepted: the skills of its old workflows go (B18).
  if (packs) refreshPackWorkflows(root, config);
  return result;
}
