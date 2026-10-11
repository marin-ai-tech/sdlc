import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.14.7 (B86): an accepted team skill is installed for every configured tool, not only Claude Code and OpenCode:
 * `.claude/skills/<id>` (Claude Code, which OpenCode reads too; `.opencode/skills/<id>` in an OpenCode-only project),
 * `.cursor/skills/<id>` (Cursor), `.agents/skills/<id>` (Codex CLI), `.qwen/skills/<id>` (Qwen Code) and
 * `.gigacode/skills/<id>` (GigaCode). A tool that is not configured gets nothing, and the hook guards every copy.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const skillSum = (files: Array<{ path: string; content: string }>) =>
  sha([...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\n${f.content}\n`).join(''));
const BODY = '# Role: team analyst\n\nWrite requirements the corporate way.\n{{artifacts}}\n{{project}}\n';
const ELICIT = [{
  path: 'SKILL.md',
  content: '---\nname: requirements-elicitation\ndescription: Ask good questions\n---\nAsk.\n',
}];
const REGISTRY = {
  roles: [{
    id: 'analyst', version: '1.0.0', title: 'Team analyst', stages: ['plan', 'design'],
    tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false,
    skills: ['requirements-elicitation'], body: BODY, checksum: sha(BODY),
  }],
  skills: [{ id: 'requirements-elicitation', version: '2.1.0', title: 'Elicitation', files: ELICIT,
    checksum: skillSum(ELICIT) }],
};
const SKILL = 'requirements-elicitation/SKILL.md';
const ROOTS = ['.claude/skills', '.opencode/skills', '.cursor/skills', '.agents/skills', '.qwen/skills',
  '.gigacode/skills'];

function project(tools: string) {
  const root = tempDir('sdlc-team-skills-tools-');
  const file = path.join(tempDir('sdlc-registry-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(REGISTRY));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  expect(cli(['team', 'sync', '--json']).code).toBe(0);
  const accepted = cli(['team', 'accept', 'analyst', '--json']);
  expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
  const has = (dir: string) => fs.existsSync(path.join(root, dir, SKILL));
  return { root, cli, has };
}

describe('B86: team skills for every configured tool', () => {
  it('Cursor, Codex and Qwen Code each get the skill in their own folder; the others get none', () => {
    const p = project('cursor,codex,qwen');
    for (const dir of ['.cursor/skills', '.agents/skills', '.qwen/skills']) expect(p.has(dir), dir).toBe(true);
    for (const dir of ['.claude/skills', '.opencode/skills', '.gigacode/skills']) expect(p.has(dir), dir).toBe(false);
    expect(read(path.join(p.root, '.agents/skills', SKILL))).toContain('Ask.');
  }, 240000);

  it('GigaCode alone gets it under .gigacode/skills', () => {
    const p = project('gigacode');
    expect(p.has('.gigacode/skills')).toBe(true);
    expect(ROOTS.filter((dir) => dir !== '.gigacode/skills').some((dir) => p.has(dir))).toBe(false);
  }, 240000);

  it('Claude Code with Cursor: both folders; OpenCode reads the Claude copy, so no .opencode copy', () => {
    const p = project('claude,opencode,cursor');
    expect(p.has('.claude/skills')).toBe(true);
    expect(p.has('.cursor/skills')).toBe(true);
    expect(p.has('.opencode/skills')).toBe(false);
  }, 240000);

  it('the hook guards every copy, also outside .claude', () => {
    const p = project('cursor,codex');
    for (const dir of ['.cursor/skills', '.agents/skills']) {
      const input = JSON.stringify({ cwd: p.root, tool_name: 'Edit',
        tool_input: { file_path: path.join(p.root, dir, SKILL) } });
      const out = p.cli(['hook', 'pre-tool'], {}, input).stdout;
      expect(out, dir).toContain('"permissionDecision":"deny"');
      expect(out, dir).toContain('guard-config');
    }
  }, 240000);

  it('negative: sdlc team check reports the skill as installed', () => {
    const p = project('codex');
    const check = p.cli(['team', 'check', '--json']).json();
    const skill = check.skills.find((s: { id: string }) => s.id === 'requirements-elicitation');
    expect(skill).toMatchObject({ checksumOk: true, installed: true });
  }, 240000);
});
