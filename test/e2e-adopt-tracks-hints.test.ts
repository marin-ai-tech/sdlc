import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E4 (adopting node-semver) and E5 (tracks and human decisions) team runs of 2026-10-16, decided by
 * the owner for 0.22.3: hints that tell a person what sdlc cannot fix itself.
 *
 * finding 1: the project's `.gitignore` was an allow-list ("ignore everything in the root"); `openspec/`, the agent files and
 * REVIEW.md were ignored, and neither `init` nor `doctor` said so, so the team would never get the process.
 * finding 2: the adopt draft took "npm CLI robot <npm-cli+bot@github.com>" for a person; only `[bot]` and noreply addresses
 * were recognised as bots.
 * finding 1: `auto_waive: { kinds, tracks }` waives a gate when the kind OR the track matches; nothing said so, and
 * `tracks: [lite]` waives the gate for every change on lite. The guide says "or"; doctor warns about `tracks: [lite]`.
 * finding 4: two people writing one change record on a branch got a git conflict in `.sdlc.yaml`; nothing said how to
 * resolve it. doctor names the file and how to merge it.
 * finding 5: on a high-risk change `approve --preview` said "0 of 1, you may approve it" to the product owner and `roles who`
 * listed the product owner and the tech lead without saying both are needed.
 * finding 7: a high-risk change reached a gate nobody may approve (distinct approvers and the per-person limit); only
 * `roles who --change` said "no one". `status` and `next` warn now.
 */

function project(gitignore?: string) {
  const root = tempDir('sdlc-adopt-tracks-hints-');
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node -e 0' } }));
  if (gitignore) write(path.join(root, '.gitignore'), gitignore);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const file = path.join(root, 'openspec/sdlc.yaml');
  const change = (id: string, rel: string) => path.join(root, 'openspec/changes', id, rel);
  const setIdentity = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  return { root, cli, file, change, setIdentity };
}

type P = ReturnType<typeof project>;
type Check = { check: string; status: string; message: string; fix?: string };

function doctorChecks(p: P): Check[] {
  const r = p.cli(['doctor', '--json']);
  return r.json<{ checks: Check[] }>().checks;
}

function warnings(p: P, needle: RegExp): Check[] {
  return doctorChecks(p).filter((c) => c.status !== 'ok' && needle.test(`${c.message} ${c.fix ?? ''}`));
}

describe('finding 1: process files ignored by git', () => {
  it('init and doctor say that openspec/ is ignored by .gitignore and how to allow it', () => {
    const p = project('/*\n!/.gitignore\n!/package.json\n');
    const init = p.cli(['init', '--tools', 'none']);
    expect(init.code).toBe(0);
    expect(init.stdout + init.stderr).toMatch(/\.gitignore/);
    expect(init.stdout + init.stderr).toMatch(/openspec\//);
    const found = warnings(p, /gitignore/i);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message + (found[0].fix ?? '')).toMatch(/openspec\//);
  }, 240000);

  it('negative: an ordinary .gitignore gives no such warning', () => {
    const p = project('node_modules/\n');
    expect(p.cli(['init', '--tools', 'none']).stdout).not.toMatch(/ignored by \.gitignore/i);
    expect(warnings(p, /gitignore/i)).toEqual([]);
  }, 240000);
});

describe('finding 2: bots in the adopt draft', () => {
  it('bot-like names and addresses are left out; people whose names merely contain "bot" stay', () => {
    const p = project();
    const authors = ['npm CLI robot <npm-cli+bot@github.com>', 'renovate-bot <bot@renovateapp.com>',
      'Ann Lee <ann@example.com>', 'Robert Bottle <robert.bottle@example.com>', 'Abbott <abbott@example.com>'];
    for (const [index, author] of authors.entries()) {
      write(path.join(p.root, `src/f${index}.js`), `export const f${index} = ${index};\n`);
      git(p.root, ['add', '-A']);
      git(p.root, ['commit', '-q', '-m', `f${index}`, '--author', author]);
    }
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const draft = p.cli(['adopt', '--json']).json<{ people: Array<{ name: string; email: string }> }>();
    const emails = draft.people.map((person) => person.email);
    expect(emails).toEqual(expect.arrayContaining(['ann@example.com', 'robert.bottle@example.com', 'abbott@example.com']));
    expect(emails).not.toContain('npm-cli+bot@github.com');
    expect(emails).not.toContain('bot@renovateapp.com');
  }, 240000);
});

describe('finding 1: auto_waive matches the kind or the track', () => {
  function withPolicy(p: P, policy: Record<string, string[]>) {
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const config = parse(read(p.file));
    config.gates.plan = { ...config.gates.plan, auto_waive: policy };
    write(p.file, stringify(config));
  }

  it('the guide says "or"; doctor warns that tracks: [lite] waives the gate for every lite change', () => {
    const p = project();
    withPolicy(p, { kinds: ['docs'], tracks: ['lite'] });
    const guide = p.cli(['guide', 'config']).stdout;
    expect(guide).toMatch(/auto_waive[\s\S]{0,200}\bor\b/);
    const found = warnings(p, /auto_waive/);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toMatch(/lite/);
  }, 240000);

  it('negative: kinds only gives no warning', () => {
    const p = project();
    withPolicy(p, { kinds: ['docs'] });
    expect(warnings(p, /auto_waive/)).toEqual([]);
  }, 240000);
});

describe('finding 4: a git conflict in a change record', () => {
  it('doctor names the record with conflict markers and says how to merge it', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    const record = p.change('add-x', '.sdlc.yaml');
    const text = read(record);
    write(record, `${text}<<<<<<< HEAD\nverify:\n  status: passed\n=======\nnote: theirs\n>>>>>>> abc1234\n`);
    const found = warnings(p, /conflict/i);
    expect(found.length).toBeGreaterThan(0);
    expect(found[0].message).toMatch(/add-x/);
    expect(found[0].fix ?? '').toMatch(/both/i);
  }, 240000);

  it('negative: a clean record gives no conflict warning', () => {
    const p = project();
    expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    expect(warnings(p, /conflict/i)).toEqual([]);
  }, 240000);
});

