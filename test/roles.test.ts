import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { allowedSigners, changeAuthors, checkApproval, parseRolesFile, personByEmail } from '../src/core/roles.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const ROLES = [
  'version: 1',
  'signing: off',
  'people:',
  '  alice: { name: Alice Ivanova, emails: [Alice@Corp.example], signing_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIalice alice@corp" }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  '  carol: { name: Carol Smirnova, emails: [carol@corp.example] }',
  'roles:',
  '  product-owner: [alice]',
  '  engineer: [bob, carol]',
  '  tech-lead: [bob]',
  '  code-owner: [bob, carol]',
  '  maintainer: [alice]',
  'separation:',
  '  author_cannot_approve: [review, release]',
  '  distinct_approvers: [[spec, review], [plan, review]]',
  '  max_gates_per_person: 2',
  '',
].join('\n');

describe('roles.yaml (core)', () => {
  it('parses people, lower-cases emails, roles and separation rules', () => {
    const r = parseRolesFile(ROLES);
    expect(r.signing).toBe('off');
    expect(personByEmail(r, 'alice@corp.EXAMPLE')).toMatchObject({ id: 'alice', emails: ['alice@corp.example'] });
    expect(r.roles['code-owner']).toEqual(['bob', 'carol']);
    expect(r.separation).toEqual({ authorCannotApprove: ['review', 'release'], distinctApprovers: [['spec', 'review'], ['plan', 'review']], maxGatesPerPerson: 2 });
  });

  it('negative: unknown people in roles, duplicate emails, unknown gates and bad signing modes are refused', () => {
    expect(() => parseRolesFile(ROLES.replace('code-owner: [bob, carol]', 'code-owner: [bob, dave]'))).toThrow(/dave/);
    expect(() => parseRolesFile(ROLES.replace('emails: [carol@corp.example]', 'emails: [bob@corp.example]'))).toThrow(/bob@corp\.example/);
    expect(() => parseRolesFile(ROLES.replace('[review, release]', '[review, deploy]'))).toThrow(/deploy/);
    expect(() => parseRolesFile(ROLES.replace('signing: off', 'signing: sometimes'))).toThrow(/signing/);
  });

  it('checkApproval: identity, role, author, distinct approvers and the per-person cap', () => {
    const r = parseRolesFile(ROLES);
    const base = { gate: 'review' as const, roles: ['code-owner'], authors: ['bob@corp.example'], approvals: {} };
    expect(checkApproval(r, { ...base, email: 'carol@corp.example' })).toMatchObject({ allowed: true, person: { id: 'carol' } });
    expect(checkApproval(r, { ...base, email: 'mallory@evil.example' }).refusals.map((x) => x.rule)).toEqual(['unknown_person']);
    expect(checkApproval(r, { ...base, email: 'alice@corp.example' }).refusals.map((x) => x.rule)).toContain('missing_role');
    expect(checkApproval(r, { ...base, email: 'bob@corp.example' }).refusals.map((x) => x.rule)).toContain('author_cannot_approve');
    const distinct = checkApproval(r, { ...base, email: 'carol@corp.example', authors: [], approvals: { spec: ['carol@corp.example'] } });
    expect(distinct.refusals.map((x) => x.rule)).toContain('distinct_approvers');
    const cap = checkApproval(r, { gate: 'plan', roles: ['engineer'], email: 'bob@corp.example', authors: [], approvals: { intent: ['bob@corp.example'], spec: ['bob@corp.example'] } });
    expect(cap.refusals.map((x) => x.rule)).toContain('max_gates_per_person');
  });

  it('negative: authorship does not block gates outside author_cannot_approve', () => {
    const r = parseRolesFile(ROLES);
    const check = checkApproval(r, { gate: 'plan', roles: ['engineer'], email: 'bob@corp.example', authors: ['bob@corp.example'], approvals: {} });
    expect(check.allowed).toBe(true);
  });

  it('allowed_signers lists people with an ssh key, one principal per email', () => {
    const lines = allowedSigners(parseRolesFile(ROLES)).trim().split('\n');
    expect(lines).toEqual(['alice@corp.example ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIalice alice@corp']);
  });

  it('changeAuthors reads commit authors and Co-authored-by trailers outside openspec/', () => {
    const root = tempDir('sdlc-authors-');
    initGitRepo(root);
    git(root, ['checkout', '-q', '-b', 'main']);
    write(path.join(root, 'README.md'), '# x\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'base']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    write(path.join(root, 'src/calc.js'), 'export const add = (a, b) => a + b;\n');
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=Bob', '-c', 'user.email=Bob@Corp.example', 'commit', '-qm', 'add\n\nCo-authored-by: Carol <carol@corp.example>']);
    write(path.join(root, 'openspec/changes/x/review.md'), '# r\n');
    git(root, ['add', '-A']);
    git(root, ['-c', 'user.name=Alice', '-c', 'user.email=alice@corp.example', 'commit', '-qm', 'review notes']);
    expect(changeAuthors(root, 'main').sort()).toEqual(['bob@corp.example', 'carol@corp.example']);
  });
});

describe('roles in the CLI', () => {
  const INTENT = '# Intent: x\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n';

  function project() {
    const root = tempDir('sdlc-roles-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['checkout', '-q', '-b', 'main']);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const as = (email: string) => ({ GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email });
    const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
    const setIdentity = (name: string, email: string) => {
      git(root, ['config', 'user.name', name]);
      git(root, ['config', 'user.email', email]);
    };
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    write(path.join(root, 'openspec/roles.yaml'), ROLES);
    return { root, cli, as, setIdentity };
  }

  it('approve identifies the person from roles.yaml; unknown people and missing roles are refused with who can approve', () => {
    const { root, cli, setIdentity } = project();
    cli(['new', 'add-calc', '--json']);
    write(path.join(root, 'openspec/changes/add-calc/intent.md'), INTENT);
    setIdentity('Mallory', 'mallory@evil.example');
    const unknown = cli(['approve', 'intent', '--change', 'add-calc', '--json']);
    expect(unknown.code).toBe(1);
    expect(unknown.json().status[0].code).toBe('unknown_person');
    setIdentity('Bob', 'bob@corp.example');
    const wrongRole = cli(['approve', 'intent', '--change', 'add-calc', '--json']);
    expect(wrongRole.json().status[0].code).toBe('missing_role');
    expect(wrongRole.json().status[0].message).toMatch(/alice/i);
    setIdentity('Alice', 'alice@corp.example');
    const ok = cli(['approve', 'intent', '--change', 'add-calc', '--json']);
    expect(ok.code, ok.stdout).toBe(0);
    expect(parse(read(path.join(root, 'openspec/changes/add-calc/.sdlc.yaml'))).gates.intent.approvals[0]).toMatchObject({ role: 'product-owner', by: expect.stringMatching(/alice@corp\.example/) });
  });

  it('roles who shows, per gate, who may approve and why others may not (authors included)', () => {
    const { root, cli } = project();
    cli(['new', 'add-calc', '--json']);
    git(root, ['checkout', '-q', '-b', 'feature']);
    write(path.join(root, 'src/calc.js'), 'export const add = (a, b) => a + b;\n');
    git(root, ['add', 'src/calc.js']);
    git(root, ['-c', 'user.name=Bob', '-c', 'user.email=bob@corp.example', 'commit', '-qm', 'calc']);
    const r = cli(['roles', 'who', 'review', '--change', 'add-calc', '--base', 'main', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().allowed.map((p: { id: string }) => p.id)).toEqual(['carol']);
    expect(r.json().refused).toEqual(expect.arrayContaining([expect.objectContaining({ person: 'bob', rules: expect.arrayContaining(['author_cannot_approve']) })]));
    const matrix = cli(['roles', 'check', '--change', 'add-calc', '--base', 'main', '--json']).json();
    expect(matrix.gates.map((g: { gate: string }) => g.gate)).toEqual(expect.arrayContaining(['intent', 'spec', 'plan', 'review']));
    const text = cli(['roles', 'who', 'review', '--change', 'add-calc', '--base', 'main']).stdout;
    expect(text).not.toMatch(/^\s*[{[]/);
    expect(text).toMatch(/Carol/);
    expect(text).toMatch(/Bob[^\n]*author/i);
  });

  it('negative: with roles.yaml, --by cannot record someone else (the record is the git identity\'s person)', () => {
    const { root, cli, setIdentity } = project();
    cli(['new', 'add-calc', '--json']);
    write(path.join(root, 'openspec/changes/add-calc/intent.md'), INTENT);
    setIdentity('Alice', 'alice@corp.example');
    const forged = cli(['approve', 'intent', '--change', 'add-calc', '--by', 'Carol <carol@corp.example>', '--json']);
    expect(forged.code).toBe(1);
    expect(forged.json().status[0].code).toBe('by_mismatch');
    const own = cli(['approve', 'intent', '--change', 'add-calc', '--by', 'Alice Ivanova <ALICE@corp.example>', '--json']);
    expect(own.code, own.stdout).toBe(0);
    expect(parse(read(path.join(root, 'openspec/changes/add-calc/.sdlc.yaml'))).gates.intent.approvals[0]).toMatchObject({ person: 'alice' });
  });

  it('roles migrate moves roles from sdlc.yaml to roles.yaml; people only; refused for agents', () => {
    const root = tempDir('sdlc-roles-migrate-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    runCli(['init', '--tools', 'none', '--json'], root, env);
    const config = parse(read(path.join(root, 'openspec/sdlc.yaml')));
    write(path.join(root, 'openspec/sdlc.yaml'), stringify({ ...config, roles: { 'code-owner': ['lead@example.com'] } }));
    expect(runCli(['roles', 'migrate', '--json'], root, { ...env, CLAUDECODE: '1' }).json().status[0].code).toBe('agent_cannot_edit_roles');
    const r = runCli(['roles', 'migrate', '--json'], root, env);
    expect(r.code, r.stderr).toBe(0);
    const roles = parse(read(path.join(root, 'openspec/roles.yaml')));
    expect(Object.values(roles.people as Record<string, { emails: string[] }>)[0].emails).toEqual(['lead@example.com']);
    expect(roles.separation.author_cannot_approve).toEqual(['review', 'release']);
    expect(roles.signing).toBe('off');
  });

  it('negative: without roles.yaml, 0.5.0 behaviour holds (anyone with a git identity may approve)', () => {
    const root = tempDir('sdlc-roles-none-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    runCli(['init', '--tools', 'none', '--json'], root, env);
    runCli(['new', 'add-calc', '--json'], root, env);
    write(path.join(root, 'openspec/changes/add-calc/intent.md'), INTENT);
    expect(runCli(['approve', 'intent', '--change', 'add-calc', '--json'], root, env).code).toBe(0);
  });

  it('the hook denies agents editing roles.yaml or running roles migrate', () => {
    const root = tempDir('sdlc-roles-hook-');
    const ctx = { paths: projectPaths(root), config: defaultConfig() };
    expect(evaluateToolCall(normalizeToolCall('Edit', { file_path: path.join(root, 'openspec/roles.yaml') }, root), ctx)).toMatchObject({ decision: 'deny' });
    expect(evaluateToolCall(normalizeToolCall('Bash', { command: 'sdlc roles migrate' }, root), ctx)).toMatchObject({ decision: 'deny' });
    expect(evaluateToolCall(normalizeToolCall('Bash', { command: 'sdlc roles check' }, root), ctx).decision).toBe('allow');
  });
});
