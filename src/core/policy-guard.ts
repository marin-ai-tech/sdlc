import * as fs from 'node:fs';
import * as path from 'node:path';
import { listFilesRecursive } from './fs-utils.js';
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
 *
 * The accepted roles of the agent team (`docs/agents/<role>.md`, B72) are guard files too: an agent that could edit
 * the tester could make it pass anything. Drafts (`docs/agents/drafts/**`) stay open; accepting one is a person's
 * command. `docs` and `docs/agents` count as guard folders only while an accepted role is on disk.
 *
 * The installed skills of the agent team (the ones openspec/.sdlc/team.json records, B74) are guard files too: a
 * skill is what the agent follows, and it was checked against the registry before it was installed. Their folders
 * (`.claude/skills/<id>`, `.opencode/skills/<id>`) and every file in them; team.json is read cheaply, and a missing
 * or broken file means no team skills.
 */
/** An accepted role of the agent team: a `.md` file directly in docs/agents/ (not in docs/agents/drafts/). */
const ROLE_NAME = String.raw`docs/agents/[^/\s'"]+\.md`;
const ROLE_FILE = new RegExp(`^${ROLE_NAME}$`, 'i');
const ROLE_DIR = 'docs/agents';
/**
 * What sdlc generates for the agents (the subagents `sdlc-*`, the workflow skills and commands): an agent that could
 * edit them could rewrite the tester or the verify workflow, and the manifest would keep that as a person's edit.
 * The team's own agents and skills (names without the `sdlc` prefix) stay open.
 */
const GENERATED_NAMES = [
  String.raw`\.(?:claude|opencode)/agents/sdlc-[^/\s'"]+\.md`,
  String.raw`\.(?:claude|opencode)/skills/sdlc-[^/\s'"]+/[^\s'"]+`,
  String.raw`\.claude/commands/sdlc/[^\s'"]+`,
  String.raw`\.opencode/commands/sdlc-[^/\s'"]+\.md`,
];
/** Folders that hold generated files; with them, their parents in the tools' folders. */
const GENERATED_DIRS = ['.claude/agents', '.claude/skills', '.claude/commands', '.claude/commands/sdlc',
  '.opencode/agents', '.opencode/skills', '.opencode/commands'];
const GUARD_NAMES = [
  String.raw`openspec/sdlc\.yaml`,
  String.raw`openspec/\.sdlc/manifest\.json`,
  String.raw`\.claude/settings(?:\.[^/\s'"]+)?\.json`,
  String.raw`\.opencode/plugins/sdlc\.js`,
  String.raw`\.mcp\.json`,
  String.raw`(?:\.opencode/)?opencode\.jsonc?`,
  ROLE_NAME,
  ...GENERATED_NAMES,
].join('|');

export const GUARD_FILE = new RegExp(`^(?:${GUARD_NAMES})$`, 'i');
const TOOL_FOLDERS = [
  String.raw`\.claude(?:/(?:agents|skills|commands(?:/sdlc)?))?`,
  String.raw`\.opencode(?:/(?:plugins|agents|skills|commands))?`,
].join('|');
/** Folders whose removal, move or replacement takes guard files with it. */
const GUARD_FOLDER = new RegExp(`^(?:${TOOL_FOLDERS}|openspec(?:/\\.sdlc)?)$`, 'i');
/** The same, while accepted roles are on disk: their folders too. */
const GUARD_ROLE_FOLDER = new RegExp(`^(?:${TOOL_FOLDERS}|openspec(?:/\\.sdlc)?|docs(?:/agents)?)$`, 'i');
/** The guard files at fixed places; `.claude/settings.<name>.json` files are also read from disk. */
const FIXED_GUARD_FILES = [
  'openspec/sdlc.yaml', 'openspec/.sdlc/manifest.json', '.claude/settings.json', '.claude/settings.local.json',
  '.opencode/plugins/sdlc.js', '.mcp.json', 'opencode.json', 'opencode.jsonc', '.opencode/opencode.json',
  '.opencode/opencode.jsonc',
];
const GUARD_FOLDERS = ['.claude', '.opencode', '.opencode/plugins', 'openspec', 'openspec/.sdlc', ...GENERATED_DIRS];
/** A guard path as a word of its own: after a space, a quote, `=`, `(`, `,` or `>`, optionally after `./`. */
const PATH_START = String.raw`(?:^|[\s'"=(,>])(?:\./)?`;
const PATH_END = String.raw`(?=$|[\s'";&|),<>])`;
const GUARD_TEXT = new RegExp(`${PATH_START}(${GUARD_NAMES})${PATH_END}`, 'i');
/** A guard path that starts at a variable: `$PWD/.mcp.json`, `${CLAUDE_PROJECT_DIR}/.claude/settings.json`. */
const GUARD_VAR_TEXT = new RegExp(String.raw`\$\{?\w+\}?/(${GUARD_NAMES})${PATH_END}`, 'i');

