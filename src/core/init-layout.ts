/**
 * AI-ready `sdlc init`: what kind of folder init runs in, how its documents differ from the AI-ready layout,
 * the layout action the person asked for, and that action carried out: here (scaffold, adapt) or in a new
 * git worktree that gets the whole init, the layout conversion and one commit, while the main copy stays as it is.
 * The wizard step and the text output live in src/commands/init-layout.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { defaultConfig, loadConfig, saveConfig, type SdlcConfig } from './config.js';
import { SdlcError } from './errors.js';
import { isFile, isWithin } from './fs-utils.js';
import { formatIdentity, git, gitIdentity, headCommit, isGitRepo } from './git.js';
import {
  adaptLayout,
  applyConversion,
  detectLayout,
  planConversion,
  scaffoldLayout,
  type ConvertMove,
  type LayoutMapping,
  type LayoutRoleId,
} from './layout.js';
import { addWorktree, assertWorktreeFree, removeWorktree, requireGit } from './layout-worktree.js';
import { appendLog } from './log.js';
import { projectPaths } from './project.js';

export const LAYOUT_ACTIONS = ['scaffold', 'adapt', 'worktree', 'none'] as const;
export type LayoutAction = (typeof LAYOUT_ACTIONS)[number];
export type FolderKind = 'empty' | 'existing';

/** The branch of the AI-ready worktree. */
export const AI_READY_BRANCH = 'sdlc/ai-ready';

/** Entries that leave a folder `empty`: git data, an ignore file, a license and a readme. */
const UNCOUNTED_ENTRY = /^(\.git|\.gitignore|LICENSE.*|README.*)$/i;

export interface LayoutDiagnosis {
  missing: LayoutRoleId[];
  aliases: Array<{ role: LayoutRoleId; path: string }>;
  canonical: LayoutRoleId[];
}

/** The folder as init found it, before anything is written. */
export interface FolderDescription {
  kind: FolderKind;
  /** The folder is inside a git repository. */
  git: boolean;
  /** The repository has at least one commit. */
  commit: boolean;
  diagnosis: LayoutDiagnosis;
  /** Suggested folder for the AI-ready worktree: `<parent>/<name>-ai-ready`. */
  worktreeDefault: string;
}

export interface LayoutOptions {
  layout?: string;
  worktree?: string;
  gitInit?: boolean;
}

export interface LayoutRequest {
  action: LayoutAction;
  /** Absolute path of the new worktree (action `worktree` only). */
  worktree?: string;
}

/** `layout` in `init --json`. */
export interface LayoutOutcome {
  folder: FolderKind;
  action: LayoutAction;
  created?: string[];
  diagnosis?: LayoutDiagnosis;
  worktree?: { path: string; branch: string; commit: string };
}

/** What a worktree build did besides the JSON fields, for the text output. */
export interface WorktreeNotes {
  moves: ConvertMove[];
  /** The main copy had uncommitted files; they are not in the worktree. */
  uncommitted: boolean;
}

/** Runs the whole init in a folder and returns its outcome, which carries the config it saved. */
export type InitRunner<T extends { config: SdlcConfig }> = (root: string) => Promise<T>;

export interface LayoutInit<T> {
  outcome: T;
  layout: LayoutOutcome;
  notes?: WorktreeNotes;
}

export function classifyFolder(root: string): FolderKind {
  const counted = fs.readdirSync(root).filter((name) => !UNCOUNTED_ENTRY.test(name));
  return counted.length === 0 ? 'empty' : 'existing';
}

function currentMapping(root: string): LayoutMapping {
  const file = projectPaths(root).sdlcConfig;
  if (!isFile(file)) return {};
  try {
    return loadConfig(file).layout;
  } catch {
    // An unreadable sdlc.yaml is reported by init itself.
    return {};
  }
}

/** Which roles are missing, which are under another name and which are in place (detectLayout). */
export function diagnoseLayout(root: string, mapping: LayoutMapping = currentMapping(root)): LayoutDiagnosis {
  const diagnosis: LayoutDiagnosis = { missing: [], aliases: [], canonical: [] };
  for (const found of detectLayout(root, mapping).roles) {
    if (found.status === 'missing') diagnosis.missing.push(found.role);
    else if (found.status === 'canonical') diagnosis.canonical.push(found.role);
    else diagnosis.aliases.push({ role: found.role, path: found.path ?? '' });
  }
  return diagnosis;
}