const ROLES = (codeOwners: string) => [
  'version: 1', 'signing: off', 'people:',
  '  lida:  { name: Lida,  emails: [lida@team.example] }',
  '  petr:  { name: Petr,  emails: [petr@team.example] }',
  '  dima:  { name: Dima,  emails: [dima@team.example] }',
  '  katya: { name: Katya, emails: [katya@team.example] }',
  'roles:', '  product-owner: [petr]', '  tech-lead: [lida]', '  engineer: [dima]', `  code-owner: [${codeOwners}]`,
  '  release-manager: [lida]', '  maintainer: [lida]',
  'separation:', '  distinct_approvers: [[spec, review], [plan, review]]', '  max_gates_per_person: 2', '',
].join('\n');

/** A high-risk change with intent approved by petr and the spec files written; spec needs product-owner and tech-lead. */
function ok(r: { code: number | null; stdout: string; stderr: string }) {
  expect(r.code, r.stdout + r.stderr).toBe(0);
}

function highRisk(codeOwners: string) {
  const p = project();
  expect(p.cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const config = parse(read(p.file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  config.gates.spec = { ...config.gates.spec, high_risk_approvers: ['tech-lead'] };
  config.gates.plan = { ...config.gates.plan, high_risk_approvers: ['tech-lead'] };
  write(p.file, stringify(config));
  write(path.join(p.root, 'openspec/roles.yaml'), ROLES(codeOwners));
  p.setIdentity('Dima', 'dima@team.example');
  ok(p.cli(['new', 'b8-corrupt', '--risk', 'high', '--json']));
  write(p.change('b8-corrupt', 'intent.md'), FILES['intent.md']);
  p.setIdentity('Petr', 'petr@team.example');
  ok(p.cli(['approve', 'intent', '--change', 'b8-corrupt', '--json']));
  for (const rel of ['proposal.md', 'design.md', 'specs/greeting/spec.md']) write(p.change('b8-corrupt', rel), FILES[rel]);
  return p;
}

describe('finding 5: high risk says that the tech lead is needed too', () => {
  it('the product owner\'s preview and roles who name the tech-lead approval still needed', () => {
    const p = highRisk('lida');
    const preview = p.cli(['approve', 'spec', '--change', 'b8-corrupt', '--preview']);
    expect(preview.code, preview.stdout + preview.stderr).toBe(0);
    expect(preview.stdout).toMatch(/tech-lead/);
    const who = p.cli(['roles', 'who', 'spec', '--change', 'b8-corrupt']);
    expect(who.stdout).toMatch(/tech-lead/);
  }, 240000);
});

describe('finding 7: a gate nobody may approve is a warning', () => {
  function approvedByLida(codeOwners: string) {
    const p = highRisk(codeOwners);
    ok(p.cli(['approve', 'spec', '--change', 'b8-corrupt', '--json']));
    p.setIdentity('Lida', 'lida@team.example');
    ok(p.cli(['approve', 'spec', '--change', 'b8-corrupt', '--as', 'tech-lead', '--json']));
    return p;
  }

  it('status and next warn that review has no one who may approve it, before the build', () => {
    const p = approvedByLida('lida');
    const status = p.cli(['status', '--change', 'b8-corrupt']);
    expect(status.stdout + status.stderr).toMatch(/review[^\n]*no one|no one[^\n]*review/i);
    const next = p.cli(['next', '--change', 'b8-corrupt', '--json']).stdout;
    expect(next).toMatch(/review[^"]*no one|no one[^"]*review/i);
  }, 240000);

  it('negative: with a second code owner there is no such warning', () => {
    const p = approvedByLida('lida, katya');
    const status = p.cli(['status', '--change', 'b8-corrupt']);
    expect(status.stdout + status.stderr).not.toMatch(/no one/i);
  }, 240000);
});
