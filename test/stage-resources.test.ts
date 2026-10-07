import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { humanEnv, read, runCli, tempDir, write } from './helpers.js';

/**
 * B14: skills, subagents and MCP servers per stage. `stages.<stage>.skills` and `.agents` in openspec/sdlc.yaml name
 * what a stage uses; the MCP servers of a stage come from the registry (`mcp.servers.<name>.stages`), the one source.
 * Each generated workflow of a stage lists exactly its stage's resources, and the Claude Code skill pre-allows the
 * tools of that stage's MCP servers (`mcp__<server>__*`). Workflow stages: explore and intent → plan, spec → design,
 * plan and build → build, verify → test, review and release → deploy, archive and triage → maintain.
 */

function project(stages?: Record<string, unknown>) {
  const root = tempDir('sdlc-stage-resources-');
  const env = humanEnv(tempDir('sdlc-home-'));
  expect(runCli(['init', '--tools', 'claude,opencode', '--json'], root, env).code).toBe(0);
  const before = (rel: string) => read(path.join(root, rel));
  const baseline = { skill: before('.claude/skills/sdlc-build/SKILL.md'), command: before('.opencode/commands/sdlc-build.md') };
  if (stages) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.stages = stages;
    config.mcp = {
      servers: {
        build: { type: 'stdio', command: ['corp-build-mcp'], stages: ['build', 'test'] },
        jira: { type: 'http', url: 'https://mcp.corp.example/jira', stages: ['plan', 'deploy'] },
      },
    };
    write(file, stringify(config));
    const r = runCli(['update', '--json'], root, env);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  }
  return { file: (rel: string) => read(path.join(root, rel)), baseline };
}

function allowedTools(skill: string): string {
  return /^allowed-tools: (.*)$/m.exec(skill)?.[1] ?? '';
}

const STAGES = {
  build: { skills: ['test-driven-development'], agents: ['sdlc-simplifier'] },
  design: { skills: ['architecture-review'], agents: ['sdlc-researcher'] },
};

describe('stage resources in the generated workflows', () => {
  it('a build-stage workflow lists the build skills, subagents and MCP servers, and nothing of other stages', () => {
    const p = project(STAGES);
    const skill = p.file('.claude/skills/sdlc-build/SKILL.md');
    expect(skill).toContain('test-driven-development');
    expect(skill).toContain('sdlc-simplifier');
    expect(skill).toContain('mcp__build__');
    for (const other of ['architecture-review', 'sdlc-researcher', 'mcp__jira__']) expect(skill, other).not.toContain(other);
    expect(allowedTools(skill)).toContain('mcp__build__*');
    expect(allowedTools(skill)).not.toContain('mcp__jira__');
    const command = p.file('.opencode/commands/sdlc-build.md');
    expect(command).toContain('test-driven-development');
    expect(command).not.toContain('architecture-review');
  }, 120000);

  it('each workflow gets its own stage: spec is design, intent is plan, review is deploy', () => {
    const p = project(STAGES);
    const spec = p.file('.claude/skills/sdlc-spec/SKILL.md');
    expect(spec).toContain('architecture-review');
    expect(spec).not.toContain('test-driven-development');
    expect(allowedTools(spec)).not.toContain('mcp__');
    const intent = p.file('.claude/skills/sdlc-intent/SKILL.md');
    expect(allowedTools(intent)).toContain('mcp__jira__*');
    expect(allowedTools(p.file('.claude/skills/sdlc-review/SKILL.md'))).toContain('mcp__jira__*');
    expect(allowedTools(p.file('.claude/skills/sdlc-verify/SKILL.md'))).toContain('mcp__build__*');
  }, 120000);

  it('negative: workflows without a stage, and projects without stages or servers, are unchanged', () => {
    const p = project(STAGES);
    for (const id of ['help', 'status', 'next']) {
      const skill = p.file(`.claude/skills/sdlc-${id}/SKILL.md`);
      expect(skill, id).not.toContain('test-driven-development');
      expect(allowedTools(skill), id).not.toContain('mcp__');
    }
    const plain = project();
    expect(plain.file('.claude/skills/sdlc-build/SKILL.md')).toBe(plain.baseline.skill);
    expect(plain.file('.opencode/commands/sdlc-build.md')).toBe(plain.baseline.command);
  }, 180000);
});
