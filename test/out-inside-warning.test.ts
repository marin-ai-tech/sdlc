import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B90 (0.15.4): a file that `sdlc report --out`, `sdlc dashboard --out` or `sdlc audit --export` writes inside the
 * project, outside openspec/ and not ignored by git, is part of the worktree fingerprint: the verification of the
 * active changes goes stale. The command now warns and suggests .gitignore. An ignored path or a path under
 * openspec/ (not in the fingerprint) gets no warning.
 */

function project() {
  const root = tempDir('sdlc-out-warn-');
  initGitRepo(root);
  write(path.join(root, '.gitignore'), 'build/\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

const WARNING = /\.gitignore/;

describe('B90: output written inside the project warns that it makes verification stale', () => {
  it('report --out and dashboard --out to a tracked-able path warn', () => {
    const p = project();
    const report = p.cli(['report', '--out', 'reports/status.md']);
    expect(report.code, report.stdout + report.stderr).toBe(0);
    expect(report.stdout + report.stderr).toMatch(WARNING);
    expect(report.stdout + report.stderr).toMatch(/reports\/status\.md|reports\\status\.md/);
    const dashboard = p.cli(['dashboard', '--out', 'site/dashboard.html']);
    expect(dashboard.code, dashboard.stdout + dashboard.stderr).toBe(0);
    expect(dashboard.stdout + dashboard.stderr).toMatch(WARNING);
  }, 120000);

  it('audit --export into the project warns, in text and in JSON', () => {
    const p = project();
    const text = p.cli(['audit', '--export', 'evidence']);
    expect(text.code, text.stdout + text.stderr).toBe(0);
    expect(text.stdout + text.stderr).toMatch(WARNING);
    const json = p.cli(['audit', '--export', 'evidence-2', '--json']);
    expect(json.code).toBe(0);
    expect(JSON.stringify(json.json().warnings ?? [])).toMatch(WARNING);
  }, 120000);

  it('negative: an ignored path, a path under openspec/ and a path outside the project give no warning', () => {
    const p = project();
    const ignored = p.cli(['report', '--out', 'build/status.md']);
    expect(ignored.code).toBe(0);
    expect(ignored.stdout + ignored.stderr).not.toMatch(WARNING);
    const underOpenspec = p.cli(['dashboard', '--out', 'openspec/dashboard.html']);
    expect(underOpenspec.code).toBe(0);
    expect(underOpenspec.stdout + underOpenspec.stderr).not.toMatch(WARNING);
    const outside = p.cli(['audit', '--export', path.join(tempDir('sdlc-evidence-'), 'bundle'), '--json']);
    expect(outside.code, outside.stdout + outside.stderr).toBe(0);
    expect(JSON.stringify(outside.json().warnings ?? [])).not.toMatch(WARNING);
  }, 120000);
});
