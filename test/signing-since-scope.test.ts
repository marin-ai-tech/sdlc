import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { git, humanEnv, initGitRepo, runCli, tempDir, write } from './helpers.js';

/**
 * Review of 0.23.1 part B (finding 1): `signing_since` is resolved with git where signatures are checked (`sdlc approvals
 * verify`, the evidence export, a roles.yaml proposal), not on every read of roles.yaml. A value git cannot resolve (a
 * typo, a commit missing from a clone) does not break commands that never check signatures: a person can still
 * approve, and `sdlc doctor` reports the problem instead of failing on it.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-signing-since-scope-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const roles = {
    version: 1, signing: 'warn', signing_since: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    people: { pat: { name: 'Pat Owner', emails: ['pat@example.com'] } },
    roles: { 'product-owner': ['pat'], 'tech-lead': ['pat'], engineer: ['pat'], 'code-owner': ['pat'],
      'release-manager': ['pat'], maintainer: ['pat'] },
  };
  write(path.join(root, 'openspec/roles.yaml'), stringify(roles));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc and roles']);
  return { root, cli };
}

describe('finding 1 review: an unresolvable signing_since breaks only the signature checks', () => {
  it('a person approves; doctor reports signing_since; approvals verify refuses it', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(path.join(p.root, 'openspec/changes/add-x/intent.md'), INTENT);
    const approved = p.cli(['approve', 'intent', '--change', 'add-x', '--json']);
    expect(approved.code, approved.stdout + approved.stderr).toBe(0);
    const doctor = p.cli(['doctor']);
    expect(doctor.stdout + doctor.stderr).toMatch(/signing_since/);
    expect(doctor.stdout + doctor.stderr).not.toMatch(/\n\s+at .+\.js:\d+/);
    const verify = p.cli(['approvals', 'verify', '--json']);
    expect(verify.code).not.toBe(0);
    expect(verify.stdout + verify.stderr).toMatch(/signing_since/);
  }, 240000);
});
