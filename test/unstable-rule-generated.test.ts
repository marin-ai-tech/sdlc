import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * B282 (E25), card C3: what sdlc generates for a project's agents states the unstable-test rule. A test that fails
 * once and passes alone goes to the project's unstable list (verify.unstable) with the item that fixes it, through a
 * person's config proposal; the agent never skips, weakens or makes it optional; after a failure only the failed
 * checks are rerun with `sdlc verify --failed`.
 */

const asset = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

function rule(text: string): void {
  expect(text).toContain('sdlc verify --failed');
  expect(text).toContain('verify.unstable');
  expect(text).toMatch(/config propose/);
  expect(text).toMatch(/never skip/i);
}

describe('B282 C3: the generated text carries the unstable-test rule', () => {
  it.each([
    ['assets/workflows/verify.md'],
    ['assets/workflows/build.md'],
    ['assets/workflows/_contract.md'],
    ['assets/project/ai-ready/AGENTS.md'],
  ])('G1: %s states the rule', (rel) => {
    rule(asset(rel));
  });

  it('G2: a project initialised for Claude Code gets the rule in its verify skill', () => {
    const root = tempDir('sdlc-unstable-rule-');
    initGitRepo(root);
    write(path.join(root, 'README.md'), '# demo\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'init']);
    const r = runCli(['init', '--tools', 'claude', '--json'], root, humanEnv(tempDir('sdlc-home-')));
    expect(r.code, r.stdout + r.stderr).toBe(0);
    rule(fs.readFileSync(path.join(root, '.claude/skills/sdlc-verify/SKILL.md'), 'utf8'));
  }, 120000);

  it('G3: the committed plugin carries the rule in its verify skill', () => {
    const files = fs.readdirSync(path.join(REPO_ROOT, 'plugin'), { recursive: true, encoding: 'utf8' })
      .filter((file) => /verify/.test(file) && file.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    const texts = files.map((file) => fs.readFileSync(path.join(REPO_ROOT, 'plugin', file), 'utf8'));
    expect(texts.some((text) => text.includes('sdlc verify --failed'))).toBe(true);
  });

  it('negative G4: no generated workflow tells the agent to edit verify.unstable itself', () => {
    for (const rel of ['assets/workflows/verify.md', 'assets/workflows/build.md', 'assets/workflows/_contract.md']) {
      expect(asset(rel)).not.toMatch(/edit (openspec\/)?sdlc\.yaml/i);
    }
  });
});
