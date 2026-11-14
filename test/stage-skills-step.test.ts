import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { humanEnv, read, runCli, tempDir, write } from './helpers.js';

// OpenSpec change stage-skills-are-loaded-and-reported (B257, confirmed by the E2E run on OpenCode 2026-11-14):
// the main agent never called the role subagents, so a stage's skills reached the work only when the agent chose to
// load them. Owner's choice: a workflow of a stage with skills starts with a step that loads them, and its final
// report names what was loaded (and why one was skipped). A stage without skills gets no such step.

function project() {
  const root = tempDir('sdlc-b257-');
  const env = humanEnv(tempDir('sdlc-home-'));
  expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.stages = { build: { skills: ['test-driven-development', 'code-review-lite'] } };
  write(file, stringify(config));
  const r = runCli(['update', '--json'], root, env);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return (rel: string) => read(path.join(root, rel));
}

const LOAD = /load (the|these|this stage's) skills?[^\n]*`test-driven-development`[^\n]*`code-review-lite`/i;
const REPORT = /final (message|report)[^\n]*(skills?)[^\n]*loaded|loaded[^\n]*final (message|report)/i;

describe('B257 a stage with skills loads them first and reports them', () => {
  it.each(['.opencode/commands/sdlc-build.md', '.claude/skills/sdlc-build/SKILL.md'])('%s', (rel) => {
    const text = project()(rel);
    expect(text).toMatch(LOAD);
    expect(text).toMatch(REPORT);
  }, 180000);

  it('negative: a stage without skills gets no load step', () => {
    const file = project();
    for (const rel of ['.opencode/commands/sdlc-verify.md', '.claude/skills/sdlc-verify/SKILL.md']) {
      const text = file(rel);
      expect(text).not.toMatch(/load (the|these|this stage's) skills?/i);
    }
  }, 180000);
});
