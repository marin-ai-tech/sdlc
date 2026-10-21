import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E7 team run (signed approvals and an audit, 2026-10-17), decided by the owner for 0.23.2, part B:
 * settings proposals, roles.yaml, the trace and the evidence bundle.
 *
 * finding 2: `sdlc config show` of a roles.yaml with CRLF line ends showed every line changed (`\u000d`), and a key added at
 * the end showed the whole file removed and added; untouched lines lost their alignment. A proposal changes only the
 * lines it changes, keeps the file's line ends, and its diff shows only those lines.
 * finding 4: a `signing_key` that is not a public key (a path) passed the validation.
 * finding 3: an agent split one change into six proposals against the same file; a second open proposal for the same file
 * is now named when proposing, and the workflow asks for one proposal per change.
 * finding 5: proposing `signing: warn|required` in a project with unsigned approvals and no `signing_since` did not say that
 * those approvals would fail.
 * finding 11: `sdlc trace` dropped tasks without an `n.m` number and a review coverage count without findings, silently.
 * finding 12: the evidence bundle did not name the signing mode and the `signing_since` cutoff.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

const ROLES_LINES = [
  'version: 1',
  'signing: off',
  'people:',
  '  pat:   { name: Pat Owner, emails: [pat@example.com] }',
  '  sam:   { name: Sam Lee,   emails: [sam@example.com] }',
  'roles:',
  '  product-owner:   [pat]',
  '  maintainer:      [pat]',
  '  tech-lead:       [pat]',
  '  engineer:        [pat, sam]',
  '  code-owner:      [pat]',
  '  release-manager: [pat]',
  '',
];
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILeSy3Bx57azZITi0juE+3UqUrIWVyNznE+XogQim4Ul pat@example.com';

