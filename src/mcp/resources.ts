import * as fs from 'node:fs';
import * as path from 'node:path';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { listActiveChanges } from '../core/changes.js';
import { loadConfig } from '../core/config.js';
import { readContextSources } from '../core/context-packs.js';
import { isDirectory, isWithin, toPosix } from '../core/fs-utils.js';
import { t } from '../core/i18n.js';
import { detectLayout } from '../core/layout.js';
import { projectPaths, type ProjectPaths } from '../core/project.js';
import type { ServedProject } from './projects.js';

/**
 * The resources of `sdlc mcp serve` (B48): the team's knowledge, read-only, as plain text. Context packs
 * (`sdlc://context/<file>`, without their header), living specs (`sdlc://spec/<capability>`), the artifacts of
 * active changes (`sdlc://change/<id>/<artifact>`) and documents for agents (`sdlc://doc/<path>`); with several
 * projects the URI is `sdlc://<project>/<kind>/...`. A read resolves the URI through the same list, never by joining
 * it onto the root; state, configuration, tool folders, links out of the project and big files are never offered.
 */

const MIME_TYPE = 'text/markdown';
/** Files above this size are neither listed nor read. */
export const MAX_RESOURCE_BYTES = 256 * 1024;
/** Change artifacts offered, in this order; spec deltas are not. */
const CHANGE_ARTIFACTS = ['intent', 'proposal', 'design', 'plan', 'tasks', 'review', 'verification', 'release'];
const AGENT_DOCUMENTS = ['AGENTS.md', 'CLAUDE.md'];
/** Path segments never offered: tool folders, git and the harness state. */
const DENIED_SEGMENTS = ['.claude', '.opencode', '.git', '.sdlc'];
/** File names never offered: change state, configuration and roles. */
const DENIED_NAMES = ['.sdlc.yaml', 'sdlc.yaml', 'roles.yaml', 'config.yaml'];

export interface ListedResource {
  uri: string;
  name: string;
  mimeType: string;
  _meta?: Record<string, unknown>;
}

/** One allowed file: its key (`<kind>/...`), its path, and for a context pack the text without its header. */
interface Candidate {
  key: string;
  file: string;
  body?: string;
  meta?: Record<string, unknown>;
}

interface Entry extends Candidate {
  uri: string;
  name: string;
  /** The real path of the project root the file is checked against. */
  realRoot: string;
}

/** True for a project-relative POSIX path that is state, configuration or inside a tool or git folder. */
export function isDeniedPath(rel: string): boolean {
  const parts = rel.toLowerCase().split('/');
  if (parts.some((part) => DENIED_SEGMENTS.includes(part))) return true;
  return DENIED_NAMES.includes(parts[parts.length - 1] ?? '');
}

/** The real path of an allowed file inside the real root, or undefined: missing, a link out, denied, or too big. */
function allowedFile(realRoot: string, file: string): string | undefined {
  let real: string;
  try {
    real = fs.realpathSync(file);
  } catch {
    return undefined;
  }
  if (!isWithin(realRoot, real)) return undefined;
  if (isDeniedPath(toPosix(path.relative(realRoot, real)))) return undefined;
  const stat = fs.statSync(real);
  if (!stat.isFile() || stat.size > MAX_RESOURCE_BYTES) return undefined;
  return real;
}

function contextCandidates(root: string): Candidate[] {
  return readContextSources(root).map((source) => {
    const { owner, updated, freshDays, stale } = source;
    const meta = { owner, source: source.source, updated, freshDays, stale };
    const file = path.join(root, source.path);
    return { key: `context/${path.posix.basename(source.path)}`, file, body: source.content, meta };
  });
}

/** Sub-folder names of a folder, sorted, without hidden ones. */
function folderNames(dir: string): string[] {
  if (!isDirectory(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name).sort();
}

function specCandidates(paths: ProjectPaths): Candidate[] {
  return folderNames(paths.specsDir).map((name) => {
    return { key: `spec/${name}`, file: path.join(paths.specsDir, name, 'spec.md') };
  });
}

function changeCandidates(paths: ProjectPaths): Candidate[] {
  return listActiveChanges(paths).flatMap((change) => CHANGE_ARTIFACTS.map((artifact) => {
    return { key: `change/${change.id}/${artifact}`, file: path.join(change.dir, `${artifact}.md`) };
  }));
}

/** `*.md` files of a layout folder (one level), as project-relative POSIX paths. */
function folderDocuments(root: string, rel: string): string[] {
  const dir = path.join(root, rel);
  if (!isDirectory(dir)) return [];
  const names = fs.readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.md')).sort();
  return names.map((name) => `${rel.replace(/\/$/, '')}/${name}`);
}

/** The review policy, AGENTS.md, CLAUDE.md and the AI-ready layout documents that exist, once each. */
function documentPaths(root: string, paths: ProjectPaths): string[] {
  const config = loadConfig(paths.sdlcConfig);
  const layout = detectLayout(root, config.layout).roles.flatMap((role) => {
    if (role.path === undefined) return [];
    return role.path.endsWith('/') ? folderDocuments(root, role.path) : [role.path];
  });
  const all = [config.review.policy, ...AGENT_DOCUMENTS, ...layout];
  const relative = all.map((rel) => toPosix(path.relative(root, path.resolve(root, rel))));
  const seen = new Set<string>();
  return relative.filter((rel) => {
    const key = rel.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function documentCandidates(root: string, paths: ProjectPaths): Candidate[] {
  return documentPaths(root, paths).map((rel) => ({ key: `doc/${rel}`, file: path.join(root, rel) }));
}

/** Every allowed file of one project, with its URI; `several` puts the project's name in the URI. */
function projectEntries(project: ServedProject, several: boolean): Entry[] {
  const root = project.root;
  const paths = projectPaths(root);
  const realRoot = fs.realpathSync(root);
  const candidates = [
    ...contextCandidates(root), ...specCandidates(paths), ...changeCandidates(paths),
    ...documentCandidates(root, paths),
  ];
  const prefix = several ? `${project.name}/` : '';
  const allowed = candidates.filter((candidate) => allowedFile(realRoot, candidate.file) !== undefined);
  return allowed.map((candidate) => {
    const name = `${prefix}${candidate.key}`;
    return { ...candidate, uri: `sdlc://${name}`, name, realRoot };
  });
}

function allEntries(projects: readonly ServedProject[]): Entry[] {
  const several = projects.length > 1;
  return projects.flatMap((project) => projectEntries(project, several));
}

/** resources/list: every allowed file of every served project. */
export function listResources(projects: readonly ServedProject[]): ListedResource[] {
  return allEntries(projects).map((entry) => {
    const meta = entry.meta ? { _meta: entry.meta } : {};
    return { uri: entry.uri, name: entry.name, mimeType: MIME_TYPE, ...meta };
  });
}

function refused(key: string, uri: string): McpError {
  return new McpError(ErrorCode.InvalidParams, t(key, { uri }, 'en'));
}

/**
 * resources/read: the URI is looked up in the list (an unknown one is an error), the file is checked again on its
 * real path (inside the project, allowed, at most 256 KB) and read here, in the server process.
 */
export function readResource(projects: readonly ServedProject[], uri: string) {
  const entry = allEntries(projects).find((candidate) => candidate.uri === uri);
  if (!entry) throw refused('mcp.resourceUnknown', uri);
  const real = allowedFile(entry.realRoot, entry.file);
  if (real === undefined) throw refused('mcp.resourceRefused', uri);
  const text = entry.body ?? fs.readFileSync(real, 'utf8');
  return { contents: [{ uri, mimeType: MIME_TYPE, text }] };
}
