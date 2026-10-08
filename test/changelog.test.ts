import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * 0.12.0 (docs/ru/26, B22): `sdlc changelog` builds a readable changelog from the delta specs: ADDED -> Added,
 * MODIFIED and RENAMED -> Changed, REMOVED -> Removed. A change without deltas adds nothing.
 */

const DELTA = [
  '# Spec Delta', '', '## ADDED Requirements', '', '### Requirement: Farewell message',
  'The system SHALL say goodbye with the user\'s name.', '', '#### Scenario: Named farewell', '- **WHEN** Ada signs out',
  '- **THEN** the message is "Goodbye, Ada"', '', '## REMOVED Requirements', '', '### Requirement: Silent sign-out',
  '**Reason**: replaced by the farewell.', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-changelog-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

describe('B22: changelog from spec deltas', () => {
  it('an ADDED requirement appears under Added, a REMOVED one under Removed', () => {
    const p = project();
    expect(p.cli(['new', 'farewell', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/farewell/specs/greeting/spec.md'), DELTA);
    const json = p.cli(['changelog', '--change', 'farewell', '--json']).json();
    expect(json.added).toEqual([{ requirement: 'Farewell message', capability: 'greeting', change: 'farewell' }]);
    expect(json.removed.map((entry: { requirement: string }) => entry.requirement)).toEqual(['Silent sign-out']);
    expect(json.changed).toEqual([]);
    const text = p.cli(['changelog', '--change', 'farewell']).stdout;
    expect(text).toMatch(/### Added[\s\S]*Farewell message/);
    expect(text).not.toMatch(/### Changed/);
  }, 180000);

  it('archived changes count from the date in their folder name', () => {
    const p = project();
    const archived = path.join(p.root, 'openspec/changes/archive/2026-10-01-farewell');
    write(path.join(archived, 'specs/greeting/spec.md'), DELTA);
    write(path.join(archived, 'proposal.md'), '# Proposal\n');
    expect(p.cli(['changelog', '--since', '2026-09-01', '--json']).json().added).toHaveLength(1);
    expect(p.cli(['changelog', '--since', '2026-10-05', '--json']).json().added).toHaveLength(0);
  }, 180000);

  it('negative: a change without deltas adds nothing', () => {
    const p = project();
    expect(p.cli(['new', 'docs-only', '--json']).code).toBe(0);
    const json = p.cli(['changelog', '--change', 'docs-only', '--json']).json();
    expect(json).toMatchObject({ added: [], changed: [], removed: [] });
    expect(p.cli(['changelog', '--change', 'docs-only']).stdout).not.toMatch(/### (Added|Changed|Removed)/);
  }, 180000);
});
