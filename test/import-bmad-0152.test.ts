import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

/**
 * 0.15.2: the BMAD import (found while writing the user course).
 * - `--dry-run` prints text unless `--json` is given, like every other command.
 * - Importing the same planning folder into the backlog twice adds nothing the second time (no second epic).
 * - A requirement that starts with its actor ("Policyholder can see …") reads as a requirement
 *   ("The system SHALL let the policyholder see …"), never "The system SHALL support can see".
 */

const FIXTURES = path.join(REPO_ROOT, 'test/fixtures/bmad/claims');

function project() {
  const root = tempDir('sdlc-bmad-0152-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const target = path.join(root, '_bmad-output/claims');
  fs.mkdirSync(target, { recursive: true });
  for (const file of fs.readdirSync(FIXTURES)) fs.copyFileSync(path.join(FIXTURES, file), path.join(target, file));
  return { root, cli };
}

describe('0.15.2 BMAD import', () => {
  it('--dry-run prints text without --json', () => {
    const p = project();
    const r = p.cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--dry-run']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout.trim().startsWith('{')).toBe(false);
    expect(p.cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--dry-run', '--json']).json()).toBeTruthy();
  }, 120000);

  it('importing the same folder into the backlog twice adds nothing the second time', () => {
    const p = project();
    expect(p.cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--json']).code).toBe(0);
    const before = read(path.join(p.root, 'openspec/backlog.md'));
    p.cli(['import', 'bmad', '_bmad-output/claims', '--to-backlog', '--json']);
    const after = read(path.join(p.root, 'openspec/backlog.md'));
    const epics = (text: string) => (text.match(/^## E\d+/gm) ?? []).length;
    expect(epics(after)).toBe(epics(before));
    expect(after.length).toBe(before.length);
  }, 120000);

  it('a requirement that starts with its actor reads as a requirement', () => {
    const p = project();
    fs.rmSync(path.join(p.root, '_bmad-output/claims/spec-claims-status.md'));
    fs.rmSync(path.join(p.root, '_bmad-output/claims/architecture-claims-status.md'));
    const r = p.cli(['import', 'bmad', '_bmad-output/claims', '--change', 'claims-status', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const dir = path.join(p.root, 'openspec/changes/claims-status/specs');
    const specs = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.md'))
      .map((f) => read(path.join(dir, f))).join('\n');
    expect(specs).not.toMatch(/SHALL support can/i);
    expect(specs).not.toMatch(/SHALL \w+ can\b/i);
    expect(specs).toMatch(/SHALL[^\n]*policyholder[^\n]*see/i);
  }, 120000);
});
