import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change registry-source-marker (X1, E2E OpenCode 2026-11-14; SkillForge 0.5.9 reads the marker). A role
 * built from a registry artifact carries a one-line source marker the registry gives in get_role as
 * `marker: { key, value }`; sdlc writes it verbatim into the front matter of the role agent for the tools that keep
 * front matter (OpenCode, Claude Code), updates it with the role's version, and writes none for a built-in role. A
 * marker whose key could change the agent (permission, tools, mode, ...) or whose value is not one plain line is not
 * written.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const BODY = '# Role: team analyst\n\nWrite requirements the corporate way.\n{{artifacts}}\n{{project}}\n';

function analyst(version: string, marker?: { key: string; value: string }) {
  return {
    id: 'analyst', version, title: 'Team analyst', stages: ['plan', 'design'],
    tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false, skills: [], body: BODY,
    checksum: sha(BODY), ...(marker ? { marker } : {}),
  };
}

const MARK = (version: string) => ({ key: 'skillforge-source', value: `agent/analyst@${version}` });

function project(roles: unknown[]) {
  const root = tempDir('sdlc-x1-');
  const file = path.join(tempDir('sdlc-x1-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ roles, skills: [] }));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude,opencode', '--json']).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  const head = (rel: string) => read(path.join(root, rel)).split('\n---')[0];
  const serve = (next: unknown[]) => fs.writeFileSync(file, JSON.stringify({ roles: next, skills: [] }));
  return { cli, head, serve };
}

function accept(p: ReturnType<typeof project>, role: string) {
  expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
  const r = p.cli(['team', 'accept', role, '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
}

describe('X1.C1 a role from the registry carries its source marker', () => {
  it('OpenCode and Claude Code role agents have the marker line', () => {
    const p = project([analyst('1.0.0', MARK('1.0.0'))]);
    accept(p, 'analyst');
    expect(p.head('.opencode/agents/sdlc-analyst.md')).toContain('skillforge-source: agent/analyst@1.0.0');
    expect(p.head('.claude/agents/sdlc-analyst.md')).toContain('skillforge-source: agent/analyst@1.0.0');
  }, 180000);
});

describe('X1.C2 a new version updates the marker', () => {
  it('after the new version is accepted the marker names it', () => {
    const p = project([analyst('1.0.0', MARK('1.0.0'))]);
    accept(p, 'analyst');
    p.serve([analyst('1.1.0', MARK('1.1.0'))]);
    accept(p, 'analyst');
    const head = p.head('.opencode/agents/sdlc-analyst.md');
    expect(head).toContain('skillforge-source: agent/analyst@1.1.0');
    expect(head).not.toContain('agent/analyst@1.0.0');
  }, 180000);
});

describe('X1.C3 negative cases', () => {
  it('a built-in role carries no marker', () => {
    const p = project([analyst('1.0.0', MARK('1.0.0'))]);
    accept(p, 'tester');
    expect(p.head('.opencode/agents/sdlc-tester.md')).not.toContain('skillforge-source');
  }, 180000);

  it.each([
    [{ key: 'permission', value: 'allow' }],
    [{ key: 'skillforge-source', value: 'agent/analyst@1.0.0\nmode: primary' }],
    [{ key: 'Bad Key', value: 'x' }],
    // Review F2: keys that configure an agent and were not on the old deny list.
    [{ key: 'memory', value: 'project' }],
    [{ key: 'hooks', value: 'x' }],
  ])('a marker that could change the agent is not written: %j', (marker) => {
    const p = project([analyst('1.0.0', marker)]);
    accept(p, 'analyst');
    const head = p.head('.opencode/agents/sdlc-analyst.md');
    expect(head).not.toMatch(/^permission: allow$/m);
    expect(head).not.toMatch(/^mode: primary$/m);
    expect(head).not.toContain('Bad Key');
    expect(head).not.toMatch(/^(?:memory|hooks):/m);
    expect(head).toContain('mode: subagent');
  }, 180000);
});