export function describeFolder(root: string): FolderDescription {
  const repo = isGitRepo(root);
  return {
    kind: classifyFolder(root),
    git: repo,
    commit: repo && headCommit(root) !== undefined,
    diagnosis: diagnoseLayout(root),
    worktreeDefault: path.join(path.dirname(root), `${path.basename(root)}-ai-ready`),
  };
}

function invalidOption(key: string, params: Record<string, string> = {}): SdlcError {
  return new SdlcError('invalid_option', { key, params });
}

export function parseLayoutAction(value: string | undefined): LayoutAction {
  if (value === undefined) return 'none';
  const known = LAYOUT_ACTIONS.find((action) => action === value);
  if (!known) throw invalidOption('error.layout_must_be_x_got_x', { value });
  return known;
}

/**
 * Checks the layout options before init writes anything. A worktree build is human-only and needs a path
 * outside the project, a git repository with a commit, a free `sdlc/ai-ready` branch and a free path.
 */
export function checkLayoutRequest(root: string, opts: LayoutOptions, agent: string | undefined): LayoutRequest {
  const action = parseLayoutAction(opts.layout);
  if (action !== 'worktree') {
    if (opts.worktree !== undefined) throw invalidOption('error.worktree_needs_layout_worktree');
    return { action };
  }
  if (agent) throw new SdlcError(
    'agent_cannot_commit',
    { key: 'error.an_agent_session_cannot_build_the_ai_ready_worktree' },
    { key: 'fix.run_sdlc_init_layout_worktree_yourself' },
  );
  if (!opts.worktree) throw invalidOption('error.layout_worktree_needs_a_path');
  if (!isGitRepo(root) || headCommit(root) === undefined) throw new SdlcError(
    'git_required',
    { key: 'error.init_worktree_needs_git_commit' },
    { key: 'fix.commit_the_project_first' },
  );
  const target = path.resolve(opts.worktree);
  if (isWithin(root, target)) throw invalidOption('error.worktree_inside_project_x', { target });
  assertWorktreeFree(root, AI_READY_BRANCH, target);
  return { action, worktree: target };
}

/** `git init` when the folder is not a repository yet; true when it ran. */
export function ensureGitRepository(root: string): boolean {
  if (isGitRepo(root)) return false;
  requireGit(root, ['init', '-q']);
  return true;
}

function logLayout(root: string, config: SdlcConfig, event: string, detail: string): void {
  const by = formatIdentity(gitIdentity(root));
  appendLog(root, config, { event, ...(by ? { by } : {}), detail });
}

/** `--layout scaffold | adapt` after init, in the folder itself; returns the documents created. */
export function applyLayoutHere(root: string, config: SdlcConfig, action: 'scaffold' | 'adapt'): string[] {
  const before = JSON.stringify(config.layout);
  const result = action === 'adapt' ? adaptLayout(root, config) : scaffoldLayout(root, config);
  if (before !== JSON.stringify(config.layout)) saveConfig(projectPaths(root).sdlcConfig, config);
  const detail = `Created ${result.created.length} document(s); kept ${result.kept.length}.`;
  logLayout(root, config, action === 'adapt' ? 'layout.adapted' : 'layout.scaffolded', detail);
  return result.created;
}

/** Moves documents found under other names to their canonical paths (git mv) and rewrites the links. */
function convertToCanonical(root: string): ConvertMove[] {
  const configPath = projectPaths(root).sdlcConfig;
  const hadConfig = isFile(configPath);
  const config = hadConfig ? loadConfig(configPath) : defaultConfig();
  const plan = planConversion(root, config);
  if (plan.conflicts.length > 0) {
    const list = plan.conflicts.map((c) => `${c.from} -> ${c.to} (${c.reason})`).join('; ');
    throw new SdlcError('conversion_conflict', { key: 'error.conversion_plan_has_conflicts_x', params: { p1: list } });
  }
  if (plan.moves.length === 0 && plan.linkRewrites.length === 0) return [];
  applyConversion(root, config, plan);
  if (hadConfig) saveConfig(configPath, config);
  return plan.moves;
}