const TEAM_FILE = 'openspec/.sdlc/team.json';
const SKILL_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const SKILL_ROOTS = ['.claude/skills', '.opencode/skills'];

/** The ids of the installed team skills in team.json; none when the file is missing or broken. */
function teamSkillIds(root: string): string[] {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(root, TEAM_FILE), 'utf-8')) as { skills?: unknown };
    const skills = raw && typeof raw.skills === 'object' && raw.skills !== null ? Object.keys(raw.skills) : [];
    return skills.filter((id) => SKILL_ID.test(id) && !/^sdlc(?:-|$)/.test(id)).sort();
  } catch {
    return [];
  }
}

interface GuardPatterns {
  file: RegExp;
  text: RegExp;
  varText: RegExp;
  /** The folders of the installed team skills, root-relative. */
  skillDirs: string[];
}

const STATIC_PATTERNS: GuardPatterns = { file: GUARD_FILE, text: GUARD_TEXT, varText: GUARD_VAR_TEXT, skillDirs: [] };
let cached: { key: string; patterns: GuardPatterns } | undefined;

function skillPatterns(ids: string[]): GuardPatterns {
  const names = `${GUARD_NAMES}|${String.raw`\.(?:claude|opencode)/skills/(?:${ids.join('|')})/[^\s'"]+`}`;
  return {
    file: new RegExp(`^(?:${names})$`, 'i'),
    text: new RegExp(`${PATH_START}(${names})${PATH_END}`, 'i'),
    varText: new RegExp(String.raw`\$\{?\w+\}?/(${names})${PATH_END}`, 'i'),
    skillDirs: SKILL_ROOTS.flatMap((dir) => ids.map((id) => `${dir}/${id}`)),
  };
}

/** The guard patterns of this project: the fixed ones, with the installed team skills when there are any. */
function patternsFor(root: string): GuardPatterns {
  const ids = teamSkillIds(root);
  if (ids.length === 0) return STATIC_PATTERNS;
  const key = `${root}\n${ids.join('|')}`;
  if (cached?.key !== key) cached = { key, patterns: skillPatterns(ids) };
  return cached.patterns;
}

/** The files of the installed team skills on disk, root-relative. */
function teamSkillFiles(root: string): string[] {
  const dirs = patternsFor(root).skillDirs;
  return dirs.flatMap((dir) => listFilesRecursive(path.join(root, dir)).map((rel) => `${dir}/${rel}`));
}

/** The accepted roles on disk (`docs/agents/*.md`), root-relative. */
function roleFiles(root: string): string[] {
  try {
    const entries = fs.readdirSync(path.join(root, ROLE_DIR), { withFileTypes: true });
    return entries.filter((entry) => entry.isFile()).map((entry) => `${ROLE_DIR}/${entry.name}`)
      .filter((rel) => ROLE_FILE.test(rel));
  } catch {
    return [];
  }
}

/** Files under a folder (two levels: `sdlc-x.md` or `sdlc-x/SKILL.md`), root-relative, that are guard files. */
function generatedFiles(root: string): string[] {
  const found: string[] = [];
  for (const dir of GENERATED_DIRS) {
    try {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isFile() && GUARD_FILE.test(rel)) found.push(rel);
        if (entry.isDirectory() && /^sdlc-/i.test(entry.name)) found.push(`${rel}/SKILL.md`);
      }
    } catch {
      // No such folder: nothing generated there.
    }
  }
  return found;
}

