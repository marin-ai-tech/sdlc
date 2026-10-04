import * as fs from 'node:fs';
import * as path from 'node:path';
import { agentEnvironment } from './agent-env.js';
import { loadConfig, saveConfig } from './config.js';
import { SdlcError } from './errors.js';
import { formatIdentity, git, gitIdentity, headCommit } from './git.js';
import { planConversion, applyConversion, type ConvertPlan } from './layout.js';
import { appendLog } from './log.js';
import { projectPaths } from './project.js';
import type { HarnessStamp } from './license.js';

export interface WorktreeResult {
  plan: ConvertPlan;
  applied: boolean;
  mode: 'worktree';
  worktree?: { path: string; branch: string; commit: string };
  warnings: string[];
}

function requireGit(root: string, args: string[]): string {
  const result = git(root, args);
  if (!result.ok) throw new SdlcError(
    'git_error',
    { key: 'error.git_x_failed', params: { detail: result.stderr || `git ${args[0]} failed` } }
  );
  return result.stdout;
}

export function convertInWorktree(root: string, stamp: HarnessStamp, options: { worktree?: string; branch?: string }): WorktreeResult {
  if (agentEnvironment()) throw new SdlcError(
      'agent_cannot_commit',
      { key: 'error.an_agent_session_cannot_commit_a_layout_conversi' },
      { key: 'fix.run_sdlc_layout_convert_apply_yourself_in_your_t' }
    );
  const branch = options.branch ?? 'sdlc/layout-convert';
  const target = path.resolve(options.worktree ?? path.join(path.dirname(root), `${path.basename(root)}-layout-convert`));
  if (git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]).ok)
    throw new SdlcError('branch_exists', { key: 'error.branch_already_exists_x', params: { branch: branch } });
  if (fs.existsSync(target)) throw new SdlcError(
    'worktree_exists',
    { key: 'error.worktree_path_already_exists_x', params: { target: target } }
  );
  const warnings: string[] = [];
  if (requireGit(root, ['status', '--porcelain', '--untracked-files=all']))
    warnings.push('Uncommitted changes in the main working copy are not included.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  requireGit(root, ['worktree', 'add', '-b', branch, target, 'HEAD']);
  let keep = false;
  try {
    const configPath = projectPaths(target).sdlcConfig;
    const config = loadConfig(configPath);
    const plan = planConversion(target, config);
    if (plan.conflicts.length) throw new SdlcError(
      'conversion_conflict',
      { key: 'error.conversion_plan_has_conflicts_x', params: { p1: plan.conflicts.map((c) => `${c.from} -> ${c.to} (${c.reason})`).join('; ') } }
    );
    if (!plan.moves.length && !plan.linkRewrites.length) {
      warnings.push('Nothing to convert.');
      return { plan, applied: false, mode: 'worktree', warnings };
    }
    applyConversion(target, config, plan);
    saveConfig(configPath, config);
    const by = formatIdentity(gitIdentity(target));
    appendLog(target, config, { event: 'layout.converted', ...(by ? { by } : {}), detail: `Moved ${plan.moves.length} role(s); rewrote ${plan.linkRewrites.length} file(s).` }, stamp);
    requireGit(target, ['add', '-A']);
    const body = plan.moves.map((move) => `${move.from} -> ${move.to}`).join('\n');
    requireGit(target, ['commit', '-m', 'docs: convert layout to the AI-ready structure', '-m', body || 'Rewrite layout links.']);
    const commit = headCommit(target);
    if (!commit) throw new SdlcError('git_error', { key: 'error.could_not_read_conversion_commit' });
    keep = true;
    return { plan, applied: true, mode: 'worktree', worktree: { path: target, branch, commit }, warnings };
  } finally {
    if (!keep) {
      requireGit(root, ['worktree', 'remove', '--force', target]);
      requireGit(root, ['branch', '-D', branch]);
    }
  }
}
