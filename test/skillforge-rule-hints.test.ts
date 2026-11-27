import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// B337 and B338 (plan openspec/explorations/b337-b338-b257-b249-plan.md, owner's answers of 2026-11-25).
// B337: the install lines sdlc prints must be commands SkillForge 0.6 accepts. On the OpenCode stand SkillForge
// answered `unknown runtime "claude"` to the line sdlc printed for Claude Code; its runtime id is `claude-code`.
// SkillForge 0.5.12 and newer install rules for Codex (AGENTS.md block) and Qwen Code (QWEN.md block) too.
// B338: `team sync` names one install line per rule that fits the project; `team check` names an installed rule
// the fit notes do not propose, with the command that removes it.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const GATES = '# People decide the gates\n\n- Never run `sdlc approve`; give the person the command.\n';
const SMALL = '# Small functions\n\n- Functions of about 30 lines at most.\n';
const GO = '# Go errors\n\n- Wrap every error with its context.\n';
const ROLE_BODY = '# Role: team developer\n\nWrite the code.\n{{artifacts}}\n{{project}}\n';

function rule(id: string, body: string, extra: { tags?: string[]; paths?: string[] } = {}) {
  return { id, version: '0.1.0', description: `Rule ${id}`, tags: extra.tags ?? [], paths: extra.paths, body,
    checksum: sha(body) };
}

const REGISTRY = {
  roles: [{ id: 'developer', version: '1.0.0', title: 'Team developer', stages: ['build'],
    tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false, skills: [], body: ROLE_BODY,
    checksum: sha(ROLE_BODY) }],
  skills: [],
  rules: [
    rule('people-decide-gates', GATES, { tags: ['sdlc'] }),
    rule('small-functions', SMALL, { tags: ['code'], paths: ['src/**'] }),
    rule('go-errors', GO, { tags: ['go'], paths: ['**/*.go'] }),
  ],
};

