import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B104 (0.16.2): the audit answers per period and per change.
 * - `sdlc audit --since <date>` without `--export` is the plain audit for the changes with history from that date
 *   and the commits from that date (before, --since only worked with --export). The JSON names `since`.
 * - `sdlc audit --change <id>` of an archived change also lists the commits made while it was active (the folder
 *   moved to openspec/changes/archive/<date>-<id>/; the history did not follow the rename).
 * - `sdlc audit --change <id>` gives the agents' share of the change's commits: the commits whose message has the
 *   `SDLC-Change: <id>` trailer, and how many of them also have `SDLC-Agent:` (`agentCommits: { agent, total }`).
 */

function project() {
  const root = tempDir('sdlc-audit-period-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'start add-export']);
  const commit = (file: string, message: string) => {
    write(path.join(root, file), `${Date.now()} ${Math.random()}\n`);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
  };
  return { root, cli, commit };
}

describe('B104: audit per period and per change', () => {
  it('--since without --export is the plain audit for that period', () => {
    const p = project();
    const all = p.cli(['audit', '--since', '2000-01-01', '--json']);
    expect(all.code, all.stdout + all.stderr).toBe(0);
    expect(all.json().aggregate.changes).toBe(1);
    expect(all.json().since).toBe('2000-01-01T00:00:00.000Z');
    expect(all.json().export).toBeUndefined();
    const none = p.cli(['audit', '--since', '2999-01-01', '--json']).json();
    expect(none.aggregate.changes).toBe(0);
    expect(none.aggregate.agentCommits.total).toBe(0);
    const bad = p.cli(['audit', '--since', 'last week', '--json']);
    expect(bad.code).not.toBe(0);
    expect(bad.json().status[0].code).toBe('invalid_option');
  }, 120000);

  it('negative: --since with --export still writes the evidence bundle', () => {
    const p = project();
    const out = path.join(tempDir('sdlc-audit-bundle-'), 'bundle');
    const r = p.cli(['audit', '--export', out, '--since', '2000-01-01', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().export).toBeTruthy();
    expect(fs.existsSync(out)).toBe(true);
  }, 120000);

  it('an archived change still lists the commits made while it was active', () => {
    const p = project();
    p.commit('openspec/changes/add-export/notes.md', 'notes for add-export');
    const archive = path.join(p.root, 'openspec/changes/archive');
    fs.mkdirSync(archive, { recursive: true });
    fs.renameSync(path.join(p.root, 'openspec/changes/add-export'), path.join(archive, '2026-10-12-add-export'));
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'archive add-export']);
    const subjects = p.cli(['audit', '--change', 'add-export', '--json']).json().commits
      .map((commit: { subject: string }) => commit.subject);
    const expected = ['start add-export', 'notes for add-export', 'archive add-export'];
    expect(subjects).toEqual(expect.arrayContaining(expected));
  }, 120000);

  it('--change gives the agents\' share of the change\'s commits', () => {
    const p = project();
    p.commit('src/a.js', 'feat: a\n\nSDLC-Change: add-export\nSDLC-Task: 1.1\nSDLC-Agent: claude-code');
    p.commit('src/b.js', 'feat: b\n\nSDLC-Change: add-export\nSDLC-Task: 1.2');
    p.commit('src/c.js', 'feat: c for another change\n\nSDLC-Change: other\nSDLC-Agent: codex');
    const r = p.cli(['audit', '--change', 'add-export', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().agentCommits).toEqual({ agent: 1, total: 2 });
    expect(p.cli(['audit', '--change', 'add-export']).stdout).toMatch(/1\D+2/);
  }, 120000);
});
