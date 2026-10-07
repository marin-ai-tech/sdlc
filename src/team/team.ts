import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SdlcConfig } from '../core/config.js';
import { SdlcError } from '../core/errors.js';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import type { Locale } from '../core/i18n.js';
import { refreshGeneratedFiles } from '../integrations/install.js';
import type { ApplyReport } from '../integrations/manifest.js';
import { roleStatus, type RoleStatus } from './accepted.js';
import { unifiedDiff } from './diff.js';
import { withoutSource } from './draft.js';
import {
  acceptedPath, AGENTS_DIR, draftPath, DRAFTS_DIR, readTeam, roleDigest, roleIdsIn, TEAM_PATH, writeTeam,
  type TeamEntry, type TeamRecord,
} from './record.js';
import { parseRoleFile, ROLE_ID } from './role-file.js';
import { builtinRoleText, builtinVersion, isBuiltinRole, teamLocale } from './sources.js';
import { subagentName } from './render.js';

export { syncTeam, type SyncResult } from './sync.js';

/** The team operations behind `sdlc team accept | list` (B69, B72); sync is in sync.ts, skills in skills.ts. */
export interface AcceptResult {
  role: string;
  file: string;
  team: string;
  subagent: string;
  entry: TeamEntry;
  /** The draft differs from the text its source gave (the built-in asset or the registry's role). */
  changedFromSource: boolean;
  /** A short unified diff from the source's text to the accepted one; empty when unchanged. */
  diff: string;
  /** The skills the role lists. */
  skills: string[];
  files: ApplyReport;
}

function unknownRole(id: string): SdlcError {
  return new SdlcError(
    'unknown_role',
    { key: 'error.unknown_team_role_x', params: { role: id, path: draftPath(ROLE_ID.test(id) ? id : '<role>') } },
    { key: 'fix.run_sdlc_team_sync_then_accept' }
  );
}

/** The text to accept: the draft, or (no draft) the accepted file edited since, to record it again. */
function acceptText(root: string, id: string): { text: string; fromDraft: boolean } {
  if (!ROLE_ID.test(id)) throw unknownRole(id);
  const draft = readText(path.join(root, draftPath(id)));
  if (draft !== undefined) return { text: draft, fromDraft: true };
  const accepted = readText(path.join(root, acceptedPath(id)));
  if (accepted !== undefined && roleStatus(root, id) === 'changed') return { text: accepted, fromDraft: false };
  if (!isBuiltinRole(id) && accepted === undefined) throw unknownRole(id);
  throw new SdlcError(
    'no_draft',
    { key: 'error.no_draft_of_role_x', params: { role: id, path: draftPath(id) } },
    { key: 'fix.run_sdlc_team_sync_then_accept' }
  );
}

function assertRoleFile(id: string, text: string): void {
  const declared = parseRoleFile(id, text).declaredId;
  if (declared === undefined || declared === id) return;
  throw new SdlcError(
    'invalid_role',
    { key: 'error.role_file_x_declares_id_x', params: { path: draftPath(id), found: declared, role: id } }
  );
}

/** The source's text and the accepted text to compare: the recorded draft, else the built-in asset. */
function sourcePair(team: TeamRecord, id: string, text: string, fromDraft: boolean, locale: Locale) {
  const record = fromDraft ? team.drafts[id] : undefined;
  if (record) return { before: record.text, after: text };
  if (!isBuiltinRole(id)) return undefined;
  if (builtinVersion(id, text)) return { before: text, after: text };
  const asset = builtinRoleText(id, locale);
  return asset === undefined ? undefined : { before: withoutSource(asset), after: withoutSource(text) };
}

function compareWithSource(team: TeamRecord, id: string, text: string, fromDraft: boolean, locale: Locale) {
  const pair = sourcePair(team, id, text, fromDraft, locale);
  const diff = pair ? unifiedDiff(pair.before, pair.after) : '';
  return { changedFromSource: diff !== '', diff };
}

/** What team.json records for the accepted text: where it came from (registry, pack, built-in or the project). */
function acceptedEntry(team: TeamRecord, id: string, text: string, by: string, fromDraft: boolean): TeamEntry {
  const base = { digest: roleDigest(text), by, at: new Date().toISOString() };
  const record = fromDraft ? team.drafts[id] : undefined;
  if (record?.kind === 'registry' || record?.kind === 'pack') {
    const { version, server, checksum } = record;
    const pack = record.pack ? { pack: record.pack } : {};
    return { ...base, source: record.kind, version, server, checksum, ...pack };
  }
  const previous = team.roles[id];
  const sourced = previous?.source === 'registry' || previous?.source === 'pack';
  if (!fromDraft && sourced) return { ...previous, ...base };
  const version = isBuiltinRole(id) ? builtinVersion(id, text) : undefined;
  return { ...base, source: isBuiltinRole(id) ? 'builtin' : 'local', ...(version ? { version } : {}) };
}

/** A person accepts a role: the draft becomes docs/agents/<role>.md, team.json records it, the subagents follow. */
export function acceptRole(root: string, config: SdlcConfig, id: string, by: string): AcceptResult {
  const { text, fromDraft } = acceptText(root, id);
  assertRoleFile(id, text);
  const team = readTeam(root);
  const compared = compareWithSource(team, id, text, fromDraft, teamLocale(config));
  writeTextAtomic(path.join(root, acceptedPath(id)), text);
  if (fromDraft) fs.rmSync(path.join(root, draftPath(id)), { force: true });
  const entry = acceptedEntry(team, id, text, by, fromDraft);
  team.roles[id] = entry;
  if (fromDraft) delete team.drafts[id];
  writeTeam(root, team);
  const files = refreshGeneratedFiles(root, config);
  const skills = parseRoleFile(id, text).skills;
  return { role: id, file: acceptedPath(id), team: TEAM_PATH, subagent: subagentName({ id }), entry, ...compared,
    skills, files };
}

export interface TeamListRole {
  id: string;
  title: string;
  stages: string[];
  source: string;
  status: RoleStatus;
  subagent: string | null;
}

function listed(root: string, id: string, status: RoleStatus, team: TeamRecord): TeamListRole {
  const rel = status === 'draft' ? draftPath(id) : acceptedPath(id);
  const role = parseRoleFile(id, readText(path.join(root, rel)) ?? '');
  const source = status === 'draft' ? team.drafts[id]?.kind ?? role.sourceKind : team.roles[id]?.source;
  return {
    id,
    title: role.title,
    stages: role.stages,
    source: source ?? (isBuiltinRole(id) ? 'builtin' : 'local'),
    status,
    subagent: status === 'accepted' ? subagentName(role) : null,
  };
}

/** The project's roles: accepted (or changed since) and drafted, sorted by id. */
export function listTeam(root: string): TeamListRole[] {
  const team = readTeam(root);
  const ids = new Set([...roleIdsIn(root, AGENTS_DIR), ...roleIdsIn(root, DRAFTS_DIR)]);
  const roles: TeamListRole[] = [];
  for (const id of [...ids].sort()) {
    const status = roleStatus(root, id, team);
    if (status) roles.push(listed(root, id, status, team));
  }
  return roles;
}
