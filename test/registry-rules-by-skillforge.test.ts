import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// OpenSpec change registry-rules-are-installed-by-skillforge (B317, the customer's decision of 2026-11-14).
// SkillForge installs registry rules (`skillforge sync --type rule --runtime <agent>`); sdlc only lists and checks
// them. With both, an agent read every rule twice. `sdlc update` removes what 0.32.0 placed: the rules in the
// AGENTS.md block, the path rules in role agents and the unchanged `.claude/rules/<id>.md` files.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const START = '<!-- sdlc:rules:start -->';
const END = '<!-- sdlc:rules:end -->';
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const hash = (text: string) => createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('hex');

const GATES = '# People decide the gates\n\n- Never run `sdlc approve`; give the person the command.\n';
const SMALL = '# Small functions\n\n- Functions of about 30 lines at most.\n';
const OWN = '# Our agent guide\n\nKeep it short.\n';
const NOTES = '\n## Our notes\n\nMine.\n';
const ROLE_BODY = '# Role: team developer\n\nWrite the code.\n{{artifacts}}\n{{project}}\n';

function rule(id: string, body: string, extra: { tags?: string[]; paths?: string[]; checksum?: string } = {}) {
  return { id, version: '0.1.0', description: `Rule ${id}`, tags: extra.tags ?? [], paths: extra.paths, body,
    checksum: extra.checksum ?? sha(body) };
}

function registry(options: { badGates?: boolean } = {}) {
  return {
    roles: [{ id: 'developer', version: '1.0.0', title: 'Team developer', stages: ['build'],
      tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false, skills: [], body: ROLE_BODY,
      checksum: sha(ROLE_BODY) }],
    skills: [],
    rules: [
      rule('people-decide-gates', GATES, { tags: ['sdlc'], ...(options.badGates ? { checksum: sha('x') } : {}) }),
      rule('small-functions', SMALL, { tags: ['code'], paths: ['src/**'] }),
    ],
  };
}

