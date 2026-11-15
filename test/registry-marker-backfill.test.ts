import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

// OpenSpec change accepted-roles-get-their-source-marker (B316). A role accepted before the registry gave a source
// marker (sdlc 0.31.1) stays local_only for SkillForge. The next sync keeps a draft that carries the registry's
// marker and names the command; only a person's `sdlc team accept` records it.

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-registry.mjs').replace(/\\/g, '/');
const sha = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const BODY = '# Role: team developer\n\nWrite the code the corporate way.\n{{artifacts}}\n{{project}}\n';
const AGENT = { CLAUDECODE: '1' };
const MARK = (version: string) => ({ key: 'skillforge-source', value: `agent/developer@${version}` });

function developer(version: string, marker?: { key: string; value: string }) {
  return {
    id: 'developer', version, title: 'Team developer', stages: ['build'],
    tools: ['read', 'grep', 'glob', 'bash', 'edit', 'write'], readonly: false, skills: [], body: BODY,
    checksum: sha(BODY), ...(marker ? { marker } : {}),
  };
}

function project() {
  const root = tempDir('sdlc-b316-');
  const file = path.join(tempDir('sdlc-b316-data-'), 'registry.json');
  const serve = (role: unknown) => fs.writeFileSync(file, JSON.stringify({ roles: [role], skills: [] }));
  serve(developer('3.0.0'));
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_REGISTRY_FILE: file });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'claude,opencode', '--json']).code).toBe(0);
  const sdlc = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(sdlc));
  config.mcp = { servers: { roles: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.team = { registry: 'roles' };
  write(sdlc, stringify(config));
  const text = (rel: string) => read(path.join(root, rel));
  const head = (rel: string) => text(rel).split('\n---')[0];
  const role = () => JSON.parse(text('openspec/.sdlc/team.json')).roles.developer;
  return { root, cli, serve, text, head, role };
}

const AGENT_FILES = ['.opencode/agents/sdlc-developer.md', '.claude/agents/sdlc-developer.md'];

/** The state of a project that accepted `developer` 3.0.0 on 0.31.1, before the registry gave a marker. */
function acceptedWithoutMarker() {
  const p = project();
  expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
  const accept = p.cli(['team', 'accept', 'developer', '--json']);
  expect(accept.code, accept.stdout + accept.stderr).toBe(0);
  expect(p.role().marker).toBeUndefined();
  p.serve(developer('3.0.0', MARK('3')));
  return p;
}

describe('B316.C1 a role accepted on 0.31.1', () => {
  it('sync keeps a draft with the marker, names the command, and the role agent stays without it', () => {
    const p = acceptedWithoutMarker();
    const sync = p.cli(['team', 'sync']);
    const out = sync.stdout + sync.stderr;
    expect(sync.code, out).toBe(0);
    expect(out).toContain('sdlc team accept developer');
    expect(p.text('docs/agents/drafts/developer.md')).toContain('Write the code the corporate way.');
    const team = JSON.parse(p.text('openspec/.sdlc/team.json'));
    expect(team.drafts.developer.marker).toEqual(MARK('3'));
    expect(p.role().marker).toBeUndefined();
    for (const file of AGENT_FILES) expect(p.head(file), file).not.toContain('skillforge-source');
  }, 240000);

  it('the JSON answer marks the draft as marker only', () => {
    const p = acceptedWithoutMarker();
    const sync = p.cli(['team', 'sync', '--json']);
    expect(sync.code, sync.stdout + sync.stderr).toBe(0);
    expect(sync.json().markerOnly).toEqual(['developer']);
  }, 240000);

  it('negative: a role accepted with the same marker gets no draft', () => {
    const p = project();
    p.serve(developer('3.0.0', MARK('3')));
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    const sync = p.cli(['team', 'sync', '--json']).json();
    expect(sync.created).not.toContain('docs/agents/drafts/developer.md');
    expect(sync.kept).toContainEqual({ id: 'developer', reason: 'accepted' });
    expect(sync.markerOnly ?? []).not.toContain('developer');
  }, 240000);
});

describe('B316.C2 the person accepts it', () => {
  it('team.json records the marker and both role agents carry it', () => {
    const p = acceptedWithoutMarker();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    expect(p.cli(['update', '--json']).code).toBe(0);
    expect(p.role().marker).toEqual(MARK('3'));
    for (const file of AGENT_FILES) expect(p.head(file), file).toContain('skillforge-source: agent/developer@3');
  }, 240000);
});

describe('B316 review F1: the project rules a person added survive the marker', () => {
  it('accepting the marker-only draft keeps the accepted text and records only the marker', () => {
    const p = project();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    const draft = path.join(p.root, 'docs/agents/drafts/developer.md');
    write(draft, `${read(draft).trimEnd()}\n\n## Project rules\n\n- Errors go through src/errors.ts.\n`);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    p.serve(developer('3.0.0', MARK('3')));
    const sync = p.cli(['team', 'sync', '--json']).json();
    expect(sync.markerOnly).toEqual(['developer']);
    expect(p.text('docs/agents/drafts/developer.md')).toContain('Errors go through src/errors.ts.');
    const accept = p.cli(['team', 'accept', 'developer', '--json']);
    expect(accept.code, accept.stdout + accept.stderr).toBe(0);
    expect(accept.json().changedFromSource).toBe(false);
    expect(p.text('docs/agents/developer.md')).toContain('Errors go through src/errors.ts.');
    expect(p.role().marker).toEqual(MARK('3'));
  }, 240000);

  it('review F2: an edited draft left in place is not reported as carrying the marker', () => {
    const p = acceptedWithoutMarker();
    write(path.join(p.root, 'docs/agents/drafts/developer.md'), '# Role: someone wrote this by hand\n');
    const sync = p.cli(['team', 'sync', '--json']).json();
    expect(sync.markerOnly ?? []).not.toContain('developer');
  }, 240000);
});

describe('B316.C3 a new version moves the marker', () => {
  it('the role agents name version 4 and not 3', () => {
    const p = acceptedWithoutMarker();
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    p.serve(developer('4.0.0', MARK('4')));
    expect(p.cli(['team', 'sync', '--json']).code).toBe(0);
    expect(p.cli(['team', 'accept', 'developer', '--json']).code).toBe(0);
    for (const file of AGENT_FILES) {
      expect(p.head(file), file).toContain('skillforge-source: agent/developer@4');
      expect(p.head(file), file).not.toContain('agent/developer@3');
    }
  }, 300000);
});

describe('B316.C4 negative: nothing without a person', () => {
  it('an agent syncs and updates, its accept is refused, and no marker is recorded', () => {
    const p = acceptedWithoutMarker();
    expect(p.cli(['team', 'sync', '--json'], AGENT).code).toBe(0);
    expect(p.cli(['update', '--json'], AGENT).code).toBe(0);
    const accept = p.cli(['team', 'accept', 'developer', '--json'], AGENT);
    expect(accept.code).not.toBe(0);
    expect(accept.json().status[0].code).toBe('agent_cannot_approve');
    expect(p.role().marker).toBeUndefined();
    for (const file of AGENT_FILES) expect(p.head(file), file).not.toContain('skillforge-source');
  }, 240000);
});
