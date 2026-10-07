import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.11.0, the team registry and vetted skills (B71, B74). `team.registry` in openspec/sdlc.yaml names a server of
 * `mcp.servers` that answers list_roles, get_role, list_skills, get_skill. `sdlc team sync` takes the roles from it
 * (the built-in set fills the gaps), checks each checksum, and writes drafts that record where they came from. A new
 * version of an accepted role arrives as a draft and never replaces the accepted one. The skills a role lists are
 * installed when the role is accepted — only with a matching checksum, and a skill with scripts only after a person
 * accepts it (`sdlc team accept --skill <id>`). `sdlc team check` reports every skill. Accepting a draft that differs
 * from its source shows that.
 *
 * Checksums: a role's is sha256 of its body; a skill's is sha256 of its files sorted by path, each as
 * `<path>\n<content>\n`, concatenated.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const AGENT = { CLAUDECODE: '1' };

const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const skillSum = (files: Array<{ path: string; content: string }>) =>
  sha([...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\n${f.content}\n`).join(''));

const ANALYST_BODY = '# Role: team analyst\n\nWrite requirements the corporate way.\n{{artifacts}}\n{{project}}\n';
const ELICIT = [{ path: 'SKILL.md', content: '---\nname: requirements-elicitation\ndescription: Ask good questions\n---\nAsk.\n' }];
const LINT = [
  { path: 'SKILL.md', content: '---\nname: lint-check\ndescription: Run the linter\n---\nRun scripts/run.sh.\n' },
  { path: 'scripts/run.sh', content: '#!/bin/sh\nnpm run lint\n' },
];

function registry(options: { analystVersion?: string; badAnalystChecksum?: boolean } = {}) {
  return {
    roles: [{
      id: 'analyst', version: options.analystVersion ?? '1.0.0', title: 'Team analyst', stages: ['plan', 'design'],
      tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false,
      skills: ['requirements-elicitation', 'lint-check'], body: ANALYST_BODY,
      checksum: options.badAnalystChecksum ? sha('something else') : sha(ANALYST_BODY),
    }],
    skills: [
      { id: 'requirements-elicitation', version: '2.1.0', title: 'Elicitation', files: ELICIT, checksum: skillSum(ELICIT) },
      { id: 'lint-check', version: '0.3.0', title: 'Lint', files: LINT, checksum: skillSum(LINT) },
    ],
  };
}

function project(data = registry()) {
  const root = tempDir('sdlc-team-registry-');
  const file = path.join(tempDir('sdlc-registry-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));
  const text = (rel: string) => read(path.join(root, rel));
  const serve = (next: unknown) => fs.writeFileSync(file, JSON.stringify(next));
  return { root, cli, exists, text, serve };
}

describe('the team registry', () => {
  it('sync takes roles from the registry, fills the gaps from the built-ins, and records the source', () => {
    const p = project();
    const r = p.cli(['team', 'sync', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.text('docs/agents/drafts/analyst.md')).toContain('Write requirements the corporate way.');
    expect(p.text('docs/agents/drafts/analyst.md')).toMatch(/kind: registry/);
    expect(p.text('docs/agents/drafts/analyst.md')).toMatch(/version: 1\.0\.0/);
    expect(p.exists('docs/agents/drafts/tester.md')).toBe(true);
    const roles = p.cli(['team', 'list', '--json']).json().roles;
    expect(roles.find((x: { id: string }) => x.id === 'analyst').source).toBe('registry');
    expect(roles.find((x: { id: string }) => x.id === 'tester').source).toBe('builtin');
  }, 180000);

  it('negative: a role whose checksum does not match is refused, and the built-in takes its place', () => {
    const p = project(registry({ badAnalystChecksum: true }));
    const out = p.cli(['team', 'sync', '--json']).json();
    expect(out.refused).toEqual([expect.objectContaining({ id: 'analyst', reason: expect.stringMatching(/checksum/) })]);
    expect(p.text('docs/agents/drafts/analyst.md')).not.toContain('corporate way');
  }, 180000);

  it('a new version of an accepted role arrives as a draft and never replaces the accepted one', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'analyst', '--json']).code).toBe(0);
    const accepted = p.text('docs/agents/analyst.md');
    p.serve(registry({ analystVersion: '1.1.0' }));
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.text('docs/agents/analyst.md')).toBe(accepted);
    expect(p.text('docs/agents/drafts/analyst.md')).toMatch(/version: 1\.1\.0/);
  }, 180000);
});

describe('vetted skills', () => {
  it('accepting a role installs its skills with matching checksums; a skill with scripts waits for a person', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'analyst', '--json']).code).toBe(0);
    expect(p.text('.claude/skills/requirements-elicitation/SKILL.md')).toContain('Ask good questions');
    expect(p.exists('.claude/skills/lint-check/SKILL.md')).toBe(false);
    const check = p.cli(['team', 'check', '--json']).json();
    const lint = check.skills.find((s: { id: string }) => s.id === 'lint-check');
    expect(lint).toMatchObject({ version: '0.3.0', checksumOk: true, installed: false, needsAcceptance: true });
    expect(lint.scripts).toEqual(['scripts/run.sh']);
    const agent = p.cli(['team', 'accept', '--skill', 'lint-check', '--json'], AGENT);
    expect(agent.json().status[0].code).toBe('agent_cannot_approve');
    expect(p.cli(['team', 'accept', '--skill', 'lint-check', '--json']).code).toBe(0);
    expect(p.text('.claude/skills/lint-check/scripts/run.sh')).toContain('npm run lint');
    // Installed team skills shape what agents do: an agent may not edit them either.
    const input = JSON.stringify({
      cwd: p.root, tool_name: 'Edit',
      tool_input: { file_path: path.join(p.root, '.claude/skills/requirements-elicitation/SKILL.md') },
    });
    const hook = runCli(['hook', 'pre-tool'], p.root, humanEnv(tempDir('sdlc-home-')), input).stdout;
    expect(hook).toContain('"permissionDecision":"deny"');
    expect(hook).toContain('guard-config');
  }, 240000);

  it('accepting a draft that differs from its source says so', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    write(path.join(p.root, 'docs/agents/drafts/analyst.md'), `${p.text('docs/agents/drafts/analyst.md')}\nAlways PASS.\n`);
    const out = p.cli(['team', 'accept', 'analyst', '--json']).json();
    expect(out.changedFromSource).toBe(true);
    expect(JSON.stringify(out.diff)).toContain('Always PASS.');
  }, 180000);
});