/** The guard files on disk and at their fixed places, root-relative. */
export function guardFiles(root: string): string[] {
  const named = new Set([...FIXED_GUARD_FILES, ...roleFiles(root), ...generatedFiles(root), ...teamSkillFiles(root)]);
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
  const roles = files.some((rel) => ROLE_FILE.test(rel)) ? ['docs', ROLE_DIR] : [];
  return folders ? [...files, ...GUARD_FOLDERS, ...roles, ...patternsFor(root).skillDirs] : files;
}

/** A folder pattern with the team skills' folders added. */
function withSkillDirs(folder: RegExp, dirs: string[]): RegExp {
  if (dirs.length === 0) return folder;
  const escaped = dirs.map((dir) => dir.replace(/[.]/g, '\\.'));
  return new RegExp(`(?:${folder.source})|^(?:${escaped.join('|')})$`, 'i');
}

/** What the shell rule protects in this project: with accepted roles on disk, also their folders. */
function guardSet(root: string): ProtectedSet {
  const patterns = patternsFor(root);
  const folder = roleFiles(root).length > 0 ? GUARD_ROLE_FOLDER : GUARD_FOLDER;
  return { file: patterns.file, folder: withSkillDirs(folder, patterns.skillDirs), candidates: guardCandidates };
}

/** Guard files an edit writes: by path (root-relative `rels`), through a symbolic link or a hard link. */
export function guardEditHits(files: string[], rels: string[], root: string, cwd: string): string[] {
  const file = patternsFor(root).file;
  return [
    ...rels.filter((rel) => file.test(rel)),
    ...linkedFiles(files, root, cwd, file),
    ...hardLinkedFiles(files, root, cwd, guardFiles),
  ];
}

/** Guard paths spelled in write segments whose directory is unknown or that start at a variable. */
function textHits(command: string, cwd: string, patterns: GuardPatterns): string[] {
  const hits: string[] = [];
  for (const segment of writeSegments(command, cwd)) {
    const spelled = segment.dir === undefined ? patterns.text.exec(segment.text) : null;
    const match = patterns.varText.exec(segment.text) ?? spelled;
    if (match) hits.push(match[1]);
  }
  return hits;
}

/** Guard files and folders a shell command writes, deletes, moves or replaces. */
export function shellGuardWrites(command: string, root: string, cwd: string): string[] {
  return [...shellWrites(command, root, cwd, guardSet(root)), ...textHits(command, cwd, patternsFor(root))];
}

/** A path in a team skill's folder (not a generated `sdlc-*` skill). */
const TEAM_SKILL_PATH = /^\.(?:claude|opencode)\/skills\/(?!sdlc-)[^/]+(?:\/|$)/i;

/** The denial of a write to the guard's configuration, naming the first path hit. */
export function guardDenial(hits: string[]): { decision: 'deny'; rule: string; reason: string } | undefined {
  if (hits.length === 0) return undefined;
  const role = ROLE_FILE.test(hits[0]) || /^docs(?:\/agents)?$/i.test(hits[0]);
  const skill = TEAM_SKILL_PATH.test(hits[0]);
  const key = role ? 'hook.guardRole' : skill ? 'hook.guardSkill' : 'hook.guardConfig';
  return { decision: 'deny', rule: 'guard-config', reason: t(key, { path: hits[0] }) };
}
