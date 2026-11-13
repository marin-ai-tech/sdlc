import * as fs from 'node:fs';
import * as path from 'node:path';
import { readText, writeTextAtomic } from '../core/fs-utils.js';
import { sha256 } from '../integrations/manifest.js';
import { ROLE_ID } from './role-file.js';
/**
 * Where the agent team lives (B69, B70, B71, B74): accepted roles in `docs/agents/<role>.md`, drafts in
 * `docs/agents/drafts/<role>.md`, and the record of what a person accepted in `openspec/.sdlc/team.json`, written
 * only by the CLI: `{ version: 1, roles: { <id>: { digest, source, version?, server?, checksum?, by, at } },
 * skills: { <id>: { version, checksum, source, server, by, at, dir, dirs?, files: { <path>: <sha256> }, scripts } },
 * drafts: { <id>: { kind, server?, version?, checksum?, text } } }`. `drafts` keeps each draft as its source gave
 * it, so accepting shows what was changed in it since. A role, a skill or a draft from a pack (B76) also keeps
 * `pack: { pack, git | npm, ref, commit | version, integrity? }`. A pack a person accepted (B18) is in
 * `packs: { <name>: { digest, source, lenses, workflows, checks, by, at } }`: its lenses, workflows and checks are in
 * effect only while its fetched copy has that source and that digest.
 *
 * A skill is installed for every configured tool (B86), so it may live in several folders: `dirs` lists them all and
 * `dir` is the first. A record written before 0.14.7 has only `dir`; it reads as that one folder.
 */
