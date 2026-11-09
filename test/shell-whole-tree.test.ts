import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, readChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig, type SdlcConfig } from '../src/core/config.js';
import { evaluateChange } from '../src/core/lifecycle.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * B248, deletes and whole-tree writes count for the plan gate and locked tests. A delete of a project file counts like
 * a write of it; a git command that rewrites tracked files without naming them counts as a write of the whole tree for
 * those two checks only. The stand with an approved plan records the approvals as `sdlc approve` would.
 */

const ARTIFACTS: Record<string, string> = {
  'intent.md': '# Intent\n\n## Problem\nUsers cannot export data.\n',
  'proposal.md': '# Proposal\n\n## Why\nUsers need to take their data out of the product in a portable format.\n\n'
    + '## What Changes\n- export\n',
  'specs/export/spec.md': '## Purpose\nLets users export their data in a portable, documented format.\n\n'
    + '## ADDED Requirements\n### Requirement: Export\nThe system SHALL export CSV.\n\n'
    + '#### Scenario: Export works\n- **WHEN** asked\n- **THEN** CSV\n',
  'design.md': '# Design\n\n## Decisions\nCSV.\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/a.ts`\n- `src/a.test.ts`\n- `src/empty`\n',
  'tasks.md': '# Tasks\n\n## 1. Export\n- [ ] 1.1 Implement export and verify the test passes\n',
};

type Kind = 'no-plan' | 'locked' | 'approved';

function config(kind: Kind): SdlcConfig {
  const result = defaultConfig();
  result.enforcement.mode = 'block';
  result.enforcement.requireApprovedPlan = kind !== 'locked';
  result.enforcement.protectedPaths = ['src/gen/**'];
  return result;
}

function approve(root: string, ref: { id: string; dir: string; archived: boolean }, gate: 'intent' | 'spec' | 'plan',
  role: string) {
  const view = evaluateChange(root, ref, config('approved'));
  const found = view.gates.find((item) => item.id === gate)!;
  if (!found.digest) throw new Error(`${gate} not approvable: ${found.status} ${found.reason}`);
  const state = readChangeState(ref.dir);
  state.gates[gate] = { approvals: [{ role, by: 'Pat <pat@example.com>', at: new Date().toISOString(),
    digest: found.digest }] };
  writeChangeState(ref.dir, state);
}

function newStand(kind: Kind): string {
  const root = tempDir('sdlc-b248-tree-');
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: sdlc\n');
  write(path.join(root, 'openspec/sdlc.yaml'), 'version: 1\n');
  for (const file of ['src/a.ts', 'src/a.test.ts', 'src/gen/x.ts', 'src/empty/.keep', 'docs/a.md']) {
    write(path.join(root, file), 'original\n');
  }
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const dir = path.join(root, 'openspec/changes/work');
  write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
  if (kind === 'approved') for (const [file, text] of Object.entries(ARTIFACTS)) write(path.join(dir, file), text);
  writeChangeState(dir, { ...newChangeState(), kind: 'bugfix', ...(kind === 'locked' ? { tests_locked: true } : {}) });
  if (kind === 'approved') {
    const ref = { id: 'work', dir, archived: false };
    approve(root, ref, 'intent', 'product-owner');
    approve(root, ref, 'spec', 'product-owner');
    approve(root, ref, 'plan', 'engineer');
  }
  return root;
}

const stands = new Map<Kind, string>();

function decide(command: string, kind: Kind, tool = 'Bash') {
  const root = stands.get(kind) ?? newStand(kind);
  stands.set(kind, root);
  const call = normalizeToolCall(tool, { command }, root);
  const result = evaluateToolCall(call, { paths: projectPaths(root), config: config(kind) });
  return { decision: result.decision, rule: result.decision === 'allow' ? undefined : result.rule };
}

const deny = (rule: string) => ({ decision: 'deny', rule });
const allow = { decision: 'allow', rule: undefined };

describe('B248.D1: a delete before the plan', () => {
  it.each([
    ['rm src/a.ts', 'Bash'],
    ['rm -f src/a.ts', 'Bash'],
    ['rm -rf src', 'Bash'],
    ['rmdir src/empty', 'Bash'],
    ['unlink src/a.ts', 'Bash'],
    ['T=src/a.ts; rm "$T"', 'Bash'],
    ['del src\\a.ts', 'PowerShell'],
    ['erase src\\a.ts', 'PowerShell'],
    ['rd /s /q src', 'PowerShell'],
    ['Remove-Item src/a.ts', 'PowerShell'],
    ['ri src/a.ts', 'PowerShell'],
  ])('%s', (command, tool) => {
    expect(decide('echo x > src/a.ts', 'no-plan'), 'the plain write').toEqual(deny('plan-gate'));
    expect(decide(command, 'no-plan', tool), command).toEqual(deny('plan-gate'));
  });

  it('a delete of a protected path is refused as a protected path', () => {
    expect(decide('rm src/gen/x.ts', 'no-plan')).toEqual(deny('protected-path'));
    expect(decide('T=src/gen/x.ts; rm "$T"', 'no-plan')).toEqual(deny('protected-path'));
  });
});

