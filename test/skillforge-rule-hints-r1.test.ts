import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { installedSkillforgeRules, lockRuleIds } from '../src/team/skillforge-lock.js';
import { ruleRuntimes } from '../src/team/skillforge-runtimes.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// B337/B338 review round 1 (independent review of 813f9481): F1 prototype keys as tools, F2 a lock file reached
// through a linked folder or larger than the limit, F3 a lock file with a BOM, F4 a rule id listed twice, F6
// codexServesOpenCode with no rules, F7 an inline `#` comment that cmd.exe passes on as arguments, VG1 the JSON
// fields, VG3 the Codex rule folder in doctor.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const lockOf = (artifacts: unknown) => JSON.stringify({ registry: 'http://x', artifacts });
const GATES = '# People decide the gates\n\n- Never run `sdlc approve`.\n';
const GO = '# Go errors\n\n- Wrap every error.\n';
const ROLE_BODY = '# Role: team developer\n\nWrite the code.\n{{artifacts}}\n{{project}}\n';

function rule(id: string, body: string, tags: string[], paths?: string[]) {
  return { id, version: '0.1.0', description: `Rule ${id}`, tags, paths, body, checksum: sha(body) };
}

function project(tools: string, rules: unknown[]) {
  const root = tempDir('sdlc-b337r1-');
  const file = path.join(tempDir('sdlc-b337r1-data-'), 'registry.json');
  const roles = [{ id: 'developer', version: '1.0.0', title: 'Team developer', stages: ['build'],
    tools: ['read'], readonly: false, skills: [], body: ROLE_BODY, checksum: sha(ROLE_BODY) }];
  fs.writeFileSync(file, JSON.stringify({ roles, skills: [], rules }));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  write(path.join(root, 'src/app.js'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  expect(runCli(['init', '--tools', tools, '--json'], root, env).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  const run = (args: string[]) => runCli(args, root, env);
  return { root, run, at: (rel: string) => path.join(root, rel) };
}

describe('round 1, unit', () => {
  it('F1: names of Object.prototype are not runtimes', () => {
    expect(ruleRuntimes(['constructor', 'toString', '__proto__', 'hasOwnProperty'])).toEqual([]);
  });

  it('F3: a lock file that starts with a BOM is read', () => {
    expect(lockRuleIds(`﻿${lockOf({ 'rule/go-errors': {} })}`)).toEqual(['go-errors']);
  });

  it('F2: a lock file larger than the limit gives no rules', () => {
    const root = tempDir('sdlc-b337r1-lock-');
    const padding = 'x'.repeat(1024 * 1024);
    write(path.join(root, '.opencode/.skillforge-lock.json'), lockOf({ 'rule/go-errors': { padding } }));
    expect(installedSkillforgeRules(root)).toEqual([]);
  });

  it('F2: a lock file reached through a linked agent folder outside the project is not read', () => {
    const root = tempDir('sdlc-b337r1-lock-');
    const outside = tempDir('sdlc-b337r1-outside-');
    write(path.join(outside, '.skillforge-lock.json'), lockOf({ 'rule/go-errors': {} }));
    fs.symlinkSync(outside, path.join(root, '.opencode'), 'junction');
    expect(installedSkillforgeRules(root)).toEqual([]);
  });
});

describe('round 1, end to end', () => {
  it('F7, VG1: the command lines carry no inline comment; sync --json has the fields', () => {
    const p = project('opencode', [rule('people-decide-gates', GATES, ['sdlc']), rule('go-errors', GO, ['go'])]);
    const text = p.run(['team', 'sync']);
    const lines = (text.stdout + text.stderr).split('\n').filter((l) => /^\s*skillforge (sync|install) /.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toContain('#');
    const json = p.run(['team', 'sync', '--json']).json();
    expect(json.rules.install).toEqual(['skillforge install rule/people-decide-gates --runtime opencode']);
    expect(json.rules.installAll).toEqual(['skillforge sync --type rule --runtime opencode']);
    expect(json.rules.codexServesOpenCode).toBe(false);
  }, 240000);

  it('F6: codexServesOpenCode is false when the registry lists no rules', () => {
    const p = project('opencode,codex', []);
    const json = p.run(['team', 'sync', '--json']).json();
    expect(json.rules.installAll).toEqual([]);
    expect(json.rules.codexServesOpenCode).toBe(false);
  }, 240000);

  it('F4, VG1: an id listed twice is one install line and is never called not fitting', () => {
    const p = project('opencode', [rule('people-decide-gates', GATES, ['sdlc']),
      rule('people-decide-gates', GATES, ['go'])]);
    const json = p.run(['team', 'sync', '--json']).json();
    expect(json.rules.install).toEqual(['skillforge install rule/people-decide-gates --runtime opencode']);
    write(p.at('.opencode/.skillforge-lock.json'), lockOf({ 'rule/people-decide-gates': {} }));
    const check = p.run(['team', 'check', '--json']).json();
    expect(check.rulesInstalledNotFitting).toEqual([]);
  }, 240000);

  it('VG1: check --json names the installed rule that does not fit', () => {
    const p = project('opencode', [rule('go-errors', GO, ['go'])]);
    write(p.at('.opencode/.skillforge-lock.json'), lockOf({ 'rule/go-errors': {} }));
    const check = p.run(['team', 'check', '--json']).json();
    expect(check.rulesInstalledNotFitting).toEqual([{ id: 'go-errors', runtime: 'opencode',
      uninstall: 'skillforge uninstall rule/go-errors --runtime opencode' }]);
  }, 240000);

  it('VG3: rules SkillForge put in .codex/skillforge/rules reach an agent for doctor', () => {
    const p = project('codex', []);
    const teamFile = p.at('openspec/.sdlc/team.json');
    const team = fs.existsSync(teamFile) ? JSON.parse(read(teamFile)) : {};
    team.rules = { 'people-decide-gates': { version: '0.1.0', checksum: sha(GATES), server: 'roles', text: GATES } };
    write(teamFile, `${JSON.stringify(team, null, 2)}\n`);
    const before = p.run(['doctor']);
    expect(before.stdout + before.stderr).toMatch(/reach no agent/);
    write(p.at('.codex/skillforge/rules/people-decide-gates.md'), GATES);
    const after = p.run(['doctor']);
    expect(after.stdout + after.stderr).not.toMatch(/reach no agent/);
  }, 240000);
});
