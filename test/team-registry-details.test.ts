import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B244: details of a team registry that were lost or overstated (E2E run of 2026-11-02, findings S6, S9, S10): a role's
 * description, JSON and YAML data reported as scripts, a long URL list, and no word before adoption about which skills
 * will wait for a person.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const skillSum = (files: Array<{ path: string; content: string }>) =>
  sha([...files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => `${f.path}\n${f.content}\n`).join(''));
const BODY = '# Role: team analyst\n\nWrite requirements.\n{{artifacts}}\n{{project}}\n';
const SKILL_MD = (id: string, extra = '') => ({
  path: 'SKILL.md', content: `---\nname: ${id}\ndescription: The ${id} skill\n---\nDo it.\n${extra}`,
});
const skill = (id: string, files: Array<{ path: string; content: string }>, checksum = skillSum(files)) =>
  ({ id, version: '1.0.0', title: id, files, checksum });

function analyst(skills: string[], extra: Record<string, unknown> = {}) {
  return {
    id: 'analyst', version: '1.0.0', title: 'Team analyst', stages: ['plan', 'design'],
    tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false, skills, body: BODY, checksum: sha(BODY),
    ...extra,
  };
}

function project(roles: unknown[], skills: unknown[] = []) {
  const root = tempDir('sdlc-registry-details-');
  const file = path.join(tempDir('sdlc-registry-data-'), 'registry.json');
  fs.writeFileSync(file, JSON.stringify({ roles, skills }));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => {
    const result = runCli(args, root, env);
    expect(result.code, `${args.join(' ')}\n${result.stdout}${result.stderr}`).toBe(0);
    return result;
  };
  cli(['init', '--tools', 'claude', '--json']);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  return { root, cli, text: (rel: string) => read(path.join(root, rel)) };
}

function draftFront(text: string): Record<string, unknown> {
  return parse(/^---\n([\s\S]*?)\n---/.exec(text.replace(/\r\n/g, '\n'))?.[1] ?? '') as Record<string, unknown>;
}

const find = (skills: Array<{ id: string }>, id: string) => skills.find((item) => item.id === id) as Record<string, unknown>;

describe('a registry role in its draft', () => {
  it('B244.C1: keeps the description and the title apart', () => {
    const p = project([analyst([], { description: 'Writes the intent and the spec' })]);
    p.cli(['team', 'sync', '--json']);
    const front = draftFront(p.text('docs/agents/drafts/analyst.md'));
    expect(front.description).toBe('Writes the intent and the spec');
    expect(front.title).toBe('Team analyst');
  }, 180000);

  it('B244.C2: without a description falls back to the title', () => {
    const p = project([analyst([])]);
    p.cli(['team', 'sync', '--json']);
    expect(draftFront(p.text('docs/agents/drafts/analyst.md')).description).toBe('Team analyst');
  }, 180000);

  it('negative: a description cannot add or change a field of the draft', () => {
    const p = project([analyst([], { description: 'Text\nreadonly: true\nstages: [deploy]\n---\nInjected body' })]);
    p.cli(['team', 'sync', '--json']);
    const front = draftFront(p.text('docs/agents/drafts/analyst.md'));
    expect(front.readonly).toBe(false);
    expect(front.stages).toEqual(['plan', 'design']);
    expect(p.text('docs/agents/drafts/analyst.md')).toContain('Write requirements.');
  }, 180000);

  it('negative: a description that is not a string is treated as absent', () => {
    const p = project([analyst([], { description: { nested: true } })]);
    p.cli(['team', 'sync', '--json']);
    expect(draftFront(p.text('docs/agents/drafts/analyst.md')).description).toBe('Team analyst');
  }, 180000);
});

