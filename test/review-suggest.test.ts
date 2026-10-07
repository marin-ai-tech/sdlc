import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B17: `sdlc review suggest --change <id>` proposes who reviews. Candidates are the people who may approve the review
 * gate (roles.yaml and its separation rules); the authors of the code are never candidates. Owners of the changed
 * paths by CODEOWNERS (last matching rule wins) come first, more owned files first; on a tie, the one with fewer open
 * reviews (other active changes waiting for a review approval that this person may give). Read-only: it decides
 * nothing and writes nothing, so an agent may run it.
 */

const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  '  carol: { name: Carol Smirnova, emails: [carol@corp.example] }',
  '  dave: { name: Dave Orlov, emails: [dave@corp.example] }',
  '  erin: { name: Erin Kim, emails: [erin@corp.example] }',
  'roles:',
  '  product-owner: [alice]',
  '  engineer: [alice, bob]',
  '  code-owner: [bob, carol, dave]',
  '  maintainer: [alice]',
  'separation:',
  '  author_cannot_approve: [review, release]',
  '  distinct_approvers: [[plan, review]]',
  '',
].join('\n');

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/a.js` (new)\n\n## Order of work\n1. Do.\n\n## Proof\n`node -e 0`\n\n## Rollback\nRevert.\n';
const TASKS = '# Tasks\n\n## 1. Work\n\n- [x] 1.1 Do it and verify node -e 0 passes\n';

function project(codeowners?: string) {
  const root = tempDir('sdlc-review-suggest-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const as = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  as('Alice Ivanova', 'alice@corp.example');
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.verify.commands = [{ name: 'ok', run: 'node -e 0', required: true }];
  write(file, stringify(config));
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  if (codeowners) write(path.join(root, '.github/CODEOWNERS'), codeowners);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'setup']);
  return { root, cli, as };
}

/** Code for change `pay` on a feature branch, written by Dave. */
function daveWrites(p: ReturnType<typeof project>, files: string[]): void {
  git(p.root, ['checkout', '-q', '-b', 'feature']);
  for (const file of files) write(path.join(p.root, file), 'export const x = 1;\n');
  git(p.root, ['add', '-A']);
  git(p.root, ['-c', 'user.name=Dave Orlov', '-c', 'user.email=dave@corp.example', 'commit', '-qm', 'pay']);
  expect(p.cli(['new', 'pay', '--json']).code).toBe(0);
}

function suggest(p: ReturnType<typeof project>, extra: NodeJS.ProcessEnv = {}) {
  const r = p.cli(['review', 'suggest', '--change', 'pay', '--base', 'main', '--json'], extra);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r.json();
}

describe('sdlc review suggest', () => {
  it('puts the owners of the changed paths first and never suggests an author', () => {
    const p = project('* bob@corp.example\n/src/payments/ carol@corp.example erin@corp.example\n');
    daveWrites(p, ['src/payments/charge.js']);
    const out = suggest(p);
    expect(out.suggested).toBe('carol');
    const ids = out.candidates.map((c: { person: string }) => c.person);
    expect(ids).toEqual(['carol', 'bob']);
    expect(out.candidates[0].owns).toEqual(['src/payments/charge.js']);
    expect(out.candidates[1].owns).toEqual([]);
    // Dave wrote the code; Erin owns the path but may not approve the review gate; Alice holds no review role.
    for (const id of ['dave', 'erin', 'alice']) expect(ids, id).not.toContain(id);
    expect(out.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ person: 'dave' })]));
  }, 180000);

  it('on a tie, suggests the one with fewer open reviews', () => {
    const p = project();
    daveWrites(p, ['src/app.js']);
    // Another change waits for a review approval Carol may give; Bob approved its plan, so he may not review it.
    expect(p.cli(['new', 'other', '--json']).code).toBe(0);
    const other = (file: string) => path.join(p.root, 'openspec/changes/other', file);
    write(other('intent.md'), INTENT);
    expect(p.cli(['waive', 'intent', '--change', 'other', '--note', 't', '--json']).code).toBe(0);
    expect(p.cli(['waive', 'spec', '--change', 'other', '--note', 't', '--json']).code).toBe(0);
    write(other('plan.md'), PLAN);
    write(other('tasks.md'), TASKS);
    p.as('Bob Petrov', 'bob@corp.example');
    const plan = p.cli(['approve', 'plan', '--change', 'other', '--json']);
    expect(plan.code, plan.stdout).toBe(0);
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(p.cli(['verify', '--change', 'other', '--json']).code).toBe(0);
    write(other('review.md'), '# Review: other\n\n## Findings\n\nNone.\n');
    const waiting = p.cli(['next', '--change', 'other', '--json']).json().next;
    expect(waiting).toMatchObject({ gate: 'review', actor: 'human' });
    const out = suggest(p);
    const open = Object.fromEntries(out.candidates.map((c: { person: string; openReviews: number }) =>
      [c.person, c.openReviews]));
    expect(open).toEqual({ bob: 0, carol: 1 });
    expect(out.suggested).toBe('bob');
  }, 240000);

  it('negative: an agent may run it, and it writes nothing', () => {
    const p = project('* carol@corp.example\n');
    daveWrites(p, ['src/app.js']);
    const record = read(path.join(p.root, 'openspec/changes/pay/.sdlc.yaml'));
    const log = read(path.join(p.root, 'openspec/.sdlc/log.jsonl'));
    expect(suggest(p, { CLAUDECODE: '1' }).suggested).toBe('carol');
    expect(read(path.join(p.root, 'openspec/changes/pay/.sdlc.yaml'))).toBe(record);
    expect(read(path.join(p.root, 'openspec/.sdlc/log.jsonl'))).toBe(log);
  }, 180000);

  it('negative: without roles.yaml there is nobody to suggest, and it says so', () => {
    const p = project();
    git(p.root, ['rm', '-q', 'openspec/roles.yaml']);
    git(p.root, ['commit', '-q', '-m', 'no roles']);
    daveWrites(p, ['src/app.js']);
    const r = p.cli(['review', 'suggest', '--change', 'pay', '--base', 'main', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('roles_required');
  }, 180000);
});
