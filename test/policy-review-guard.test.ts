import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { humanEnv, read, runCli, tempDir, write } from './helpers.js';

/**
 * B75 (0.11.1): the review policy, the sdlc schema and OpenSpec's artifact rules decide what a review checks and what
 * an artifact must contain. An agent that could edit them could drop the security pass or the rule that a requirement
 * needs a scenario. They are guard files (rule `guard-config`, also in warn mode): REVIEW.md and its usual places, the
 * path set in `review.policy`, `openspec/schemas/sdlc/**` and `openspec/config.yaml`. The CLI still writes them.
 */

function project(policy?: string) {
  const root = tempDir('sdlc-review-guard-');
  for (const rel of ['REVIEW.md', 'docs/REVIEW.md', '.github/REVIEW.md', 'quality/review-policy.md',
    'openspec/schemas/sdlc/schema.yaml', 'openspec/schemas/sdlc/templates/plan.md', 'openspec/config.yaml',
    'docs/notes.md', 'openspec/changes/a/review.md']) {
    write(path.join(root, rel), 'x\n');
  }
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  config.enforcement.requireApprovedPlan = false;
  if (policy) config.review.policy = policy;
  const ctx = { paths: projectPaths(root), config };
  const edit = (rel: string) =>
    evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, rel) }, root), ctx);
  const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
  return { edit, shell };
}

const DENY = { decision: 'deny', rule: 'guard-config' };

describe('the review policy, the schema and the artifact rules', () => {
  it('cannot be edited by an agent, also in warn mode', () => {
    const p = project();
    for (const rel of ['REVIEW.md', 'docs/REVIEW.md', '.github/REVIEW.md', 'openspec/schemas/sdlc/schema.yaml',
      'openspec/schemas/sdlc/templates/plan.md', 'openspec/config.yaml']) {
      expect(p.edit(rel), rel).toMatchObject(DENY);
    }
  });

  it('follow review.policy when the policy lives elsewhere', () => {
    const p = project('quality/review-policy.md');
    expect(p.edit('quality/review-policy.md')).toMatchObject(DENY);
  });

  it('cannot be rewritten or removed from the shell', () => {
    const p = project();
    for (const command of [
      "sed -i '/security/d' REVIEW.md",
      'rm -rf openspec/schemas',
      'echo "rules: {}" > openspec/config.yaml',
    ]) {
      expect(p.shell(command), command).toMatchObject(DENY);
    }
  });

  it('negative: a change\'s review.md and other documents stay editable', () => {
    const p = project();
    expect(p.edit('openspec/changes/a/review.md').decision).toBe('allow');
    expect(p.edit('docs/notes.md').decision).toBe('allow');
    expect(p.shell('cat REVIEW.md').decision).toBe('allow');
  });
});

describe('the CLI still writes them', () => {
  it('init creates the review policy, the schema and the OpenSpec config', () => {
    const root = tempDir('sdlc-review-guard-init-');
    const env = humanEnv(tempDir('sdlc-home-'));
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    expect(read(path.join(root, 'REVIEW.md')).length).toBeGreaterThan(0);
    expect(read(path.join(root, 'openspec/schemas/sdlc/schema.yaml')).length).toBeGreaterThan(0);
    expect(read(path.join(root, 'openspec/config.yaml')).length).toBeGreaterThan(0);
  }, 120000);
});
