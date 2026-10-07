import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.0, the agent team (B69, B70, B72). Roles are files in docs/agents/. `sdlc team sync` brings the built-in roles
 * (analyst, architect, developer, tester, reviewer, in the project's language) as drafts into docs/agents/drafts/;
 * `sdlc team accept <role>` — a person's command — makes a draft the role, records it in openspec/.sdlc/team.json and
 * generates the subagent `sdlc-<role>` for each tool. The generated subagent gets what sdlc knows and the role does
 * not: where to write (the artifacts of its stages) and the facts of THIS project (its checks, protected paths,
 * language). The tester and reviewer roles replace sdlc-verifier and sdlc-reviewer; the old names stay as aliases.
 * Accepted roles and team.json are protected from agents; drafts are not.
 */

const AGENT = { CLAUDECODE: '1' };

function project(options: { check: string; protectedPath: string; locale?: string }) {
  const root = tempDir('sdlc-team-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude,opencode', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'test', run: options.check, required: true }];
  config.enforcement.protected_paths = [options.protectedPath];
  if (options.locale) config.locale = options.locale;
  write(file, stringify(config));
  expect(cli(['update', '--json']).code).toBe(0);
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));
  const text = (rel: string) => read(path.join(root, rel));
  return { root, cli, exists, text };
}

describe('the agent team', () => {
  it('sync brings the built-in roles as drafts; nothing is generated before a person accepts', () => {
    const p = project({ check: 'npm run test:claims', protectedPath: 'db/migrations/**' });
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    for (const role of ['analyst', 'architect', 'developer', 'tester', 'reviewer']) {
      expect(p.exists(`docs/agents/drafts/${role}.md`), role).toBe(true);
      expect(p.exists(`docs/agents/${role}.md`), role).toBe(false);
    }
    expect(p.exists('.claude/agents/sdlc-analyst.md')).toBe(false);
    const list = p.cli(['team', 'list', '--json']).json();
    expect(list.roles.find((x: { id: string }) => x.id === 'analyst')).toMatchObject({ status: 'draft', source: 'builtin' });
  }, 180000);

  it('accept makes the role, records it and generates the subagent with this project\'s facts and artifacts', () => {
    const p = project({ check: 'npm run test:claims', protectedPath: 'db/migrations/**' });
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const accepted = p.cli(['team', 'accept', 'analyst', '--json']);
    expect(accepted.code, accepted.stdout + accepted.stderr).toBe(0);
    expect(p.exists('docs/agents/analyst.md')).toBe(true);
    expect(p.exists('docs/agents/drafts/analyst.md')).toBe(false);
    const team = JSON.parse(p.text('openspec/.sdlc/team.json'));
    expect(team.roles.analyst).toMatchObject({ source: 'builtin' });
    expect(team.roles.analyst.digest).toMatch(/^sha256:/);
    for (const rel of ['.claude/agents/sdlc-analyst.md', '.opencode/agents/sdlc-analyst.md']) {
      const agent = p.text(rel);
      expect(agent, rel).toContain('npm run test:claims');
      expect(agent, rel).toContain('db/migrations/**');
      expect(agent, rel).toContain('intent.md');
      expect(agent, rel).toMatch(/specs\//);
      expect(agent, rel).not.toContain('{{');
    }
    expect(p.text('.claude/skills/sdlc-spec/SKILL.md')).toContain('sdlc-analyst');
  }, 180000);

  it('negative: another project gets its own facts, not these', () => {
    const p = project({ check: 'pytest -q', protectedPath: 'infra/**' });
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    const agent = p.text('.claude/agents/sdlc-developer.md');
    expect(agent).toContain('pytest -q');
    expect(agent).toContain('infra/**');
    expect(agent).not.toContain('npm run test:claims');
    expect(agent).not.toContain('db/migrations/**');
  }, 180000);

  it('the roles come in the project\'s language', () => {
    const p = project({ check: 'npm test', protectedPath: 'secrets/**', locale: 'ru' });
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.text('docs/agents/drafts/tester.md')).toMatch(/Тестировщик/);
  }, 180000);

  it('the tester replaces sdlc-verifier in the verify workflow; the old name stays as an alias', () => {
    const p = project({ check: 'npm test', protectedPath: 'secrets/**' });
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'tester', '--json']).code).toBe(0);
    expect(p.text('.claude/agents/sdlc-tester.md')).toContain('verification.md');
    expect(p.text('.claude/skills/sdlc-verify/SKILL.md')).toContain('sdlc-tester');
    expect(p.exists('.claude/agents/sdlc-verifier.md')).toBe(true);
  }, 180000);

  it('accepting is a person\'s command; an edit after acceptance shows as changed', () => {
    const p = project({ check: 'npm test', protectedPath: 'secrets/**' });
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const agent = p.cli(['team', 'accept', 'tester', '--json'], AGENT);
    expect(agent.code).toBe(1);
    expect(agent.json().status[0].code).toBe('agent_cannot_approve');
    expect(p.exists('docs/agents/tester.md')).toBe(false);
    expect(p.cli(['team', 'accept', 'tester', '--json']).code).toBe(0);
    write(path.join(p.root, 'docs/agents/tester.md'), `${p.text('docs/agents/tester.md')}\nOne more rule.\n`);
    const tester = p.cli(['team', 'list', '--json']).json().roles.find((x: { id: string }) => x.id === 'tester');
    expect(tester.status).toBe('changed');
  }, 180000);

  it('negative: without accepted roles everything is as before', () => {
    const p = project({ check: 'npm test', protectedPath: 'secrets/**' });
    expect(p.exists('.claude/agents/sdlc-verifier.md')).toBe(true);
    expect(p.text('.claude/skills/sdlc-verify/SKILL.md')).toContain('sdlc-verifier');
    expect(p.exists('docs/agents')).toBe(false);
  }, 120000);
});

describe('the hook protects accepted roles', () => {
  it('denies agent edits of accepted roles and team.json, allows drafts', () => {
    const root = tempDir('sdlc-team-guard-');
    for (const rel of ['docs/agents/tester.md', 'docs/agents/drafts/tester.md', 'openspec/.sdlc/team.json']) {
      write(path.join(root, rel), 'x\n');
    }
    const config = defaultConfig();
    config.enforcement.mode = 'warn';
    config.enforcement.requireApprovedPlan = false;
    const ctx = { paths: projectPaths(root), config };
    const edit = (rel: string) =>
      evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, rel) }, root), ctx);
    const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
    expect(edit('docs/agents/tester.md')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    expect(edit('openspec/.sdlc/team.json').decision).toBe('deny');
    expect(edit('docs/agents/drafts/tester.md').decision).toBe('allow');
    expect(shell("sed -i 's/FAIL/PASS/' docs/agents/tester.md")).toMatchObject({ decision: 'deny' });
    expect(shell('sdlc team accept tester')).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
  });
});
