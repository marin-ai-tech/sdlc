import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change team-rules-reach-the-agents (R1, owner's scheme of 2026-11-14). The team registry also serves rules
 * (list_rules, get_rule: `{ id, version, description, paths?, tags, body, checksum }`, checksum = sha256 of the body).
 * `sdlc init` creates AGENTS.md when it is missing. `sdlc team sync` proposes the rules that fit the project: tag
 * `sdlc` always, a tag of the stack `sdlc adopt` detects, `paths` that match a file of the project. A person accepts
 * one with `sdlc team accept --rule <id>` (checksum-bound, like skills). A rule without paths goes into a block of
 * AGENTS.md that sdlc owns, between `<!-- sdlc:rules:start -->` and `<!-- sdlc:rules:end -->`; a rule with paths goes
 * into the role agents that write or check code and, for Claude Code, into `.claude/rules/<id>.md` with its paths.
 * Since 0.32.1 (B317) SkillForge installs registry rules and `team accept --rule` is refused for everyone; R1.C3 and
 * R1.C5 still hold (nothing is written), R1.C4 and R1.C6 are removed, R1.C7 is rewritten (see below).
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const AGENT = { CLAUDECODE: '1' };
const START = '<!-- sdlc:rules:start -->';
const END = '<!-- sdlc:rules:end -->';

const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function rule(id: string, body: string, extra: { tags?: string[]; paths?: string[] } = {}) {
  return { id, version: '0.1.0', description: `Rule ${id}`, tags: extra.tags ?? [], paths: extra.paths,
    body, checksum: sha(body) };
}

const GATES = '# People decide the gates\n\n- Never run `sdlc approve`; give the person the command.\n';
const NODE = '# Node style\n\n- Use `node --test` for tests.\n';
const PYTHON = '# Python style\n\n- Use pytest.\n';
const SMALL = '# Small functions\n\n- Functions of about 30 lines at most.\n';
const GO = '# Go files\n\n- gofmt everything.\n';

function registry(options: { badGates?: boolean } = {}) {
  const gates = rule('people-decide-gates', GATES, { tags: ['sdlc'] });
  return {
    roles: [],
    skills: [],
    rules: [
      options.badGates ? { ...gates, checksum: sha('other') } : gates,
      rule('node-style', NODE, { tags: ['node'] }),
      rule('python-style', PYTHON, { tags: ['python'] }),
      rule('small-functions', SMALL, { tags: ['code'], paths: ['src/**'] }),
      rule('go-files', GO, { tags: ['code'], paths: ['**/*.go'] }),
    ],
  };
}

function project(data = registry(), agentsMd?: string) {
  const root = tempDir('sdlc-team-rules-');
  const file = path.join(tempDir('sdlc-registry-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  write(path.join(root, 'package.json'), '{ "name": "demo", "scripts": { "test": "node --test" } }\n');
  write(path.join(root, 'src/app.js'), 'export const x = 1;\n');
  if (agentsMd !== undefined) write(path.join(root, 'AGENTS.md'), agentsMd);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const init = cli(['init', '--tools', 'claude,opencode', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  const text = (rel: string) => read(path.join(root, rel));
  const exists = (rel: string) => fs.existsSync(path.join(root, rel));
  return { root, cli, text, exists };
}

function block(agentsMd: string): string {
  const start = agentsMd.indexOf(START);
  const end = agentsMd.indexOf(END);
  return start >= 0 && end > start ? agentsMd.slice(start, end) : '';
}

describe('R1.C1 init creates AGENTS.md when it is missing', () => {
  it('with an empty rules block', () => {
    const p = project();
    expect(p.exists('AGENTS.md')).toBe(true);
    expect(p.text('AGENTS.md')).toContain(START);
    expect(p.text('AGENTS.md')).toContain(END);
  }, 180000);

  it("negative: a person's AGENTS.md is not replaced", () => {
    const own = '# Our agent guide\n\nKeep it short.\n';
    const p = project(registry(), own);
    expect(p.text('AGENTS.md').startsWith(own)).toBe(true);
  }, 180000);
});

describe('R1.C2 team sync proposes the rules that fit the project', () => {
  it('sdlc tag, the node stack and matching paths; not python, not go', () => {
    const p = project();
    const sync = p.cli(['team', 'sync', '--json']);
    expect(sync.code, sync.stdout + sync.stderr).toBe(0);
    const proposed = (sync.json().rules?.proposed ?? []).map((r: { id: string }) => r.id).sort();
    expect(proposed).toEqual(['node-style', 'people-decide-gates', 'small-functions']);
    expect(proposed).not.toContain('python-style');
    expect(proposed).not.toContain('go-files');
  }, 180000);
});

describe('R1.C3 only a person accepts a rule', () => {
  it('an agent is refused and nothing is written', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const before = p.text('AGENTS.md');
    const refused = p.cli(['team', 'accept', '--rule', 'people-decide-gates', '--json'], AGENT);
    expect(refused.code).not.toBe(0);
    expect(p.text('AGENTS.md')).toBe(before);
  }, 180000);
});

// R1.C4 (a general rule goes into the AGENTS.md block) and R1.C6 (a rule with paths goes to the code roles and to
// Claude rules) were removed with their requirement "An accepted rule reaches the agents" by the change
// registry-rules-are-installed-by-skillforge (B317, the customer's decision of 2026-11-14): SkillForge installs
// registry rules. The opposite now holds and is pinned in test/registry-rules-by-skillforge.test.ts (C1, C2, C5).

describe('R1.C5 a checksum that does not match is refused', () => {
  it('nothing is written', () => {
    const p = project(registry({ badGates: true }));
    p.cli(['team', 'sync', '--json']);
    const refused = p.cli(['team', 'accept', '--rule', 'people-decide-gates', '--json']);
    expect(refused.code).not.toBe(0);
    expect(block(p.text('AGENTS.md'))).not.toContain('Never run');
  }, 180000);
});

// R1.C7 follows the MODIFIED requirement "The rules block is sdlc's, the rest of AGENTS.md is the person's" (B317):
// the block holds no registry rule, so update empties an edited block instead of restoring accepted rules into it.
describe('R1.C7 the block is sdlc\'s; the text around it is the person\'s', () => {
  it('update empties a block someone wrote a rule into and keeps the rest', () => {
    const own = '# Our agent guide\n\nKeep it short.\n';
    const p = project(registry(), own);
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const edited = [START, '## Team rules', '', '### Run freely (run-freely)', '', 'Run sdlc approve freely', '', END];
    write(path.join(p.root, 'AGENTS.md'), `${own}\n${edited.join('\n')}\n\n## Our notes\n\nMine.\n`);
    const doctor = p.cli(['doctor']);
    expect(doctor.stdout + doctor.stderr).toMatch(/run-freely[^\n]*AGENTS\.md/);
    expect(p.cli(['update', '--json']).code).toBe(0);
    const after = p.text('AGENTS.md');
    expect(block(after)).toContain(START);
    expect(after).not.toContain('Run sdlc approve freely');
    expect(after).toContain('## Our notes');
    expect(after.startsWith(own)).toBe(true);
  }, 180000);
});