function project(tools = 'claude,opencode', data = registry()) {
  const root = tempDir('sdlc-b317-');
  const file = path.join(tempDir('sdlc-b317-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  write(path.join(root, 'package.json'), '{ "name": "demo", "scripts": { "test": "node --test" } }\n');
  write(path.join(root, 'src/app.js'), 'export const x = 1;\n');
  write(path.join(root, 'AGENTS.md'), OWN);
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
  const text = (rel: string) => read(at(rel));
  const exists = (rel: string) => fs.existsSync(at(rel));
  return { root, cli, at, text, exists };
}

type P = ReturnType<typeof project>;

const block = (agentsMd: string) => {
  const start = agentsMd.indexOf(START);
  const end = agentsMd.indexOf(END);
  return start >= 0 && end > start ? agentsMd.slice(start, end + END.length) : '';
};

function entry(paths?: string[], text = GATES) {
  return { version: '0.1.0', checksum: sha(text), server: 'roles', description: 'Rule', tags: [],
    ...(paths ? { paths } : {}), text, by: 'Pat Owner <pat@example.com>', at: '2026-11-14T10:00:00.000Z' };
}

/** Writes `rel` with `content` and records it in the manifest, as 0.32.0's `sdlc update` did. */
function generated(p: P, rel: string, content: string, kind: string) {
  write(p.at(rel), content);
  const file = p.at('openspec/.sdlc/manifest.json');
  const manifest = JSON.parse(read(file));
  manifest.files[rel] = { sha256: hash(content), tool: rel.startsWith('.claude') ? 'claude' : 'opencode', kind };
  write(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

const PATH_SECTION = '\n## Rules for some files\n\n### Small functions (small-functions)\n\nFiles: `src/**`\n\n'
  + '- Functions of about 30 lines at most.\n';

/** The state 0.32.0 left: an accepted general rule in the block, a path rule in role agents and .claude/rules. */
function legacy(p: P) {
  expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
  expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
  const teamFile = p.at('openspec/.sdlc/team.json');
  const team = JSON.parse(read(teamFile));
  team.rules = { 'people-decide-gates': entry(), 'small-functions': entry(['src/**'], SMALL) };
  write(teamFile, `${JSON.stringify(team, null, 2)}\n`);
  const legacyBlock = [START, '## Team rules', '', '### People decide the gates (people-decide-gates)', '',
    '- Never run `sdlc approve`; give the person the command.', '', END].join('\n');
  write(p.at('AGENTS.md'), `${OWN}\n${legacyBlock}\n${NOTES}`);
  for (const rel of ['.opencode/agents/sdlc-developer.md', '.claude/agents/sdlc-developer.md']) {
    generated(p, rel, `${p.text(rel).trimEnd()}\n${PATH_SECTION}`, 'agent');
  }
  const ruleFile = ['---', 'paths:', '  - "src/**"', '---', '', SMALL].join('\n');
  generated(p, '.claude/rules/small-functions.md', ruleFile, 'rule');
  git(p.root, ['add', '-A']);
  git(p.root, ['commit', '-q', '-m', 'state of 0.32.0']);
}

const ROLE_AGENTS = ['.opencode/agents/sdlc-developer.md', '.claude/agents/sdlc-developer.md'];

describe('B317.C1 sync lists the rules and the install lines', () => {
  it('both rules, one skillforge line per tool, and no rule text written anywhere', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    const before = ROLE_AGENTS.map((rel) => p.text(rel));
    const agentsMd = p.text('AGENTS.md');
    const sync = p.cli(['team', 'sync']);
    const out = sync.stdout + sync.stderr;
    expect(sync.code, out).toBe(0);
    expect(out).toContain('people-decide-gates');
    expect(out).toContain('small-functions');
    expect(out).toContain('skillforge sync --type rule --runtime opencode');
    // B337 (2026-11-25): SkillForge's runtime id for Claude Code is claude-code; `--runtime claude` is refused.
    expect(out).toContain('skillforge sync --type rule --runtime claude-code');
    expect(out).not.toContain('--runtime codex');
    expect(out).not.toContain('--runtime cursor');
    expect(out).not.toContain('team accept --rule');
    expect(p.text('AGENTS.md')).toBe(agentsMd);
    expect(block(p.text('AGENTS.md'))).not.toContain('Never run');
    expect(ROLE_AGENTS.map((rel) => p.text(rel))).toEqual(before);
    expect(p.exists('.claude/rules')).toBe(false);
  }, 240000);
});

describe('B317.C2 a 0.32.0 project', () => {
  it('doctor names the duplicate and update; update removes what 0.32.0 placed and keeps the person\'s text', () => {
    const p = project();
    legacy(p);
    const doctor = p.cli(['doctor']);
    const said = doctor.stdout + doctor.stderr;
    expect(said).toMatch(/people-decide-gates[^\n]*sdlc update|sdlc update[^\n]*people-decide-gates/);
    const update = p.cli(['update']);
    expect(update.code, update.stdout + update.stderr).toBe(0);
    // Review F1: the update says what it took away and how SkillForge puts it back.
    expect(update.stdout).toContain('skillforge sync --type rule --runtime opencode');
    expect(update.stdout).toContain('skillforge sync --type rule --runtime claude-code');
    const agentsMd = p.text('AGENTS.md');
    expect(block(agentsMd)).not.toMatch(/^### /m);
    expect(block(agentsMd)).not.toContain('Never run');
    expect(agentsMd.startsWith(OWN)).toBe(true);
    expect(agentsMd).toContain('## Our notes\n\nMine.');
    for (const rel of ROLE_AGENTS) expect(p.text(rel), rel).not.toContain('small-functions');
    expect(p.exists('.claude/rules/small-functions.md')).toBe(false);
    const again = p.cli(['doctor']);
    expect(again.stdout + again.stderr).not.toMatch(/people-decide-gates/);
    // Review F1: while no rule SkillForge installs is in the project, doctor says the recorded rules reach no agent.
    expect(again.stdout + again.stderr).toMatch(/reach no agent/);
    write(p.at('.opencode/rules/people-decide-gates.md'), GATES);
    const installed = p.cli(['doctor']);
    expect(installed.stdout + installed.stderr).not.toMatch(/reach no agent/);
    const quiet = p.cli(['update']);
    expect(quiet.stdout).not.toContain('skillforge sync');
  }, 300000);
});

describe('B317 review F2 and F3: the text around the block is the person\'s, byte for byte', () => {
  it('markers quoted in prose are not a block, and update leaves the file as it is', () => {
    const p = project();
    const prose = `${OWN}\nsdlc owns \`${START}\` to \`${END}\` only.\n`;
    write(p.at('AGENTS.md'), prose);
    expect(p.cli(['update', '--json']).code).toBe(0);
    expect(p.text('AGENTS.md')).toBe(prose);
  }, 240000);

  it('a CRLF line outside an LF block keeps its ending, and so does the rest', () => {
    const p = project();
    const legacyBlock = [START, '## Team rules', '', '### Old (old-rule)', '', '- Old.', '', END].join('\n');
    const before = `# Guide\r\n\nPlain line.\n\n${legacyBlock}\n\nAfter.\r\n`;
    fs.writeFileSync(p.at('AGENTS.md'), before);
    expect(p.cli(['update', '--json']).code).toBe(0);
    const after = fs.readFileSync(p.at('AGENTS.md'), 'utf8');
    expect(after.startsWith('# Guide\r\n\nPlain line.\n\n')).toBe(true);
    expect(after.endsWith('\n\nAfter.\r\n')).toBe(true);
    expect(after).not.toContain('### Old');
  }, 240000);
});

describe('B317.C3 negative: a file changed since sdlc wrote it stays', () => {
  it('a .claude/rules file rewritten after 0.32.0 is left as it is', () => {
    const p = project();
    legacy(p);
    const theirs = '---\npaths:\n  - "src/**"\n---\n\n# Small functions\n\nWritten by skillforge sync.\n';
    write(p.at('.claude/rules/small-functions.md'), theirs);
    expect(p.cli(['update', '--json']).code).toBe(0);
    expect(p.text('.claude/rules/small-functions.md')).toBe(theirs);
  }, 300000);
});

describe('B317.C4 agents without registry rules', () => {
  // Changed requirement (B337, 2026-11-25): SkillForge 0.5.12 and newer install rules for Codex (AGENTS.md block)
  // and Qwen Code (QWEN.md block), seen on SkillForge 0.6.1; only GigaCode has no SkillForge runtime.
  it('doctor says for gigacode that registry rules are not connected, and not for codex, qwen or claude', () => {
    const p = project('claude,codex,qwen,gigacode');
    const doctor = p.cli(['doctor']);
    const said = doctor.stdout + doctor.stderr;
    expect(said).toMatch(/registry rules are not connected[^\n]*GigaCode|GigaCode[^\n]*registry rules are not connected/i);
    expect(said).not.toMatch(/registry rules are not connected[^\n]*(Codex|Qwen|Claude)/i);
  }, 240000);
});

describe('B317.C5 accept --rule is refused', () => {
  it('a person gets exit 1 with the skillforge hint, and nothing changes', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const teamBefore = p.exists('openspec/.sdlc/team.json') ? p.text('openspec/.sdlc/team.json') : '';
    const agentsBefore = p.text('AGENTS.md');
    const r = p.cli(['team', 'accept', '--rule', 'people-decide-gates']);
    expect(r.code, r.stdout + r.stderr).toBe(1);
    expect(r.stdout + r.stderr).toContain('skillforge sync --type rule');
    expect(p.exists('openspec/.sdlc/team.json') ? p.text('openspec/.sdlc/team.json') : '').toBe(teamBefore);
    expect(p.text('AGENTS.md')).toBe(agentsBefore);
    expect(p.exists('.claude/rules')).toBe(false);
  }, 240000);
});

describe('B317.C6 check shows the rules', () => {
  it('a rule with a wrong checksum is listed with the problem, and no file changes', () => {
    const p = project('claude,opencode', registry({ badGates: true }));
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'config']);
    const r = p.cli(['team', 'check']);
    const out = r.stdout + r.stderr;
    expect(out).toMatch(/people-decide-gates[^\n]*checksum/);
    expect(out).toMatch(/small-functions/);
    expect(out).not.toMatch(/small-functions[^\n]*checksum does not match/);
    const json = p.cli(['team', 'check', '--json']).json();
    const gates = json.rules.find((x: { id: string }) => x.id === 'people-decide-gates');
    expect(gates.checksumOk).toBe(false);
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: p.root, encoding: 'utf-8' })).toBe('');
  }, 240000);
});
