import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.9.1: `sdlc approve <gate> --change <id> --preview` — what I am about to approve, before I approve it: the gate's
 * artifacts, what changed since the last approval, the approvals so far and how many are needed, and whether I may
 * approve (the same checks as the approval). It writes nothing. Like `approve`, it is a person's command.
 */

const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  '  bob: { name: Bob Petrov, emails: [bob@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [bob]', '  code-owner: [bob]', '  maintainer: [alice]', '',
].join('\n');

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-approve-preview-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const as = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  expect(cli(['new', 'a', '--json']).code).toBe(0);
  const intent = path.join(root, 'openspec/changes/a/intent.md');
  write(intent, INTENT);
  const preview = (extra: NodeJS.ProcessEnv = {}) => cli(['approve', 'intent', '--change', 'a', '--preview', '--json'], extra);
  const files = () => [read(path.join(root, 'openspec/changes/a/.sdlc.yaml')), read(path.join(root, 'openspec/.sdlc/log.jsonl'))];
  return { cli, as, preview, intent, files };
}

describe('sdlc approve --preview', () => {
  it('shows the artifacts, the approvals needed and that I may approve, and writes nothing', () => {
    const p = project();
    p.as('Alice Ivanova', 'alice@corp.example');
    const before = p.files();
    const r = p.preview();
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json()).toMatchObject({
      change: 'a', gate: 'intent', allowed: true, approvals: 0, needed: 1, changedSinceApproval: [],
      artifacts: [expect.objectContaining({ name: 'intent', path: 'intent.md' })],
    });
    expect(p.files()).toEqual(before);
    expect(p.cli(['approve', 'intent', '--change', 'a', '--preview']).stdout).toMatch(/intent\.md/);
  }, 120000);

  it('says why I may not approve, with the same rules as the approval', () => {
    const p = project();
    p.as('Bob Petrov', 'bob@corp.example');
    const out = p.preview().json();
    expect(out.allowed).toBe(false);
    expect(out.refusals.map((x: { rule: string }) => x.rule)).toContain('missing_role');
  }, 120000);

  it('names what changed since the last approval', () => {
    const p = project();
    p.as('Alice Ivanova', 'alice@corp.example');
    expect(p.cli(['approve', 'intent', '--change', 'a', '--json']).code).toBe(0);
    write(p.intent, `${INTENT}\nOne more line.\n`);
    const out = p.preview().json();
    expect(out.changedSinceApproval).toEqual(['intent.md']);
    expect(out.allowed).toBe(true);
  }, 120000);

  it('negative: an agent may not run it, like approve', () => {
    const p = project();
    const r = p.preview({ CLAUDECODE: '1' });
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_approve');
  }, 120000);
});
