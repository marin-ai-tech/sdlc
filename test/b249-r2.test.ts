import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseConfig } from '../src/core/config.js';
import { GUARD_SKILL_ROOTS } from '../src/core/policy-guard.js';
import { roleDigest } from '../src/team/record.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// B249 round 2 (last): the attack review of round 1 (c7f7ab7e). F1: a base such as HEAD^{/.|$(touch pwn)} resolves
// in git and still reached the JSON `base` field and the text header of review context, which the reviewer subagent
// uses; a base must be a plain ref. F2: the round-1 pre-check refused update, doctor --fix and init over a role file
// the refresh never reads (an unrecorded note, an edited file). F3: the accepted-and-now-refused role. F7: the regex
// copies of the skill roots.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const body = (id: string) => `# Role: team ${id}\n\nDo it.\n{{artifacts}}\n{{project}}\n`;
const role = (id: string, stages: string[]) => ({ id, version: '1.0.0', title: `Team ${id}`, stages,
  tools: ['read', 'grep'], readonly: false, skills: [], body: body(id), checksum: sha(body(id)) });

function project(roles: unknown[] = []) {
  const root = tempDir('sdlc-b249r2-');
  const data = path.join(tempDir('sdlc-b249r2-data-'), 'registry.json');
  fs.writeFileSync(data, JSON.stringify({ roles, skills: [] }));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: data });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  return { root, run: (args: string[]) => runCli(args, root, env), at: (rel: string) => path.join(root, rel) };
}

describe('B249 round 2, F1: a base is a plain ref', () => {
  const BAD = ['HEAD^{/.|x}', 'HEAD^{/a b}', 'main;id', 'main|sh', 'a$(b)', 'a`b`', 'main\nDiff: x', 'a b'];
  const GOOD = ['HEAD', 'HEAD~1', 'origin/main', 'v1.0.0', 'release/0.34', 'main@{1}', 'HEAD^2'];

  it('review.base refuses shell and search text and keeps ordinary refs', () => {
    for (const base of BAD) {
      expect(() => parseConfig({ version: 1, review: { base } }), base).toThrow(/review\.base/);
    }
    for (const base of GOOD) expect(parseConfig({ version: 1, review: { base } }).review.base, base).toBe(base);
  });

  it('--base of review context refuses it, and neither the JSON nor the header carries it', () => {
    const p = project();
    expect(p.run(['new', 'probe-change']).code).toBe(0);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'sdlc']);
    const r = p.run(['review', 'context', '--change', 'probe-change', '--base=HEAD^{/.|$(touch pwn)}', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/--base/);
    expect(fs.existsSync(p.at('pwn'))).toBe(false);
    const ok = p.run(['review', 'context', '--change', 'probe-change', '--base=HEAD', '--json']);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
  }, 240000);
});

describe('B249 round 2, F2 and F3: the pre-check reads what the refresh reads', () => {
  it('F2: an unrecorded note in docs/agents does not block update, doctor --fix or init', () => {
    const p = project();
    write(p.at('docs/agents/overview.md'), '---\ntitle: Overview\ntools: [Claude Code]\n---\nNotes.\n');
    fs.rmSync(p.at('.claude/agents/sdlc-reviewer.md'), { force: true });
    const update = p.run(['update']);
    expect(update.code, update.stdout + update.stderr).toBe(0);
    expect(fs.existsSync(p.at('.claude/agents/sdlc-reviewer.md'))).toBe(true);
    expect(p.run(['doctor', '--fix']).code).toBe(0);
    expect(p.run(['init', '--tools', 'claude', '--json']).code).toBe(0);
  }, 240000);

  it('F3: an accepted role a stricter parser refuses stops update and names the file and the next step', () => {
    const p = project([role('analyst', ['plan'])]);
    expect(p.run(['team', 'sync', '--json']).code).toBe(0);
    expect(p.run(['team', 'accept', 'analyst', '--json']).code).toBe(0);
    const file = p.at('docs/agents/analyst.md');
    const many = JSON.stringify(Array.from({ length: 65 }, (_, i) => `tool${i}`));
    write(file, read(file).replace(/tools:[\s\S]*?\n(?=\w)/, `tools: ${many}\n`));
    const teamFile = p.at('openspec/.sdlc/team.json');
    const record = JSON.parse(read(teamFile));
    record.roles.analyst.digest = roleDigest(read(file));
    write(teamFile, `${JSON.stringify(record, null, 2)}\n`);
    const agent = read(p.at('.claude/agents/sdlc-analyst.md'));
    const config = read(p.at('openspec/sdlc.yaml'));
    const r = p.run(['update']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('docs/agents/analyst.md');
    expect(r.stdout + r.stderr).toMatch(/team accept analyst/);
    expect(read(p.at('.claude/agents/sdlc-analyst.md'))).toBe(agent);
    expect(read(p.at('openspec/sdlc.yaml'))).toBe(config);
    const license = p.run(['license', 'set', 'community']);
    expect(license.code).not.toBe(0);
    expect(read(p.at('openspec/sdlc.yaml'))).toBe(config);
  }, 240000);
});

describe('B249 round 2, F7: the regex copies of the skill roots', () => {
  it('every skill root of the guard matches the guard\'s and the team record\'s folder patterns', async () => {
    const guard = await import('../src/core/policy-guard.js') as Record<string, unknown>;
    const record = await import('../src/team/record.js') as Record<string, unknown>;
    const guardTest = guard.isGuardSkillRoot as ((dir: string) => boolean) | undefined;
    const recordTest = record.isTeamSkillDir as ((dir: string) => boolean) | undefined;
    expect(guardTest, 'policy-guard exports isGuardSkillRoot').toBeDefined();
    expect(recordTest, 'record exports isTeamSkillDir').toBeDefined();
    for (const root of GUARD_SKILL_ROOTS) {
      expect(guardTest?.(root), root).toBe(true);
      expect(recordTest?.(`${root}/some-skill`), root).toBe(true);
    }
  });
});
