import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir } from './helpers.js';

/**
 * B105 (0.16.1): `sdlc doctor --fix` applies the fixes that are safe because sdlc owns what they write: missing
 * generated files and an sdlc git hook that is missing or outdated (what `sdlc update` does, without --force), and a
 * starter REVIEW.md when it is missing. It never overwrites a generated file someone edited, never touches a
 * person's settings, hooks or git configuration, and lists every other fix as manual. Without --fix doctor writes
 * nothing, as before. JSON: `fixed` (the check names it repaired) and `manual` (the ones left to a person).
 */

const SKILL = '.claude/skills/sdlc-next/SKILL.md';

function gitOut(cwd: string, args: string[]): string {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout ?? '';
}

function project() {
  const root = tempDir('sdlc-doctor-fix-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const hook = gitOut(root, ['rev-parse', '--git-path', 'hooks/prepare-commit-msg']).trim();
  return { root, cli, hook: path.resolve(root, hook) };
}

describe('B105: sdlc doctor --fix', () => {
  it('restores missing generated files, the sdlc git hook and REVIEW.md', () => {
    const p = project();
    fs.rmSync(path.join(p.root, SKILL));
    fs.rmSync(p.hook);
    fs.rmSync(path.join(p.root, 'REVIEW.md'));
    const fixed = p.cli(['doctor', '--fix', '--json']);
    expect(fixed.code, fixed.stdout + fixed.stderr).toBe(0);
    expect(fixed.json().fixed.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(p.root, SKILL))).toBe(true);
    expect(fs.existsSync(p.hook)).toBe(true);
    expect(fs.existsSync(path.join(p.root, 'REVIEW.md'))).toBe(true);
    const after = p.cli(['doctor', '--json']).json();
    const generated = after.checks.find((check: { check: string }) => check.check === 'generated files');
    expect(generated.status).toBe('ok');
  }, 180000);

  it('negative: an edited generated file is kept and listed as manual', () => {
    const p = project();
    fs.appendFileSync(path.join(p.root, SKILL), '\nOur own note.\n');
    const edited = read(path.join(p.root, SKILL));
    const r = p.cli(['doctor', '--fix', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(read(path.join(p.root, SKILL))).toBe(edited);
    expect(JSON.stringify(r.json().manual)).toMatch(/generated files/);
  }, 180000);

  it('negative: a person\'s own git hook and git identity are never changed', () => {
    const p = project();
    fs.writeFileSync(p.hook, '#!/bin/sh\n# the team\'s own hook\nexit 0\n');
    git(p.root, ['config', 'user.email', '']);
    const r = p.cli(['doctor', '--fix', '--json']);
    expect(r.code).toBe(0);
    expect(read(p.hook)).toContain('the team\'s own hook');
    expect(gitOut(p.root, ['config', 'user.email']).trim()).toBe('');
    expect(JSON.stringify(r.json().manual)).toMatch(/git/);
  }, 180000);

  it('negative: doctor without --fix writes nothing', () => {
    const p = project();
    fs.rmSync(path.join(p.root, SKILL));
    const r = p.cli(['doctor', '--json']);
    expect(r.code).toBeGreaterThanOrEqual(0);
    expect(fs.existsSync(path.join(p.root, SKILL))).toBe(false);
    expect(r.json().fixed).toBeUndefined();
  }, 180000);
});
