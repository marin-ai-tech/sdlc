import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { suggestTrack } from '../src/core/track.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

describe('suggestTrack', () => {
  it('suggests lite only for small kinds with low risk', () => {
    for (const kind of ['bugfix', 'refactor', 'chore', 'docs'] as const) {
      expect(suggestTrack(kind, 'low').track, kind).toBe('lite');
      expect(suggestTrack(kind, 'medium').track, kind).toBe('full');
    }
    expect(suggestTrack('feature', 'low').track).toBe('full');
    expect(suggestTrack('bugfix', 'low').reasons.join(' ')).toMatch(/bugfix/);
  });

  it('negative: security, incident and high risk are always full', () => {
    expect(suggestTrack('security', 'low').track).toBe('full');
    expect(suggestTrack('incident', 'low').track).toBe('full');
    expect(suggestTrack('bugfix', 'high').track).toBe('full');
    expect(suggestTrack('bugfix', 'high').reasons.join(' ')).toMatch(/high/);
  });
});

const PLAN = '# Plan\n\n## Files that change\n- `src/a.js` (modified)\n\n## Order of work\n1. Fix.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n';
const TASKS = '# Tasks\n\n## 1. Fix\n\n- [ ] 1.1 Fix the bug and verify npm test passes\n';

function project() {
  const root = tempDir('sdlc-track-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  return { root, cli };
}

const AGENT = { CLAUDECODE: '1' };

describe('track suggestion and human confirmation (CLI)', () => {
  it('without --track: a lite suggestion is recorded, the change starts full, status tells a person how to confirm', () => {
    const { cli } = project();
    const r = cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'low', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().change).toMatchObject({ track: 'full', trackSuggestion: { track: 'lite' } });
    const status = cli(['status', '--change', 'fix-typo', '--json']).json();
    expect(status.change.track).toBe('full');
    expect(status.change.warnings.join('\n')).toMatch(/sdlc track set lite --change fix-typo/);
  });

  it('negative: a full suggestion is applied silently, with nothing to confirm', () => {
    const { cli } = project();
    const r = cli(['new', 'add-export', '--kind', 'feature', '--risk', 'low', '--json']).json();
    expect(r.change.track).toBe('full');
    expect(r.change.trackSuggestion).toBeUndefined();
    expect(cli(['status', '--change', 'add-export', '--json']).json().change.warnings.join('\n')).not.toMatch(/track set/);
  });

  it('a person passing --track lite gets lite directly', () => {
    const { cli } = project();
    const r = cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'low', '--track', 'lite', '--json']).json();
    expect(r.change.track).toBe('lite');
    expect(r.change.trackSuggestion).toBeUndefined();
  });

  it('negative: an agent passing --track lite only suggests it; the change starts full', () => {
    const { cli } = project();
    const r = cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'medium', '--track', 'lite', '--json'], AGENT);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().change.track).toBe('full');
    expect(r.json().change.trackSuggestion.track).toBe('lite');
    expect(r.json().change.trackSuggestion.reasons.join(' ')).toMatch(/agent/i);
  });

  it('a person confirms with `sdlc track set`, which is recorded and logged', () => {
    const { root, cli } = project();
    cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'low', '--json']);
    const set = cli(['track', 'set', 'lite', '--change', 'fix-typo', '--json']);
    expect(set.code, set.stderr).toBe(0);
    expect(set.json()).toMatchObject({ change: 'fix-typo', track: 'lite' });
    const status = cli(['status', '--change', 'fix-typo', '--json']).json();
    expect(status.change.track).toBe('lite');
    expect(status.change.warnings.join('\n')).not.toMatch(/track set/);
    expect(read(path.join(root, 'openspec/changes/fix-typo/.sdlc.yaml'))).toMatch(/track\.set/);
    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events).toContain('track.set');
  });

  it('negative: an agent cannot set the track', () => {
    const { cli } = project();
    cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'low', '--json']);
    const r = cli(['track', 'set', 'lite', '--change', 'fix-typo', '--json'], AGENT);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_set_track');
    expect(cli(['status', '--change', 'fix-typo', '--json']).json().change.track).toBe('full');
  });

  it('negative: the track cannot change once the plan is approved', () => {
    const { root, cli } = project();
    cli(['new', 'fix-typo', '--kind', 'bugfix', '--risk', 'low', '--track', 'lite', '--json']);
    write(path.join(root, 'openspec/changes/fix-typo/plan.md'), PLAN);
    write(path.join(root, 'openspec/changes/fix-typo/tasks.md'), TASKS);
    const approve = cli(['approve', 'plan', '--change', 'fix-typo', '--json']);
    expect(approve.code, approve.stdout + approve.stderr).toBe(0);
    const r = cli(['track', 'set', 'full', '--change', 'fix-typo', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('plan_already_approved');
  });

  it('negative: the hook denies an agent running `sdlc track set`', () => {
    const root = tempDir('sdlc-track-hook-');
    const call = normalizeToolCall('Bash', { command: 'sdlc track set lite --change fix-typo' }, root);
    expect(evaluateToolCall(call, { paths: projectPaths(root), config: defaultConfig() })).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
  });
});