function commitAll(top: string, moves: ConvertMove[], created: string[]): string {
  requireGit(top, ['add', '-A']);
  const body = [...moves.map((move) => `${move.from} -> ${move.to}`), ...created.map((file) => `+ ${file}`)];
  const subject = 'chore: make the project AI-ready (sdlc init)';
  requireGit(top, ['commit', '-q', '-m', subject, '-m', body.join('\n') || 'sdlc init']);
  const commit = headCommit(top);
  if (!commit) throw new SdlcError('git_error', { key: 'error.could_not_read_the_ai_ready_commit' });
  return commit;
}

/** Inside the new worktree: convert, the whole init, the missing documents, the log, one commit. */
async function populateWorktree<T extends { config: SdlcConfig }>(
  root: string,
  target: string,
  runInit: InitRunner<T>,
): Promise<{ outcome: T; commit: string; created: string[]; moves: ConvertMove[] }> {
  const inner = path.join(target, git(root, ['rev-parse', '--show-prefix']).stdout);
  const moves = convertToCanonical(inner);
  const outcome = await runInit(inner);
  const created = scaffoldLayout(inner, outcome.config).created;
  const detail = `AI-ready worktree: moved ${moves.length} document(s); created ${created.length}.`;
  logLayout(inner, outcome.config, 'layout.ai_ready', detail);
  const commit = commitAll(target, moves, created);
  return { outcome, commit, created, moves };
}

/** Rollback that never hides the failure that caused it. */
function discardWorktree(root: string, target: string): void {
  try {
    removeWorktree(root, target, AI_READY_BRANCH);
  } catch {
    fs.rmSync(target, { recursive: true, force: true });
    git(root, ['worktree', 'prune']);
    git(root, ['branch', '-D', AI_READY_BRANCH]);
  }
}

/** `git worktree add -b sdlc/ai-ready <path> HEAD`, then the AI-ready build there; any failure removes both. */
export async function buildAiReadyWorktree<T extends { config: SdlcConfig }>(
  root: string,
  target: string,
  runInit: InitRunner<T>,
): Promise<LayoutInit<T>> {
  const uncommitted = git(root, ['status', '--porcelain', '--untracked-files=all']).stdout.length > 0;
  addWorktree(root, target, AI_READY_BRANCH);
  try {
    const built = await populateWorktree(root, target, runInit);
    const worktree = { path: target, branch: AI_READY_BRANCH, commit: built.commit };
    const layout: LayoutOutcome = { folder: 'existing', action: 'worktree', created: built.created, worktree };
    return { outcome: built.outcome, layout, notes: { moves: built.moves, uncommitted } };
  } catch (error) {
    discardWorktree(root, target);
    throw error;
  }
}

/** Init with the layout request: in a new worktree, or here followed by scaffold, adapt or the diagnosis. */
export async function initWithLayout<T extends { config: SdlcConfig }>(
  root: string,
  folder: FolderDescription,
  request: LayoutRequest,
  opts: LayoutOptions,
  runInit: InitRunner<T>,
): Promise<LayoutInit<T>> {
  if (request.action === 'worktree' && request.worktree) {
    const built = await buildAiReadyWorktree(root, request.worktree, runInit);
    return { ...built, layout: { ...built.layout, folder: folder.kind } };
  }
  if (opts.gitInit) ensureGitRepository(root);
  const outcome = await runInit(root);
  if (request.action === 'scaffold' || request.action === 'adapt') {
    const created = applyLayoutHere(root, outcome.config, request.action);
    return { outcome, layout: { folder: folder.kind, action: request.action, created } };
  }
  if (folder.kind === 'empty') return { outcome, layout: { folder: 'empty', action: 'none' } };
  const diagnosis = diagnoseLayout(root, outcome.config.layout);
  return { outcome, layout: { folder: 'existing', action: 'none', diagnosis } };
}