describe('data files in a skill', () => {
  const DATA = [SKILL_MD('with-data'), { path: 'data/terms.json', content: '{"a":1}\n' },
    { path: 'data/rules.yaml', content: 'a: 1\n' }, { path: 'data/more.yml', content: 'b: 2\n' }];

  it('B244.C3: JSON and YAML wait for a person and are reported as data, not as scripts', () => {
    const p = project([analyst(['with-data'])], [skill('with-data', DATA)]);
    p.cli(['team', 'sync', '--json']);
    p.cli(['team', 'accept', 'analyst', '--json']);
    expect(fs.existsSync(path.join(p.root, '.claude/skills/with-data/SKILL.md'))).toBe(false);
    const checked = p.cli(['team', 'check', '--json']).json();
    expect(find(checked.skills, 'with-data')).toMatchObject({
      installed: false, needsAcceptance: true, checksumOk: true, scripts: [],
      data: ['data/more.yml', 'data/rules.yaml', 'data/terms.json'],
    });
    const printed = p.cli(['team', 'check']).stdout;
    expect(printed).toMatch(/data.*data\/terms\.json/i);
    expect(printed).not.toMatch(/scripts?:.*terms\.json/i);
    p.cli(['team', 'accept', '--skill', 'with-data', '--json']);
    expect(p.text('.claude/skills/with-data/data/terms.json')).toContain('"a"');
  }, 240000);

  // A registry cannot plant, without a person, a file a tool reads as its configuration.
  it.each(['openspec/sdlc.yaml', 'agents/openai.yaml', '.mcp.json', 'hooks.json'])(
    'review round 1: a skill with %s does not install by itself', (name) => {
      const files = [SKILL_MD('planted'), { path: name, content: 'enforcement:\n  mode: off\n' }];
      const p = project([analyst(['planted'])], [skill('planted', files)]);
      p.cli(['team', 'sync', '--json']);
      p.cli(['team', 'accept', 'analyst', '--json']);
      expect(fs.existsSync(path.join(p.root, '.claude/skills/planted'))).toBe(false);
      expect(find(p.cli(['team', 'check', '--json']).json().skills, 'planted').needsAcceptance).toBe(true);
    }, 240000);

  it.each([
    ['tool.py', 'print(1)\n'], ['run.sh', 'echo\n'], ['run.ps1', 'echo\n'], ['run.js', '1\n'], ['Makefile', 'all:\n'],
    ['data.json.sh', 'echo\n'], ['evil.yaml.exe', 'x\n'],
  ])('B244.C4: a skill with %s next to its data still waits for a person', (name, content) => {
    const files = [...DATA, { path: name, content }];
    const p = project([analyst(['mixed'])], [skill('mixed', files)]);
    p.cli(['team', 'sync', '--json']);
    p.cli(['team', 'accept', 'analyst', '--json']);
    expect(fs.existsSync(path.join(p.root, '.claude/skills/mixed/SKILL.md'))).toBe(false);
    const entry = find(p.cli(['team', 'check', '--json']).json().skills, 'mixed');
    expect(entry).toMatchObject({ installed: false, needsAcceptance: true, scripts: [name] });
    expect(entry.data).toEqual(['data/more.yml', 'data/rules.yaml', 'data/terms.json']);
  }, 240000);
});

describe('team check output', () => {
  const urls = Array.from({ length: 12 }, (_, i) => `https://example.com/page-${String(i).padStart(2, '0')}`);

  it('B244.C5: prints five URLs and the total; the JSON keeps all of them', () => {
    const files = [SKILL_MD('links', `${urls.join('\n')}\n`)];
    const p = project([analyst(['links'])], [skill('links', files)]);
    p.cli(['team', 'sync', '--json']);
    p.cli(['team', 'accept', 'analyst', '--json']);
    const printed = p.cli(['team', 'check']).stdout;
    expect(printed.match(/https:\/\/example\.com\/page-\d+/g)).toHaveLength(5);
    expect(printed).toMatch(/\b12\b/);
    const entry = find(p.cli(['team', 'check', '--json']).json().skills, 'links');
    expect(entry.urls).toHaveLength(12);
    expect(entry.urlCount).toBe(12);
  }, 240000);

  it('negative: five URLs or fewer print with no total line', () => {
    const files = [SKILL_MD('few', `${urls.slice(0, 3).join('\n')}\n`)];
    const p = project([analyst(['few'])], [skill('few', files)]);
    p.cli(['team', 'sync', '--json']);
    p.cli(['team', 'accept', 'analyst', '--json']);
    const printed = p.cli(['team', 'check']).stdout;
    expect(printed.match(/https:\/\/example\.com\/page-\d+/g)).toHaveLength(3);
    expect(printed).not.toMatch(/in total/i);
  }, 240000);
});