describe('B248.D2: a delete of a test while tests are locked', () => {
  it.each([['rm src/a.test.ts'], ['unlink src/a.test.ts'], ['T=src/a.test.ts; rm "$T"']])('%s', (command) => {
    expect(decide(command, 'locked'), command).toEqual(deny('tests-locked'));
  });

  it('PowerShell', () => {
    expect(decide('Remove-Item src/a.test.ts', 'locked', 'PowerShell')).toEqual(deny('tests-locked'));
  });

  it('negative: a delete of a source file while tests are locked and no plan is required', () => {
    expect(decide('rm src/a.ts', 'locked')).toEqual(allow);
  });
});

describe('B248.D3: a delete where it is free', () => {
  it.each([['rm docs/a.md'], ['rm -rf openspec/changes/work/tmp']])('an exempt path before the plan: %s', (command) => {
    expect(decide(command, 'no-plan'), command).toEqual(allow);
  });

  it.each([['rm src/a.ts'], ['rm -rf src/empty']])('a planned file after the plan: %s', (command) => {
    expect(decide(command, 'approved'), command).toEqual(allow);
  });

  it.each([['rm /tmp/x'], ['rm -rf ../elsewhere'], ['unlink /tmp/x']])('outside the project: %s', (command) => {
    expect(decide(command, 'no-plan'), command).toEqual(allow);
  });
});

const WHOLE_TREE = ['git stash', 'git stash push', 'git stash push -m x', 'git stash save x', 'git stash pop',
  'git stash apply', 'git reset --hard', 'git reset --hard HEAD~1', 'git clean -f', 'git clean -fd', 'git clean -xdf',
  'git -C . stash', 'git --no-pager reset --hard', 'git stash -u', 'git stash --include-untracked',
  'git stash -m x', 'git stash --keep-index', 'git stash -p', 'git stash branch other'];

describe('B248.D4: whole-tree git writes', () => {
  it.each(WHOLE_TREE.map((command) => [command]))('before the plan: %s', (command) => {
    expect(decide(command, 'no-plan'), command).toEqual(deny('plan-gate'));
  });

  it.each(WHOLE_TREE.map((command) => [command]))('while tests are locked: %s', (command) => {
    expect(decide(command, 'locked'), command).toEqual(deny('tests-locked'));
  });
});

describe('B248.D5: the same git commands after the plan', () => {
  it.each(WHOLE_TREE.map((command) => [command]))('%s', (command) => {
    expect(decide(command, 'approved'), command).toEqual(allow);
  });
});

describe('B248.D6: git forms that do not touch files', () => {
  it.each([
    ['git stash list'],
    ['git stash show'],
    ['git stash show -p'],
    ['git stash drop'],
    ['git stash clear'],
    ['git reset --soft HEAD~1'],
    ['git reset -- src/a.ts'],
    ['git reset'],
    ['git clean -n'],
    ['git clean --dry-run -d'],
    ['git status'],
    ['git log --oneline -3'],
  ])('%s', (command) => {
    expect(decide(command, 'no-plan'), command).toEqual(allow);
    expect(decide(command, 'locked'), command).toEqual(allow);
  });
});

describe('Review round 1 of B248: whole-tree writes in shell bodies and other repositories', () => {
  const BODIES = [['eval git stash', 'Bash'], ["bash -c 'git stash'", 'Bash'], ['sh -c "git reset --hard"', 'Bash'],
    ['pwsh -c "git stash"', 'Bash'], ['cmd /c git stash', 'Bash'], ["bash -c 'git clean -fd'", 'Bash'],
    ['eval -- git stash pop', 'Bash']] as const;

  it.each(BODIES)('F5: before the plan: %s', (command, tool) => {
    expect(decide(command, 'no-plan', tool), command).toEqual(deny('plan-gate'));
  });

  it.each(BODIES)('F5: while tests are locked: %s', (command, tool) => {
    expect(decide(command, 'locked', tool), command).toEqual(deny('tests-locked'));
  });

  it.each([["bash -c 'git stash list'"], ['eval git clean -n']])('F5 negative: %s', (command) => {
    expect(decide(command, 'no-plan'), command).toEqual(allow);
  });

  it.each([['git -C /tmp/other stash'], ['cd /tmp/other && git clean -fd'], ['git -C ../other reset --hard']])(
    'F13, reverted in round 3 by the owner: a git command elsewhere still counts, a named limit: %s', (command) => {
      expect(decide(command, 'no-plan'), command).toEqual(deny('plan-gate'));
    },
  );
});

describe('Review round 2 of B248: a cd that may not run keeps the write in this tree', () => {
  it.each([
    ['(cd /tmp/other); git stash'],
    ['cd /tmp/other | true; git stash'],
    ['false && cd /tmp/other; git stash'],
    ['cd /tmp/does-not-exist-x; git reset --hard'],
    ['cd /tmp/other; cd -; git stash'],
    ['git -C /tmp/other --work-tree=. stash'],
    ['GIT_WORK_TREE=. git -C /tmp/other reset --hard'],
  ])('F22: %s', (command) => {
    expect(decide(command, 'no-plan'), command).toEqual(deny('plan-gate'));
  });
});
