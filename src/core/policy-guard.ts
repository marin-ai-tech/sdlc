import * as fs from 'node:fs';
import * as path from 'node:path';
import { t } from './i18n.js';
import { hardLinkedFiles } from './policy-hardlink.js';
import { linkedFiles, shellWrites, writeSegments, type ProtectedSet } from './policy-shell.js';

/**
 * The guard's own configuration (B41). The files that switch the guard on (the enforcement mode, the Claude Code
 * hooks, the OpenCode plugin, the MCP servers, the ownership manifest) are protected like the state files: an agent
 * that could edit them could switch every rule off. Rule `guard-config` is a hard rule (it denies in `warn` too;
 * only `off`, a person's choice, allows); the sdlc CLI still writes these files (`sdlc init`, `sdlc update`).
 *
 * Covered: an edit by path, through a symbolic link or through a hard link; a shell write by the same machinery as
 * the state files (path, bare name after `cd`, glob, link, `git -C`), a folder op on the folders that hold them,
 * and the path text in a write whose directory cannot be told (`cd "$DIR"`) or that starts at a variable
 * (`$PWD/.mcp.json`). Root-relative and case-insensitive: `src/opencode.json` is not a guard file.
 */
const GUARD_NAMES = [
  String.raw`openspec/sdlc\.yaml`,
  String.raw`openspec/\.sdlc/manifest\.json`,
  String.raw`\.claude/settings(?:\.[^/\s'"]+)?\.json`,
  String.raw`\.opencode/plugins/sdlc\.js`,
  String.raw`\.mcp\.json`,
  String.raw`(?:\.opencode/)?opencode\.jsonc?`,
].join('|');

export const GUARD_FILE = new RegExp(`^(?:${GUARD_NAMES})$`, 'i');
/** Folders whose removal, move or replacement takes guard files with it. */
const GUARD_FOLDER = /^(?:\.claude|\.opencode(?:\/plugins)?|openspec(?:\/\.sdlc)?)$/i;
/** The guard files at fixed places; `.claude/settings.<name>.json` files are also read from disk. */
const FIXED_GUARD_FILES = [
  'openspec/sdlc.yaml', 'openspec/.sdlc/manifest.json', '.claude/settings.json', '.claude/settings.local.json',
  '.opencode/plugins/sdlc.js', '.mcp.json', 'opencode.json', 'opencode.jsonc', '.opencode/opencode.json',
  '.opencode/opencode.jsonc',
];
const GUARD_FOLDERS = ['.claude', '.opencode', '.opencode/plugins', 'openspec', 'openspec/.sdlc'];
/** A guard path as a word of its own: after a space, a quote, `=`, `(`, `,` or `>`, optionally after `./`. */
const PATH_START = String.raw`(?:^|[\s'"=(,>])(?:\./)?`;
const PATH_END = String.raw`(?=$|[\s'";&|),<>])`;
const GUARD_TEXT = new RegExp(`${PATH_START}(${GUARD_NAMES})${PATH_END}`, 'i');
/** A guard path that starts at a variable: `$PWD/.mcp.json`, `${CLAUDE_PROJECT_DIR}/.claude/settings.json`. */
const GUARD_VAR_TEXT = new RegExp(String.raw`\$\{?\w+\}?/(${GUARD_NAMES})${PATH_END}`, 'i');

/** The guard files on disk and at their fixed places, root-relative. */
export function guardFiles(root: string): string[] {
  const named = new Set(FIXED_GUARD_FILES);
  try {
    for (const entry of fs.readdirSync(path.join(root, '.claude'))) {
      const rel = `.claude/${entry}`;
      if (GUARD_FILE.test(rel)) named.add(rel);
    }
  } catch {
    // No .claude folder: the fixed names only.
  }
  return [...named];
}

function guardCandidates(root: string, _glob: string, folders: boolean): string[] {
  const files = guardFiles(root);
  return folders ? [...files, ...GUARD_FOLDERS] : files;
}

const GUARD_SET: ProtectedSet = { file: GUARD_FILE, folder: GUARD_FOLDER, candidates: guardCandidates };

/** Guard files an edit writes: by path (root-relative `rels`), through a symbolic link or a hard link. */
export function guardEditHits(files: string[], rels: string[], root: string, cwd: string): string[] {
  return [
    ...rels.filter((rel) => GUARD_FILE.test(rel)),
    ...linkedFiles(files, root, cwd, GUARD_FILE),
    ...hardLinkedFiles(files, root, cwd, guardFiles),
  ];
}

/** Guard paths spelled in write segments whose directory is unknown or that start at a variable. */
function textHits(command: string, cwd: string): string[] {
  const hits: string[] = [];
  for (const segment of writeSegments(command, cwd)) {
    const spelled = segment.dir === undefined ? GUARD_TEXT.exec(segment.text) : null;
    const match = GUARD_VAR_TEXT.exec(segment.text) ?? spelled;
    if (match) hits.push(match[1]);
  }
  return hits;
}

/** Guard files and folders a shell command writes, deletes, moves or replaces. */
export function shellGuardWrites(command: string, root: string, cwd: string): string[] {
  return [...shellWrites(command, root, cwd, GUARD_SET), ...textHits(command, cwd)];
}

/** The denial of a write to the guard's configuration, naming the first path hit. */
export function guardDenial(hits: string[]): { decision: 'deny'; rule: string; reason: string } | undefined {
  if (hits.length === 0) return undefined;
  return { decision: 'deny', rule: 'guard-config', reason: t('hook.guardConfig', { path: hits[0] }) };
}
