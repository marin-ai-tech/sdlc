import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { BIN, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F2 and F3 (close-the-digest-integrity-review-findings), end to end through the CLI with real git.
 *
 * F2: a person approving from a project root reached through a junction (Windows) or a directory symlink (POSIX).
 * The checkpoint reader resolved tree paths from git's canonical top level but checked them against the root as
 * given, so every read gave no content and the approval was refused with `digest_changed`.
 *
 * F3: an artifact with the `ident` attribute, committed and checked out by git. The reader compared the evaluated
 * worktree text (`$Id: <oid> $`) with the raw blob (`$Id$`), so the approval was refused with `digest_changed`.
 * The repository sets `core.autocrlf=false`: with a CRLF checkout the snapshot's blob (taken without line-ending
 * conversion) is another object than the committed one, so its expanded `$Id` differs from the worktree's.
 */

const CHANGE = 'add-farewell';
const ARTIFACT = `openspec/changes/${CHANGE}/intent.md`;
const CLI_TIMEOUT = 120000;
const INTENT = [
  '# Intent: say goodbye', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem',
  'Sessions end without a goodbye.', '', '## Proposed outcome', 'Users see a named farewell.', '',
  '## Affected users and systems', 'All users.', '', '## Constraints', 'None', '', '## Success measures',
  'Shown on sign-out.', '', '## Out of scope', 'Localization.', '', '## Open questions', 'None', '',
].join('\n');
const IDENT_INTENT = INTENT.replace('Source: idea\n', 'Source: idea\n\nRevision: $Id$\n');

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8', timeout: CLI_TIMEOUT });
  return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function gitOut(cwd: string, args: string[]): { code: number | null; stdout: string } {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, stdout: r.stdout ?? '' };
}

/** A committed project with one change whose intent is ready for a person's approval. */
function project(intent: string, attributes?: string) {
  const root = tempDir('sdlc-approval-git-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['config', 'core.autocrlf', 'false']);
  if (attributes) write(path.join(root, '.gitattributes'), attributes);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], cwd = root) => run(args, cwd, env);
  const init = cli(['init', '--tools', 'none', '--json']);
  expect(init.code, init.out).toBe(0);
  const created = cli(['new', CHANGE, '--kind', 'feature', '--json']);
  expect(created.code, created.out).toBe(0);
  write(path.join(root, ARTIFACT), intent);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
  const state = () => parse(read(path.join(root, 'openspec', 'changes', CHANGE, '.sdlc.yaml')));
  return { root, env, cli, state };
}

/** A junction on Windows (no privilege needed), a directory symlink elsewhere. */
function linkTo(target: string): string {
  const link = path.join(tempDir('sdlc-approval-link-'), 'project');
  fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  return link;
}

function expectCheckpoint(root: string, gate: string): string {
  const ref = `refs/sdlc/${CHANGE}/${gate}`;
  const resolved = gitOut(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  expect(resolved.code, `${ref} is missing`).toBe(0);
  return ref;
}

describe('F2 and F3: approvals with real git through a linked root and a git filter', () => {
  it('records an approval and its checkpoint through a linked project root', () => {
    const p = project(INTENT);
    const link = linkTo(p.root);
    expect(gitOut(link, ['rev-parse', '--show-toplevel']).code).toBe(0);
    const r = p.cli(['approve', 'intent', '--change', CHANGE, '--json'], link);
    expect(r.code, r.out).toBe(0);
    expect(p.state().gates.intent.approvals).toHaveLength(1);
    const ref = expectCheckpoint(p.root, 'intent');
    expect(gitOut(p.root, ['cat-file', 'blob', `${ref}:${ARTIFACT}`]).stdout).toBe(INTENT);
  }, 240000);

  it('records an approval of an ident artifact with its checkpoint', () => {
    const p = project(IDENT_INTENT, `${ARTIFACT} ident\n`);
    fs.rmSync(path.join(p.root, ARTIFACT));
    git(p.root, ['checkout', '--', ARTIFACT]);
    expect(read(path.join(p.root, ARTIFACT)), 'git did not expand the keyword').toMatch(/\$Id: [0-9a-f]{40,64} \$/);
    const r = p.cli(['approve', 'intent', '--change', CHANGE, '--json']);
    expect(r.code, r.out).toBe(0);
    expect(p.state().gates.intent.approvals).toHaveLength(1);
    const ref = expectCheckpoint(p.root, 'intent');
    // The checkpoint holds the stored blob: the keyword as git keeps it, not the expanded worktree text.
    expect(gitOut(p.root, ['cat-file', 'blob', `${ref}:${ARTIFACT}`]).stdout).toBe(IDENT_INTENT);
  }, 240000);
});
