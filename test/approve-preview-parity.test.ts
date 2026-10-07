import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.9.1, an independent check of `sdlc approve --preview` against `sdlc approve` itself: for each identity and gate
 * the preview's verdict and its first refusal are what the real approval does (exit code and error code), and the
 * preview leaves the record and the log as they were. An approval's own provenance stamp is not a change.
 */

const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', '  maintainer: [alice]', '',
].join('\n');

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-preview-parity-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  const as = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  expect(cli(['new', 'a', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/a/intent.md'), INTENT);
  const files = () => [read(path.join(root, 'openspec/changes/a/.sdlc.yaml')),
    read(path.join(root, 'openspec/.sdlc/log.jsonl'))];
  return { cli, as, files };
}

/** The preview's verdict, then the real approval's: both refuse with the same code, or both allow. */
function same(p: ReturnType<typeof project>, args: string[]) {
  const before = p.files();
  const preview = p.cli([...args, '--preview', '--json']).json();
  expect(p.files()).toEqual(before);
  const real = p.cli([...args, '--json']);
  const refused = real.code !== 0 ? real.json().status[0].code : undefined;
  expect({ allowed: preview.allowed, first: preview.refusals[0]?.rule })
    .toEqual({ allowed: real.code === 0, first: refused });
  return preview;
}

describe('sdlc approve --preview agrees with sdlc approve', () => {
  it('refusals: a missing role, an unknown person, a role the gate does not take, a blocked gate', () => {
    const p = project();
    p.as('Bob Petrov', 'bob@corp.example');
    expect(same(p, ['approve', 'intent', '--change', 'a']).allowed).toBe(false);
    p.as('Mallory', 'mallory@evil.example');
    expect(same(p, ['approve', 'intent', '--change', 'a']).refusals[0].rule).toBe('unknown_person');
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(same(p, ['approve', 'intent', '--change', 'a', '--as', 'engineer']).refusals[0].rule).toBe('missing_role');
    expect(same(p, ['approve', 'spec', '--change', 'a']).refusals[0].rule).toMatch(/^gate_(blocked|not_ready)$/);
  }, 180000);

  it('allowed: the approval goes through, and its own stamp does not count as a change', () => {
    const p = project();
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(same(p, ['approve', 'intent', '--change', 'a']).allowed).toBe(true);
    const after = p.cli(['approve', 'intent', '--change', 'a', '--preview', '--json']).json();
    expect(after).toMatchObject({ allowed: true, approvals: 1, needed: 1, changedSinceApproval: [] });
  }, 180000);
});