function project(tools: string) {
  const root = tempDir('sdlc-b337-');
  const file = path.join(tempDir('sdlc-b337-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(REGISTRY));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  write(path.join(root, 'package.json'), '{ "name": "demo", "scripts": { "test": "node --test" } }\n');
  write(path.join(root, 'src/app.js'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  const at = (rel: string) => path.join(root, rel);
  const said = (args: string[]) => {
    const r = cli(args);
    return { code: r.code, out: r.stdout + r.stderr };
  };
  return { root, cli, at, said };
}

/** A SkillForge lock file of `runtime` holding `rules`, as `skillforge install rule/<id>` writes it. */
function lock(p: ReturnType<typeof project>, dir: string, runtime: string, rules: string[]) {
  const artifacts = Object.fromEntries(rules.map((id) => [`rule/${id}`, { version: '0.1.0', digest: 'x',
    files: { [`rules/${id}.md`]: 'y' }, installed_at: '2026-11-25T00:00:00.000Z', runtime }]));
  write(p.at(`${dir}/.skillforge-lock.json`), `${JSON.stringify({ registry: 'http://x', artifacts }, null, 2)}\n`);
  for (const id of rules) write(p.at(`${dir}/rules/${id}.md`), `# ${id}\n`);
}

const BARE_CLAUDE = /--runtime claude(?!-code)\b/;

describe('B337.C1 the runtime ids SkillForge accepts', () => {
  it('Claude Code is claude-code, never claude; OpenCode keeps opencode', () => {
    const p = project('claude,opencode');
    const r = p.said(['team', 'sync']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('--runtime claude-code');
    expect(r.out).toContain('--runtime opencode');
    expect(r.out).not.toMatch(BARE_CLAUDE);
  }, 240000);

  it('Codex and Qwen Code get their lines and doctor no longer calls them not connected; GigaCode still is', () => {
    const p = project('codex,qwen,gigacode');
    const sync = p.said(['team', 'sync']);
    expect(sync.code, sync.out).toBe(0);
    expect(sync.out).toContain('--runtime codex');
    expect(sync.out).toContain('--runtime qwen');
    expect(sync.out).not.toContain('--runtime gigacode');
    const doctor = p.said(['doctor']);
    expect(doctor.out).not.toMatch(/not connected[^\n]*(Codex|Qwen)|(Codex|Qwen)[^\n]*not connected/i);
    expect(doctor.out).toMatch(/not connected[^\n]*GigaCode|GigaCode[^\n]*not connected/i);
  }, 240000);

  it('with OpenCode and Codex, one line serves both, and the output says OpenCode reads AGENTS.md', () => {
    const p = project('opencode,codex');
    const r = p.said(['team', 'sync']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('--runtime codex');
    expect(r.out).not.toMatch(/skillforge (sync|install)[^\n]*--runtime opencode/);
    expect(r.out).toMatch(/OpenCode[^\n]*AGENTS\.md/);
  }, 240000);
});

describe('B337.C2 doctor finds the rules SkillForge put in QWEN.md', () => {
  it('recorded rules with a SkillForge block in QWEN.md do not "reach no agent"', () => {
    const p = project('qwen');
    const teamFile = p.at('openspec/.sdlc/team.json');
    const team = fs.existsSync(teamFile) ? JSON.parse(read(teamFile)) : {};
    team.rules = { 'people-decide-gates': { version: '0.1.0', checksum: sha(GATES), server: 'roles', text: GATES } };
    write(teamFile, `${JSON.stringify(team, null, 2)}\n`);
    expect(p.said(['doctor']).out).toMatch(/reach no agent/);
    write(p.at('QWEN.md'), '<!-- skillforge:rules:start -->\n### people-decide-gates\n<!-- skillforge:rules:end -->\n');
    expect(p.said(['doctor']).out).not.toMatch(/reach no agent/);
  }, 240000);
});

describe('B337.C3 the shipped text', () => {
  const shipped = ['docs/en', 'assets/guide/en', 'assets/locales', 'src'].flatMap((dir) => {
    const base = path.join(REPO_ROOT, dir);
    return (fs.readdirSync(base, { recursive: true }) as string[])
      .filter((rel) => /\.(md|json|ts)$/.test(rel))
      .map((rel) => ({ rel: `${dir}/${rel.replace(/\\/g, '/')}`, text: read(path.join(base, rel)) }));
  });

  it('no shipped text tells a person to run --runtime claude', () => {
    const bad = shipped.filter((f) => BARE_CLAUDE.test(f.text)).map((f) => f.rel);
    expect(bad).toEqual([]);
  });

  it('the SkillForge guide says sync refuses the MCP credential and how to sign in', () => {
    const guide = read(path.join(REPO_ROOT, 'docs/en/35-sdlc-and-skillforge.md'));
    expect(guide).toContain('mcp_token_forbidden');
    expect(guide).toContain('skillforge login');
  });
});

describe('B338.C1 sync names one install line per rule that fits', () => {
  it('the two fitting rules get their own line; the Go rule does not; the blanket line says it installs all', () => {
    const p = project('opencode');
    const r = p.said(['team', 'sync']);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain('skillforge install rule/people-decide-gates --runtime opencode');
    expect(r.out).toContain('skillforge install rule/small-functions --runtime opencode');
    expect(r.out).not.toContain('skillforge install rule/go-errors');
    expect(r.out).toMatch(/skillforge sync --type rule --runtime opencode[^\n]*every active rule|every active rule[^\n]*skillforge sync --type rule/);
  }, 240000);
});

describe('B338.C2 check names an installed rule that does not fit', () => {
  it('go-errors installed for OpenCode is named with its uninstall line; the fitting ones are not', () => {
    const p = project('opencode');
    lock(p, '.opencode', 'opencode', ['people-decide-gates', 'go-errors']);
    const r = p.said(['team', 'check']);
    expect(r.out).toMatch(/go-errors[^\n]*(not proposed|does not fit)/);
    expect(r.out).toContain('skillforge uninstall rule/go-errors --runtime opencode');
    expect(r.out).not.toMatch(/people-decide-gates[^\n]*(not proposed|does not fit)/);
    expect(r.out).not.toContain('skillforge uninstall rule/people-decide-gates');
  }, 240000);

  it('negative: nothing installed, nothing named', () => {
    const p = project('opencode');
    const r = p.said(['team', 'check']);
    expect(r.out).not.toMatch(/(not proposed|does not fit)/);
    expect(r.out).not.toContain('skillforge uninstall');
  }, 240000);
});
