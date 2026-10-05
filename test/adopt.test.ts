import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { parseRolesFile } from '../src/core/roles.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const AGENT = { CLAUDECODE: '1' };
const INTENT = [
  '# Intent: export', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function commitAs(root: string, author: string, file: string): void {
  write(path.join(root, file), `${file}\n`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--author', author, '-m', `add ${file}`]);
}

/** An existing Node project, initialized with sdlc before its code and CI were added. */
function project() {
  const root = tempDir('sdlc-adopt-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  // Every commit names its author, so the repository's own identity (Pat) is not one of the people.
  git(root, ['commit', '-q', '--allow-empty', '--author', 'Alice Ivanova <alice@corp.example>', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const config = path.join(root, 'openspec/sdlc.yaml');
  const yaml = parse(read(config));
  yaml.enforcement.protected_paths = ['secrets/**'];
  write(config, `${JSON.stringify(yaml, null, 2)}\n`);
  write(path.join(root, 'package.json'), JSON.stringify({
    name: 'claims', scripts: { test: 'vitest run', lint: 'eslint .' },
  }, null, 2));
  write(path.join(root, '.github/workflows/ci.yml'), 'on: push\njobs: {}\n');
  write(path.join(root, '.github/CODEOWNERS'), '* @alice-gh alice@corp.example\n/src/payments/ bob@corp.example\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--author', 'Alice Ivanova <alice@corp.example>', '-m', 'project files']);
  const alice = 'Alice Ivanova <Alice@Corp.example>';
  commitAs(root, alice, 'src/a.js');
  commitAs(root, alice, 'src/b.js');
  commitAs(root, 'Carol Smirnova <carol@corp.example>', 'src/c.js');
  commitAs(root, 'Carol Smirnova <carol@corp.example>', 'tests/c.test.js');
  commitAs(root, 'Bob Petrov <bob@corp.example>', 'src/payments/pay.js');
  for (const file of ['deps-1.txt', 'deps-2.txt', 'deps-3.txt', 'deps-4.txt', 'deps-5.txt']) {
    commitAs(root, 'dependabot[bot] <49699333+dependabot[bot]@users.noreply.github.com>', file);
  }
  const events = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n')
    .map((entry) => JSON.parse(entry).event as string);
  return { root, cli, config, events, roles: path.join(root, 'openspec/roles.yaml') };
}

describe('sdlc adopt: the analysis', () => {
  it('finds the stack, CI, verify commands, protected paths and people, and writes nothing', () => {
    const { cli, config, roles, events } = project();
    const before = { config: read(config), events: events().length };
    const r = cli(['adopt', '--json'], AGENT);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const out = r.json();
    expect(out.stack.map((s: { id: string }) => s.id)).toEqual(['node']);
    expect(out.ci).toEqual(['.github/workflows/ci.yml']);
    const runs = out.proposal.verify.commands.map((c: { run: string }) => c.run);
    expect(runs).toEqual(expect.arrayContaining(['npm test', 'npm run lint']));
    expect(out.proposal.enforcement.protected_paths).toEqual(
      expect.arrayContaining(['.github/workflows/**', '.github/CODEOWNERS']),
    );
    const people = Object.fromEntries(out.people.map((p: { email: string }) => [p.email, p]));
    expect(people['alice@corp.example']).toMatchObject({ name: 'Alice Ivanova', commits: 4 });
    expect(people['alice@corp.example'].sources).toEqual(expect.arrayContaining(['git', 'codeowners']));
    expect(people['bob@corp.example'].sources).toEqual(expect.arrayContaining(['git', 'codeowners']));
    expect(people['carol@corp.example']).toMatchObject({ commits: 2, sources: ['git'] });
    expect(out.owners_unresolved).toEqual(['@alice-gh']);
    expect(out.proposal.roles).toMatchObject({ path: 'openspec/roles.yaml', exists: false });
    // Review finding: only catch-all owners hold the repository-wide code-owner role; scoped owners are listed.
    expect(out.proposal.roles.roles['code-owner']).toEqual(['alice']);
    expect(out.owners_scoped).toEqual([{ owner: 'bob@corp.example', patterns: ['/src/payments/'] }]);
    // Review finding: every role a gate needs gets a holder (the person who will apply, to check), or approvals
    // stop working once roles.yaml exists; maintainer is that person, not the top committer.
    for (const role of ['product-owner', 'engineer', 'tech-lead', 'release-manager', 'maintainer']) {
      expect(out.proposal.roles.roles[role], role).toEqual(['pat']);
    }
    expect(out.people.map((p: { email: string }) => p.email).join(' '), 'bots are not people').not.toMatch(/bot|noreply/);
    expect(out.apply).toBe('sdlc adopt --apply');
    expect(read(config)).toBe(before.config);
    expect(fs.existsSync(roles)).toBe(false);
    expect(events().length).toBe(before.events);
  });

  it('negative: nothing already configured is proposed again, and no other stack is guessed', () => {
    const { cli } = project();
    const out = cli(['adopt', '--json']).json();
    expect(out.stack.map((s: { id: string }) => s.id)).not.toContain('go');
    expect(out.stack.map((s: { id: string }) => s.id)).not.toContain('python');
    expect(out.proposal.enforcement.protected_paths).not.toContain('secrets/**');
    const configured = ['**/*.test.*', '**/tests/**'];
    for (const glob of configured) expect(out.proposal.enforcement.test_paths).not.toContain(glob);
    expect(out.people.map((p: { email?: string }) => p.email)).not.toContain(undefined);
  });

  it('the text output shows the draft and tells a person how to apply it', () => {
    const { cli } = project();
    const r = cli(['adopt']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('npm test');
    expect(r.stdout).toContain('.github/workflows/**');
    expect(r.stdout).toContain('sdlc adopt --apply');
    expect(r.stdout, 'roles are shown as text, not JSON').not.toMatch(/\{"/);
    expect(r.stdout).toMatch(/code-owner: alice$/m);
    expect(r.stdout).toMatch(/bob@corp\.example[^\n]*\/src\/payments\//);
  });
});

describe('sdlc adopt --apply', () => {
  it('a person applies the draft: settings are merged, roles.yaml is written, the log records it', () => {
    const { root, cli, config, roles, events } = project();
    const r = cli(['adopt', '--apply', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const yaml = parse(read(config));
    const runs = yaml.verify.commands.map((c: { run: string }) => c.run);
    expect(runs).toEqual(expect.arrayContaining(['npm test', 'npm run lint']));
    expect(yaml.enforcement.protected_paths).toEqual(
      expect.arrayContaining(['secrets/**', '.github/workflows/**', '.github/CODEOWNERS']),
    );
    const file = parseRolesFile(read(roles));
    expect(file.signing).toBe('off');
    expect(file.people.map((p) => p.id).sort()).toEqual(['alice', 'bob', 'carol', 'pat']);
    expect(file.roles['code-owner']).toEqual(['alice']);
    expect(events().filter((e) => e === 'adopt.applied')).toHaveLength(1);
    const entry = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n')
      .map((l) => JSON.parse(l))
      .find((e) => e.event === 'adopt.applied');
    expect(entry.by, 'the log names who applied').toMatch(/pat@example\.com/);
  });

  it('negative: applying twice changes nothing the second time', () => {
    const { cli, config, roles, events } = project();
    expect(cli(['adopt', '--apply', '--json']).code).toBe(0);
    const once = { config: read(config), roles: read(roles) };
    expect(cli(['adopt', '--apply', '--json']).code).toBe(0);
    expect(read(config)).toBe(once.config);
    expect(read(roles)).toBe(once.roles);
    expect(events().filter((e) => e === 'adopt.applied')).toHaveLength(1);
    const again = cli(['adopt', '--json']).json();
    expect(again.proposal.verify.commands).toEqual([]);
    expect(again.proposal.enforcement.protected_paths).toEqual([]);
    expect(again.proposal.roles.exists).toBe(true);
  });

  it('negative: an existing roles.yaml is never overwritten', () => {
    const { root, cli, roles } = project();
    const existing = [
      'version: 1', 'signing: off', 'people:', '  dana: { name: Dana, emails: [dana@corp.example] }',
      'roles:', '  maintainer: [dana]', '',
    ].join('\n');
    write(roles, existing);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '--author', 'Dana <dana@corp.example>', '-m', 'roles']);
    expect(cli(['adopt', '--json']).json().proposal.roles.exists).toBe(true);
    expect(cli(['adopt', '--apply', '--json']).code).toBe(0);
    expect(read(roles)).toBe(existing);
  });

  it('after applying, the person can still approve a new change\'s intent', () => {
    const { root, cli } = project();
    expect(cli(['adopt', '--apply', '--json']).code).toBe(0);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'adopt']);
    expect(cli(['new', 'add-export', '--json']).code).toBe(0);
    write(path.join(root, 'openspec/changes/add-export/intent.md'), INTENT);
    const r = cli(['approve', 'intent', '--change', 'add-export', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  });

  it('negative: roles kept in sdlc.yaml are not replaced; the person is told to migrate them', () => {
    const { cli, config, roles } = project();
    const yaml = parse(read(config));
    yaml.roles = { 'product-owner': ['alice@corp.example'] };
    write(config, `${JSON.stringify(yaml, null, 2)}\n`);
    const draft = cli(['adopt', '--json']).json();
    expect(draft.proposal.roles.skip).toBe('legacy_roles');
    expect(cli(['adopt']).stdout).toContain('sdlc roles migrate');
    expect(cli(['adopt', '--apply', '--json']).code).toBe(0);
    expect(fs.existsSync(roles)).toBe(false);
    expect(parse(read(config)).roles).toEqual({ 'product-owner': ['alice@corp.example'] });
  });

  it('negative: an agent cannot apply, and nothing is written', () => {
    const { cli, config, roles, events } = project();
    const before = { config: read(config), events: events().length };
    const r = cli(['adopt', '--apply', '--json'], AGENT);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_adopt');
    expect(read(config)).toBe(before.config);
    expect(fs.existsSync(roles)).toBe(false);
    expect(events().length).toBe(before.events);
  });

  it('is listed in help', () => {
    const { cli } = project();
    const commands = cli(['help', '--json']).json().commands as Array<{ name: string; actor: string }>;
    expect(commands.find((c) => c.name === 'adopt')).toMatchObject({ actor: 'any' });
    expect(commands.find((c) => c.name === 'adopt --apply')).toMatchObject({ actor: 'human' });
  });
});
