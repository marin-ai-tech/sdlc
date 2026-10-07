import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * Defect found while accepting 0.11.0: the files sdlc generates for the agents — the subagents (`sdlc-verifier`,
 * `sdlc-reviewer`, the accepted roles `sdlc-<role>`), the workflow skills and commands — could be edited by the agent
 * itself. An agent could rewrite the tester or the verify workflow to pass anything, and the manifest would then keep
 * the edit as a person's. They are the guard's configuration too (rule `guard-config`, also in warn mode); a person
 * edits them, and `sdlc update` restores them.
 */

const GENERATED = [
  '.claude/agents/sdlc-verifier.md',
  '.claude/agents/sdlc-tester.md',
  '.claude/skills/sdlc-verify/SKILL.md',
  '.claude/commands/sdlc/review.md',
  '.opencode/agents/sdlc-reviewer.md',
  '.opencode/commands/sdlc-verify.md',
  '.opencode/skills/sdlc-review/SKILL.md',
];

function project() {
  const root = tempDir('sdlc-generated-guard-');
  for (const rel of [...GENERATED, '.claude/agents/my-helper.md', '.claude/skills/team-style/SKILL.md']) {
    write(path.join(root, rel), 'x\n');
  }
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  config.enforcement.requireApprovedPlan = false;
  const ctx = { paths: projectPaths(root), config };
  const edit = (rel: string) =>
    evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, rel) }, root), ctx);
  const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
  return { edit, shell };
}

describe('files sdlc generates for the agents', () => {
  it('cannot be edited by an agent, also in warn mode', () => {
    const p = project();
    for (const rel of GENERATED) expect(p.edit(rel), rel).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it('cannot be rewritten or removed from the shell', () => {
    const p = project();
    for (const command of [
      "sed -i 's/FAIL/PASS/' .claude/agents/sdlc-tester.md",
      'rm .claude/skills/sdlc-verify/SKILL.md',
      'rm -rf .claude/agents',
      'echo pass > .opencode/agents/sdlc-reviewer.md',
    ]) {
      expect(p.shell(command), command).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    }
  });

  it('negative: the team\'s own agents and skills stay editable', () => {
    const p = project();
    expect(p.edit('.claude/agents/my-helper.md').decision).toBe('allow');
    expect(p.edit('.claude/skills/team-style/SKILL.md').decision).toBe('allow');
    expect(p.shell('cat .claude/agents/sdlc-tester.md').decision).toBe('allow');
  });
});