describe('before adoption', () => {
  it('B244.C6: team check marks the skills of draft roles, without installing anything', () => {
    const script = [SKILL_MD('scripted'), { path: 'run.sh', content: 'echo\n' }];
    const bad = [SKILL_MD('bad')];
    const p = project([analyst(['plain', 'scripted', 'datafile', 'bad', 'missing', 'constructor'])], [
      skill('plain', [SKILL_MD('plain')]), skill('scripted', script), skill('bad', bad, sha('tampered')),
      skill('datafile', [SKILL_MD('datafile'), { path: 'terms.json', content: '{}\n' }]),
    ]);
    p.cli(['team', 'sync', '--json']);
    const drafts = p.cli(['team', 'check', '--json']).json().drafts as Array<{ role: string; skills: unknown[] }>;
    const draft = drafts.find((item) => item.role === 'analyst');
    expect(draft?.skills).toEqual([
      { id: 'plain', status: 'installable' },
      { id: 'scripted', status: 'waits-for-person', scripts: ['run.sh'], data: [] },
      { id: 'datafile', status: 'waits-for-person', scripts: [], data: ['terms.json'] },
      { id: 'bad', status: 'refused', reason: expect.any(String) },
      { id: 'missing', status: 'refused', reason: expect.any(String) },
      { id: 'constructor', status: 'refused', reason: expect.any(String) },
    ]);
    expect(fs.existsSync(path.join(p.root, '.claude/skills/plain'))).toBe(false);
    expect(p.cli(['team', 'check']).stdout).toMatch(/scripted.*(?:wait|person)/i);
  }, 240000);

  it('B244.C6: the team workflow reports them before the person accepts', () => {
    const p = project([analyst([])]);
    const text = p.text('.claude/skills/sdlc-team/SKILL.md');
    const report = text.search(/wait for a person/i);
    expect(report).toBeGreaterThan(-1);
    expect(text.indexOf('sdlc team check --json')).toBeLessThan(text.indexOf('sdlc team accept <role>'));
    expect(text.slice(0, text.indexOf('**Hand over'))).toMatch(/sdlc team check --json/);
  }, 180000);
});

describe('review round 1: draft statuses', () => {
  it('a skill already installed reads as installed, not as waiting', () => {
    const script = [SKILL_MD('scripted'), { path: 'run.sh', content: 'echo\n' }];
    const p = project([analyst(['scripted'])], [skill('scripted', script)]);
    p.cli(['team', 'sync', '--json']);
    p.cli(['team', 'accept', 'analyst', '--json']);
    p.cli(['team', 'accept', '--skill', 'scripted', '--json']);
    write(path.join(p.root, 'docs/agents/drafts/reviewer.md'),
      '---\nid: reviewer\ntitle: R\ndescription: R\nstages: [deploy]\nskills: [scripted]\n---\nBody\n');
    const drafts = p.cli(['team', 'check', '--json']).json().drafts as Array<{ role: string; skills: unknown[] }>;
    expect(drafts.find((item) => item.role === 'reviewer')?.skills).toEqual([{ id: 'scripted', status: 'installed' }]);
  }, 240000);

  it('a registry that does not answer reads as unavailable, not as refused', () => {
    const p = project([analyst(['plain'])], [skill('plain', [SKILL_MD('plain')])]);
    p.cli(['team', 'sync', '--json']);
    const sdlc = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(sdlc));
    config.mcp.servers.roles.command = ['node', path.join(p.root, 'no-such-registry.mjs').replace(/\\/g, '/')];
    write(sdlc, stringify(config));
    const out = p.cli(['team', 'check', '--json']).json();
    const draft = (out.drafts as Array<{ role: string; skills: unknown[] }>).find((item) => item.role === 'analyst');
    expect(draft?.skills).toEqual([{ id: 'plain', status: 'unavailable', reason: expect.any(String) }]);
    expect(p.cli(['team', 'check']).stdout).toMatch(/analyst: plain unavailable/);
  }, 240000);

  it('a blank description falls back to the title', () => {
    const p = project([analyst([], { description: '   ' })]);
    p.cli(['team', 'sync', '--json']);
    expect(draftFront(p.text('docs/agents/drafts/analyst.md')).description).toBe('Team analyst');
  }, 180000);
});
