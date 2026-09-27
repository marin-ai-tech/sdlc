import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function git(cwd: string, args: string[]): GitResult {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

export function isGitRepo(cwd: string): boolean {
  return git(cwd, ['rev-parse', '--is-inside-work-tree']).stdout === 'true';
}

export function headCommit(cwd: string): string | undefined {
  const r = git(cwd, ['rev-parse', 'HEAD']);
  return r.ok ? r.stdout : undefined;
}

/**
 * Whether tracked or untracked files outside the given paths are modified.
 * `excludePaths` are pathspecs (e.g. `openspec/`) whose edits do not make
 * verification evidence stale - writing verification.md must not invalidate
 * the verification it records.
 */
export function isDirty(cwd: string, excludePaths: string[] = []): boolean {
  const args = ['status', '--porcelain', '--', '.', ...excludePaths.map((p) => `:(exclude)${p}`)];
  const r = git(cwd, args);
  return r.ok ? r.stdout.length > 0 : false;
}

/**
 * Content fingerprint of the working tree: the git tree id of every tracked
 * and untracked (non-ignored) file as it is on disk, excluding `excludePaths`.
 *
 * It depends only on file contents, never on commit state, so committing
 * verified code does not make the verification stale, while any content
 * change does. Computed in a throwaway index seeded from the real one, so git
 * reuses its stat cache and only rehashes modified files.
 */
export function worktreeFingerprint(cwd: string, excludePaths: string[] = []): string | undefined {
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return undefined;
  let indexPath = git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
  if (!indexPath.ok) {
    // git < 2.31 has no --path-format; --git-path is then relative to cwd.
    const rel = git(cwd, ['rev-parse', '--git-path', 'index']);
    indexPath = { ...rel, stdout: rel.ok ? path.resolve(cwd, rel.stdout) : rel.stdout };
  }
  const tmpIndex = path.join(os.tmpdir(), `sdlc-index-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  try {
    if (indexPath.ok && fs.existsSync(indexPath.stdout)) fs.copyFileSync(indexPath.stdout, tmpIndex);
    const env = { ...process.env, GIT_INDEX_FILE: tmpIndex };
    const run = (args: string[]) => spawnSync('git', args, { cwd: top.stdout, env, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
    if (run(['add', '-A', '--', '.']).status !== 0) return undefined;
    for (const p of excludePaths) run(['rm', '-r', '--cached', '-q', '--ignore-unmatch', '--', p]);
    const tree = run(['write-tree']);
    if (tree.status !== 0) return undefined;
    return `git-tree:${(tree.stdout ?? '').trim()}`;
  } finally {
    try {
      fs.rmSync(tmpIndex, { force: true });
    } catch {
      // best effort
    }
  }
}

export interface GitIdentity {
  name?: string;
  email?: string;
}

export function gitIdentity(cwd: string): GitIdentity {
  const name = git(cwd, ['config', 'user.name']);
  const email = git(cwd, ['config', 'user.email']);
  return {
    ...(name.ok && name.stdout ? { name: name.stdout } : {}),
    ...(email.ok && email.stdout ? { email: email.stdout } : {}),
  };
}

export function formatIdentity(id: GitIdentity): string | undefined {
  if (id.name && id.email) return `${id.name} <${id.email}>`;
  return id.name ?? id.email;
}

export interface CommitInfo {
  sha: string;
  author: string;
  email: string;
  date: string;
  subject: string;
}

/** Commits that touched any of the given paths, oldest first. */
export function commitsTouching(cwd: string, paths: string[]): CommitInfo[] {
  const r = git(cwd, ['log', '--reverse', '--format=%H%x1f%an%x1f%ae%x1f%aI%x1f%s', '--', ...paths]);
  if (!r.ok || !r.stdout) return [];
  return r.stdout.split('\n').map((line) => {
    const [sha, author, email, date, subject] = line.split('\x1f');
    return { sha, author, email, date, subject };
  });
}

/** Default branch guess for review diffs: origin/HEAD -> main -> master. */
export function defaultBaseRef(cwd: string): string | undefined {
  const originHead = git(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.ok && originHead.stdout) return originHead.stdout;
  for (const candidate of ['main', 'master', 'origin/main', 'origin/master']) {
    if (git(cwd, ['rev-parse', '--verify', '--quiet', candidate]).ok) return candidate;
  }
  return undefined;
}