function project(roles = true) {
  const root = tempDir('sdlc-0232-config-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  const file = (rel: string) => path.join(root, rel);
  if (roles) fs.writeFileSync(file('openspec/roles.yaml'), ROLES_LINES.join('\r\n'));
  const commit = (message: string) => {
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
  };
  commit('sdlc');
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const propose = (sets: string[]) => {
    const r = cli(['config', 'propose', '--target', 'roles', ...sets.flatMap((s) => ['--set', s]), '--reason', 'R',
      '--json']);
    return { r, id: r.code === 0 ? r.json<{ id: string }>().id : '' };
  };
  const show = (id: string) => cli(['config', 'show', id, '--json']).json<{ diff: string; warnings: string[] }>();
  return { root, cli, file, commit, head, propose, show };
}

type P = ReturnType<typeof project>;

/** Lines the diff removes or adds, without its file headers. */
function changed(diff: string): string[] {
  return diff.split('\n').filter((l) => /^[-+]/.test(l) && !/^(---|\+\+\+) /.test(l));
}

function approvedIntent(p: P): void {
  expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
  write(p.file('openspec/changes/add-x/intent.md'), INTENT);
  const r = p.cli(['approve', 'intent', '--change', 'add-x', '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  p.commit(r.json<{ commitMessage?: string }>().commitMessage ?? 'approve');
}

describe('finding 2: a proposal changes only its lines', () => {
  it('CRLF file: the diff shows only the signing lines, and applying keeps every other line byte for byte', () => {
    const p = project();
    const { r, id } = p.propose(['signing=warn', `signing_since=${p.head()}`]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const diff = p.show(id).diff;
    expect(diff).not.toMatch(/\\u000d|\r/);
    const lines = changed(diff);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, line).toMatch(/signing/);
    expect(p.cli(['config', 'apply', id, '--yes']).code).toBe(0);
    const after = read(p.file('openspec/roles.yaml'));
    for (const line of ROLES_LINES.filter((l) => l && !l.startsWith('signing'))) {
      expect(after, line).toContain(`${line}\r\n`);
    }
  }, 240000);
});

describe('finding 4: signing_key must be a public key', () => {
  it('a path is refused naming signing_key; negative: an ssh public key is accepted', () => {
    const p = project();
    const bad = p.propose(['people.pat.signing_key=../keys/pat.pub']);
    expect(bad.r.code).not.toBe(0);
    expect(bad.r.stdout + bad.r.stderr).toMatch(/signing_key/);
    const good = p.propose([`people.pat.signing_key=${KEY}`]);
    expect(good.r.code, good.r.stdout + good.r.stderr).toBe(0);
  }, 240000);
});

describe('finding 3: one proposal per change', () => {
  it('a second open proposal for the same file names the first; the workflow asks for one proposal', () => {
    const p = project();
    const first = p.propose(['signing=warn']);
    expect(first.r.code).toBe(0);
    const second = p.cli(['config', 'propose', '--target', 'roles', '--set', `people.pat.signing_key=${KEY}`,
      '--reason', 'R2']);
    expect(second.code, second.stdout + second.stderr).toBe(0);
    expect(second.stdout + second.stderr).toMatch(new RegExp(first.id));
    expect(read(p.file('.claude/skills/sdlc-config/SKILL.md'))).toMatch(/one proposal/i);
  }, 240000);
});

describe('finding 5: turning signing on in a project with unsigned approvals', () => {
  it('without signing_since the proposal warns about the unsigned approvals; with it, it does not', () => {
    const p = project();
    approvedIntent(p);
    const plain = p.propose(['signing=required']);
    expect(plain.r.code).toBe(0);
    const warned = p.show(plain.id).warnings.join('\n');
    expect(warned).toMatch(/approval/i);
    expect(warned).toMatch(/signing_since/);
    const cut = p.propose(['signing=required', `signing_since=${p.head()}`]);
    expect(p.show(cut.id).warnings.join('\n')).not.toMatch(/approval/i);
  }, 300000);
});

describe('finding 11: the trace shows every task and the review coverage it cannot match', () => {
  it('unnumbered tasks are listed with a gap; a coverage count without findings is a gap', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/add-x/tasks.md'), '# Tasks\n\n## Footer\n\n- [x] Add the element\n- [ ] Style it\n');
    write(p.file('openspec/changes/add-x/review.md'), [
      '# Review', '', '## Coverage', '', '- bugs: none found — checked: logic', '- verification-gaps: 1 finding', '',
    ].join('\n'));
    const trace = p.cli(['trace', 'add-x', '--json']).json<{ tasks: unknown[]; gaps: Array<{ kind: string }> }>();
    expect(trace.tasks.length).toBe(2);
    const kinds = trace.gaps.map((g) => g.kind);
    expect(kinds).toContain('task-without-number');
    expect(kinds).toContain('review-coverage-mismatch');
  }, 240000);

  it('negative: numbered tasks and coverage that matches its findings give neither gap', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/add-x/tasks.md'), '# Tasks\n\n## 1. Footer\n\n- [x] 1.1 Add the element\n');
    write(p.file('openspec/changes/add-x/review.md'), [
      '# Review', '', '## Coverage', '', '- bugs: none found — checked: logic', '',
    ].join('\n'));
    const trace = p.cli(['trace', 'add-x', '--json']).json<{ tasks: unknown[]; gaps: Array<{ kind: string }> }>();
    expect(trace.tasks.length).toBe(1);
    const kinds = trace.gaps.map((g) => g.kind);
    expect(kinds).not.toContain('task-without-number');
    expect(kinds).not.toContain('review-coverage-mismatch');
  }, 240000);
});

describe('finding 12: the evidence bundle names the signing mode and the cutoff', () => {
  it('index.json and index.md carry the mode and signing_since; negative: none without roles.yaml', () => {
    const p = project();
    approvedIntent(p);
    const since = p.head();
    const text = read(p.file('openspec/roles.yaml')).replace('signing: off', `signing: warn\r\nsigning_since: ${since}`);
    fs.writeFileSync(p.file('openspec/roles.yaml'), text);
    p.commit('signing');
    const out = path.join(tempDir('sdlc-0232-export-'), 'bundle');
    const r = p.cli(['audit', '--export', out]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const index = JSON.parse(read(path.join(out, 'index.json')));
    expect(index.signing).toMatchObject({ mode: 'warn', since });
    expect(read(path.join(out, 'index.md'))).toMatch(new RegExp(`signing_since[^\\n]*${since.slice(0, 7)}`));
    const q = project(false);
    const outQ = path.join(tempDir('sdlc-0232-export-'), 'bundle');
    expect(q.cli(['audit', '--export', outQ]).code).toBe(0);
    expect(JSON.parse(read(path.join(outQ, 'index.json'))).signing?.since).toBeUndefined();
  }, 300000);
});
