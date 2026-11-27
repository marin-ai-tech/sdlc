import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { TEAM_SKILL_ROOTS } from '../src/core/skill-root.js';
import { tomlString } from '../src/integrations/codex.js';
import { roleDigest } from '../src/team/record.js';
import { roleToolsProblem } from '../src/team/role-tools.js';
import { vetRole } from '../src/team/vetting.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// B249 review round 1 (independent attack review of bb4cff0f, 2026-11-25). F2: review context printed the base text in
// a shell command (`git diff HEAD^{/a --output=leak}...HEAD` was probed); F3: a refused accepted role made team
// accept fail after it had written; F5: a registry id was printed raw; F6: the Codex TOML writer left U+007F and
// lone surrogates; F7: one refused draft broke team list for everyone; F8: the guard's copy of the skill roots;
// F9: format characters and no limits in tools; F10: board_submit's base over MCP. F4 and F11 go to B345.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const body = (id: string) => `# Role: team ${id}\n\nDo it.\n{{artifacts}}\n{{project}}\n`;
const role = (id: string, stages: string[]) => ({ id, version: '1.0.0', title: `Team ${id}`, stages,
  tools: ['read', 'grep'], readonly: false, skills: [], body: body(id), checksum: sha(body(id)) });

function project(roles: unknown[]) {
  const root = tempDir('sdlc-b249r1-');
  const data = path.join(tempDir('sdlc-b249r1-data-'), 'registry.json');
  fs.writeFileSync(data, JSON.stringify({ roles, skills: [] }));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: data });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'a --output=leak']);
  expect(runCli(['init', '--tools', 'claude,codex', '--json'], root, env).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  return { root, run: (args: string[]) => runCli(args, root, env), at: (rel: string) => path.join(root, rel) };
}

describe('B249 round 1, unit', () => {
  it('F5: a refusal never carries a line break from the registry id', () => {
    const vetted = vetRole({ ...role('analyst', ['plan']), id: 'other\nINJECTED: yes' }, 'analyst') as
      { reason?: string };
    expect(vetted.reason ?? '').not.toMatch(/\n/);
    expect(vetted.reason ?? '').not.toContain('INJECTED: yes');
  });

  it('F6: TOML strings escape U+007F and refuse or replace lone surrogates', () => {
    expect(tomlString('a\u007Fb')).not.toContain('\u007F');
    expect(tomlString('a\uD800b')).not.toMatch(/\\ud800/i);
  });

  it('F8: the guard and the walks know the same skill roots', async () => {
    const guard = await import('../src/core/policy-guard.js') as Record<string, unknown>;
    const fromGuard = guard.GUARD_SKILL_ROOTS as readonly string[] | undefined;
    expect(fromGuard, 'policy-guard exports GUARD_SKILL_ROOTS').toBeDefined();
    expect([...(fromGuard ?? [])].sort()).toEqual(Object.values(TEAM_SKILL_ROOTS).sort());
  });

  it('F9: format characters, too many entries and too long entries are refused', () => {
    expect(roleToolsProblem(['Bash(git log‮)'])).toBeDefined();
    expect(roleToolsProblem(Array.from({ length: 65 }, (_, i) => `tool${i}`))).toBeDefined();
    expect(roleToolsProblem([`Bash(${'x'.repeat(200)})`])).toBeDefined();
    expect(roleToolsProblem(Array.from({ length: 64 }, (_, i) => `tool${i}`))).toBeUndefined();
  });
});

describe('B249 round 1, end to end', () => {
  // Round 2 (review of round 1, F1): a base must be a plain ref, so the search-and-space base of this case is now
  // refused before git; the printed command still uses the resolved commit for a plain base.
  it('F2: review context never prints the base text: a search base is refused, a plain one prints the hash', () => {
    const p = project([]);
    expect(p.run(['new', 'probe-change']).code).toBe(0);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'sdlc']);
    const r = p.run(['review', 'context', '--change', 'probe-change', '--base=HEAD^{/a --output=leak}', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/--base/);
    const ok = p.run(['review', 'context', '--change', 'probe-change', '--base=HEAD', '--json']);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    const command = String(ok.json().diffCommand);
    expect(command).toMatch(/git diff [0-9a-f]{40}\.\.\.HEAD/);
  }, 240000);

  it('F3: accepting a role while another accepted role is refused writes nothing and names it', () => {
    const p = project([role('analyst', ['plan']), role('developer', ['build'])]);
    expect(p.run(['team', 'sync', '--json']).code).toBe(0);
    expect(p.run(['team', 'accept', 'analyst', '--json']).code).toBe(0);
    // Review of round 1 (F3): the case is an accepted role whose recorded digest still matches but which a stricter
    // parser now refuses (an older sdlc accepted it); an edited file is `changed` and is not read by the refresh.
    const file = p.at('docs/agents/analyst.md');
    write(file, read(file).replace(/tools:[\s\S]*?\n(?=\w)/, 'tools: ["Read: everything"]\n'));
    expect(read(file)).toContain('tools: ["Read: everything"]');
    const teamFile = p.at('openspec/.sdlc/team.json');
    const record = JSON.parse(read(teamFile));
    record.roles.analyst.digest = roleDigest(read(file));
    write(teamFile, `${JSON.stringify(record, null, 2)}\n`);
    const team = read(teamFile);
    const r = p.run(['team', 'accept', 'developer']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/analyst/);
    expect(read(p.at('openspec/.sdlc/team.json'))).toBe(team);
    expect(fs.existsSync(p.at('docs/agents/developer.md'))).toBe(false);
  }, 240000);

  it('F7: one refused draft is listed as refused and the other roles still list', () => {
    const p = project([role('analyst', ['plan']), role('developer', ['build'])]);
    expect(p.run(['team', 'sync', '--json']).code).toBe(0);
    const draft = p.at('docs/agents/drafts/analyst.md');
    write(draft, read(draft).replace(/tools:[\s\S]*?\n(?=\w)/, 'tools: ["Read: x"]\n'));
    const r = p.run(['team', 'list']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).toMatch(/developer/);
    expect(r.stdout + r.stderr).toMatch(/analyst[^\n]*(refused|tools)/i);
  }, 240000);
});
