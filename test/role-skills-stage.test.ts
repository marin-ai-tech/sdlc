import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { roleSkills } from '../src/integrations/role-skills.js';
import type { RoleFile } from '../src/team/role-file.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B240: the skills an accepted team role lists are part of that role's work (E2E run of 2026-11-02, finding S11: role
 * skills stopped at install, and the stage section told the agent other skills were not for this stage). The role's
 * subagent names its installed skills, and the workflows of the stages the role owns list them. A skill that waits for
 * a person, was refused or belongs only to a role of another stage is not listed.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const TOOLS = 'claude,opencode,cursor,codex,qwen,gigacode';
const OTHER_SUBAGENTS = ['.opencode/agents', '.cursor/agents', '.qwen/agents', '.gigacode/agents'];

const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const skillSum = (files: Array<{ path: string; content: string }>) =>
  sha([...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\n${f.content}\n`).join(''));

const md = (id: string) => [{ path: 'SKILL.md', content: `---\nname: ${id}\ndescription: The ${id} skill\n---\nDo it.\n` }];
const skill = (id: string, files = md(id), checksum = skillSum(files)) =>
  ({ id, version: '1.0.0', title: id, files, checksum });
const body = (name: string) => `# Role: ${name}\n\nWork the team way.\n{{artifacts}}\n{{project}}\n`;
const role = (id: string, stages: string[], skills: string[]) => ({
  id, version: '1.0.0', title: `Team ${id}`, stages, tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'],
  readonly: false, skills, body: body(id), checksum: sha(body(id)),
});

const WITH_SCRIPT = [...md('waits'), { path: 'scripts/run.sh', content: '#!/bin/sh\necho run\n' }];
const CATALOG = [
  skill('alpha'), skill('beta'), skill('delta'), skill('waits', WITH_SCRIPT), skill('bad', md('bad'), sha('tampered')),
];

function project(roles: unknown[], stages?: Record<string, unknown>, skills = CATALOG) {
  const root = tempDir('sdlc-role-skills-');
  const file = path.join(tempDir('sdlc-registry-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ roles, skills }));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => {
    const result = runCli(args, root, env);
    expect(result.code, `${args.join(' ')}\n${result.stdout}${result.stderr}`).toBe(0);
    return result;
  };
  cli(['init', '--tools', TOOLS, '--json']);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  if (stages) config.stages = stages;
  write(sdlc, stringify(config));
  cli(['update', '--json']);
  return { root, cli, text: (rel: string) => read(path.join(root, rel)) };
}

function frontMatter(text: string): Record<string, unknown> {
  return parse(/^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'))?.[1] ?? '') as Record<string, unknown>;
}

function stageSkills(text: string): string[] {
  const line = /^- Skills for this stage: (.*)\.$/m.exec(text.replace(/\r\n/g, '\n'))?.[1] ?? '';
  return [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

describe('an accepted role with installed and uninstalled skills', () => {
  let p: ReturnType<typeof project>;

  beforeAll(() => {
    p = project([
      role('developer', ['build'], ['alpha', 'beta', 'waits', 'bad']),
      role('tester', ['test'], ['delta']),
    ], { build: { skills: ['house-rules', 'alpha'] } });
    p.cli(['team', 'sync', '--json']);
    p.cli(['team', 'accept', 'developer', '--json']);
    p.cli(['team', 'accept', 'tester', '--json']);
  }, 480000);

  it('B240.C1: the Claude Code subagent lists them in its skills field', () => {
    const front = frontMatter(p.text('.claude/agents/sdlc-developer.md'));
    expect(front.skills).toEqual(['alpha', 'beta']);
    expect(frontMatter(p.text('.claude/agents/sdlc-tester.md')).skills).toEqual(['delta']);
  });

  it.each(OTHER_SUBAGENTS)('B240.C1: %s names them in the instructions and adds no front-matter key', (dir) => {
    const text = p.text(`${dir}/sdlc-developer.md`);
    expect(text).toMatch(/Skills of this role:.*alpha.*beta/);
    expect(frontMatter(text).skills).toBeUndefined();
  });

  it.each(['.claude/skills', '.cursor/skills', '.agents/skills', '.qwen/skills', '.gigacode/skills'])(
    'B240.C1: every named skill is really in %s', (dir) => {
      for (const id of ['alpha', 'beta']) expect(fs.existsSync(path.join(p.root, dir, id, 'SKILL.md')), id).toBe(true);
    });

  it('B240.C1: the Codex subagent names them in its developer instructions', () => {
    const text = p.text('.codex/agents/sdlc-developer.toml');
    expect(text).toMatch(/Skills of this role:.*alpha.*beta/);
    expect(text).not.toMatch(/^skills\s*=/m);
  });

  it.each(['.claude/agents', ...OTHER_SUBAGENTS])('B240.C2: %s names no skill that waits or was refused', (dir) => {
    const text = p.text(`${dir}/sdlc-developer.md`);
    for (const id of ['waits', 'bad', 'delta']) expect(text, id).not.toContain(id);
  });

  it('B240.C2: the Codex subagent names no skill that waits or was refused', () => {
    const text = p.text('.codex/agents/sdlc-developer.toml');
    for (const id of ['waits', 'bad', 'delta']) expect(text, id).not.toContain(id);
  });

  it.each(['sdlc-build', 'sdlc-plan'])('B240.C4: %s lists the stage skills and the role skills, each once', (name) => {
    expect(stageSkills(p.text(`.claude/skills/${name}/SKILL.md`))).toEqual(['house-rules', 'alpha', 'beta']);
  });

  it('B240.C4: every tool gets the same stage list', () => {
    for (const file of ['.opencode/commands/sdlc-build.md', '.cursor/skills/sdlc-build/SKILL.md',
      '.agents/skills/sdlc-build/SKILL.md', '.qwen/skills/sdlc-build/SKILL.md', '.gigacode/skills/sdlc-build/SKILL.md']) {
      expect(stageSkills(p.text(file)), file).toEqual(['house-rules', 'alpha', 'beta']);
    }
  });

  it('B240.C5: a skill of a role of another stage stays in that stage', () => {
    expect(stageSkills(p.text('.claude/skills/sdlc-verify/SKILL.md'))).toEqual(['delta']);
    expect(stageSkills(p.text('.claude/skills/sdlc-build/SKILL.md'))).not.toContain('delta');
    expect(stageSkills(p.text('.claude/skills/sdlc-spec/SKILL.md'))).not.toContain('alpha');
  });

  it('B240.C6: a skill that waits or was refused is in no workflow', () => {
    for (const name of ['sdlc-build', 'sdlc-plan', 'sdlc-verify', 'sdlc-review']) {
      const listed = stageSkills(p.text(`.claude/skills/${name}/SKILL.md`));
      expect(listed, name).not.toContain('waits');
      expect(listed, name).not.toContain('bad');
    }
  });

  it('B240.C2: once a person accepts the waiting skill, the subagent and the stage list it', () => {
    p.cli(['team', 'accept', '--skill', 'waits', '--json']);
    expect(frontMatter(p.text('.claude/agents/sdlc-developer.md')).skills).toEqual(['alpha', 'beta', 'waits']);
    expect(stageSkills(p.text('.claude/skills/sdlc-build/SKILL.md'))).toEqual(['house-rules', 'alpha', 'beta', 'waits']);
  }, 120000);
});

describe('without installed team skills', () => {
  it('B240.C3, C7: generated files match those of a role that lists no skills', () => {
    const plain = project([role('developer', ['build'], [])]);
    const refused = project([role('developer', ['build'], ['bad'])]);
    for (const q of [plain, refused]) {
      q.cli(['team', 'sync', '--json']);
      q.cli(['team', 'accept', 'developer', '--json']);
    }
    const files = ['.claude/agents/sdlc-developer.md', '.opencode/agents/sdlc-developer.md',
      '.cursor/agents/sdlc-developer.md', '.codex/agents/sdlc-developer.toml', '.qwen/agents/sdlc-developer.md',
      '.gigacode/agents/sdlc-developer.md', '.claude/skills/sdlc-build/SKILL.md', '.opencode/commands/sdlc-build.md',
      '.agents/skills/sdlc-build/SKILL.md'];
    for (const file of files) {
      expect(refused.text(file), file).toBe(plain.text(file));
      expect(plain.text(file), file).not.toMatch(/Skills of this role/);
      expect(plain.text(file), file).not.toMatch(/^skills:/m);
      expect(plain.text(file), file).not.toMatch(/Skills for this stage/);
    }
  }, 480000);
});

describe('a role that lists a skill twice', () => {
  it('names it once', () => {
    const role = { id: 'developer', skills: ['a', 'a', 'b', 'gone'] } as unknown as RoleFile;
    expect(roleSkills([role], new Set(['a', 'b']))[0].skills).toEqual(['a', 'b']);
  });
});