export const AGENTS_DIR = 'docs/agents';
export const DRAFTS_DIR = 'docs/agents/drafts';
export const TEAM_PATH = 'openspec/.sdlc/team.json';
export function acceptedPath(id) {
    return `${AGENTS_DIR}/${id}.md`;
}
export function draftPath(id) {
    return `${DRAFTS_DIR}/${id}.md`;
}
/** `sha256:<hex>` of the text with its newlines normalized, as team.json records it. */
export function roleDigest(text) {
    return `sha256:${sha256(text)}`;
}
/** Where an installed skill may live: a folder of a tool's skills root (B86: every tool's). */
const SKILL_DIR = /^\.(?:claude|opencode|cursor|agents|qwen|gigacode)\/skills\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** Every folder of an installed skill: its `dirs`, or the one `dir` of an older record. */
export function skillDirs(entry) {
    return entry.dirs && entry.dirs.length > 0 ? [...entry.dirs] : [entry.dir];
}
function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function optional(raw, key) {
    return typeof raw[key] === 'string' ? { [key]: raw[key] } : {};
}
const PACK_KEYS = ['pack', 'git', 'npm', 'ref', 'commit', 'version', 'integrity'];
function packField(value) {
    const raw = object(value);
    if (!raw || typeof raw.pack !== 'string')
        return {};
    const fields = PACK_KEYS.flatMap((key) => (typeof raw[key] === 'string' ? [[key, raw[key]]] : []));
    return { pack: Object.fromEntries(fields) };
}
function entry(value) {
    const raw = object(value);
    if (!raw || typeof raw.digest !== 'string' || typeof raw.source !== 'string')
        return undefined;
    return {
        digest: raw.digest,
        source: raw.source,
        ...optional(raw, 'version'),
        ...optional(raw, 'server'),
        ...optional(raw, 'checksum'),
        ...packField(raw.pack),
        by: typeof raw.by === 'string' ? raw.by : '',
        at: typeof raw.at === 'string' ? raw.at : '',
    };
}
function fileMap(value) {
    const raw = object(value) ?? {};
    const pairs = Object.entries(raw).filter((pair) => typeof pair[1] === 'string');
    return Object.fromEntries(pairs);
}
/** The `dirs` of a record: each a skill folder, the first being `dir`; none when absent or not so. */
function dirsField(value, dir) {
    if (!Array.isArray(value))
        return {};
    const dirs = [...new Set(value.filter((item) => typeof item === 'string'))];
    const valid = dirs.length > 0 && dirs[0] === dir && dirs.every((item) => SKILL_DIR.test(item));
    return valid ? { dirs } : {};
}
function skillEntry(value) {
    const raw = object(value);
    const text = (key) => (typeof raw?.[key] === 'string' ? raw[key] : '');
    if (!raw || !text('checksum') || !SKILL_DIR.test(text('dir')))
        return undefined;
    const scripts = Array.isArray(raw.scripts) ? raw.scripts.filter((item) => typeof item === 'string') : [];
    return {
        version: text('version'), checksum: text('checksum'), source: text('source'), server: text('server'),
        by: text('by'), at: text('at'), dir: text('dir'), ...dirsField(raw.dirs, text('dir')), files: fileMap(raw.files),
        scripts, ...packField(raw.pack),
    };
}
function draftRecord(value) {
    const raw = object(value);
    const kinds = ['registry', 'builtin', 'pack'];
    if (!raw || typeof raw.text !== 'string' || !kinds.includes(String(raw.kind)))
        return undefined;
    const kind = raw.kind;
    return { kind, ...packField(raw.pack), ...optional(raw, 'server'), ...optional(raw, 'version'),
        ...optional(raw, 'checksum'), text: raw.text };
}
function strings(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function packEntry(value) {
    const raw = object(value);
    const source = packField(raw?.source).pack;
    if (!raw || typeof raw.digest !== 'string' || !source)
        return undefined;
    const text = (key) => (typeof raw[key] === 'string' ? raw[key] : '');
    return { digest: raw.digest, source, lenses: strings(raw.lenses), workflows: strings(raw.workflows),
        checks: strings(raw.checks), by: text('by'), at: text('at') };
}
function entries(value, parse) {
    const out = {};
    for (const [id, item] of Object.entries(object(value) ?? {})) {
        const parsed = parse(item);
        if (parsed && ROLE_ID.test(id))
            out[id] = parsed;
    }
    return out;
}
/** The record; an absent or unreadable file is an empty team (nothing accepted). */
export function readTeam(root) {
    const team = { version: 1, roles: {}, skills: {}, drafts: {} };
    const text = readText(path.join(root, TEAM_PATH));
    if (!text)
        return team;
    try {
        const raw = object(JSON.parse(text)) ?? {};
        const packs = entries(raw.packs, packEntry);
        return { version: 1, roles: entries(raw.roles, entry), skills: entries(raw.skills, skillEntry),
            drafts: entries(raw.drafts, draftRecord), ...(Object.keys(packs).length > 0 ? { packs } : {}) };
    }
    catch {
        return team;
    }
}
function sorted(map) {
    return Object.fromEntries(Object.keys(map).sort().map((id) => [id, map[id]]));
}
export function writeTeam(root, team) {
    const skills = Object.keys(team.skills).length > 0 ? { skills: sorted(team.skills) } : {};
    const drafts = Object.keys(team.drafts).length > 0 ? { drafts: sorted(team.drafts) } : {};
    const packs = team.packs && Object.keys(team.packs).length > 0 ? { packs: sorted(team.packs) } : {};
    const record = { version: 1, roles: sorted(team.roles), ...skills, ...drafts, ...packs };
    writeTextAtomic(path.join(root, TEAM_PATH), `${JSON.stringify(record, null, 2)}\n`);
}
/** Role ids of the `*.md` files directly in `dir` (root-relative), sorted. */
export function roleIdsIn(root, dir) {
    try {
        const found = fs.readdirSync(path.join(root, dir), { withFileTypes: true });
        const names = found.filter((e) => e.isFile() && e.name.endsWith('.md')).map((e) => e.name.slice(0, -3));
        return names.filter((name) => ROLE_ID.test(name)).sort();
    }
    catch {
        return [];
    }
}
