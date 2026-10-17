import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E6 (bug fix from an alert) and E12 (CI, release, upgrade) team runs of 2026-10-17, decided by the
 * owner for 0.23.1, part B: the guide, approval signing and config proposals.
 *
 * Б1 (option A): `sdlc guide bugfix` told the agent to write the failing test before the plan was approved, while the
 * plan gate denies test edits before approval. The guide now follows the rule: the plan names the test, a person
 * approves the plan, then the agent writes the failing test, `sdlc tests lock`, the fix.
 * Б3: a judge answer must carry `pass`, `route` and `rework`; nothing said so, nor what `route` is. The gates topic of
 * the guide does.
 * Ц1: `signing: required` in a project with history made every past approval invalid (45 of 45) and CI red. With
 * `signing_since: <commit>` in roles.yaml, approvals recorded in that commit or before it count as pre-signing.
 * Ц2: with `signing: off`, `sdlc approvals verify` (a CI step) said only "Approval signing is off". It now says that
 * signatures are not checked and how to turn signing on; the CI file from `sdlc ci init` says so too.
 * Ц4: the log entries of config proposals recorded `by` without the email.
 * Ц5: `sdlc config show` of an applied proposal compared it with the current file, so later edits showed as its diff;
 * it shows the diff the person applied.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(tools = 'none') {
  const root = tempDir('sdlc-0231-guide-signing-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const file = (rel: string) => path.join(root, rel);
  const head = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const log = () => read(file('openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  return { root, cli, file, head, log };
}

type P = ReturnType<typeof project>;

/** Approves the intent of a new change and commits the record with the trailer sdlc prints. */
function approvedIntent(p: P, id: string): void {
  expect(p.cli(['new', id, '--json']).code).toBe(0);
  write(p.file(`openspec/changes/${id}/intent.md`), INTENT);
  const r = p.cli(['approve', 'intent', '--change', id, '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const message = r.json<{ commitMessage?: string }>().commitMessage ?? `approve ${id}`;
  git(p.root, ['add', '-A']);
  git(p.root, ['commit', '-q', '-m', message]);
}

describe('Б1: the bug-fix guide follows the plan gate', () => {
  it('approving the plan comes before writing the failing test, in both languages', () => {
    const p = project();
    for (const [locale, failing] of [['en', /fails? for the right reason|failing test/i], ['ru', /пада/i]] as const) {
      const text = p.cli(['guide', 'bugfix', '--locale', locale]).stdout;
      const steps = text.slice(text.search(/^(Steps|Шаги)/m));
      const approve = steps.indexOf('sdlc approve plan');
      const test = steps.search(failing);
      expect(approve, locale).toBeGreaterThan(-1);
      expect(test, locale).toBeGreaterThan(-1);
      expect(approve, locale).toBeLessThan(test);
    }
  }, 120000);
});

describe('Б3: the guide describes the judge verdict', () => {
  it('the gates topic names pass, route and rework as required and says what route is', () => {
    const p = project();
    for (const locale of ['en', 'ru']) {
      const text = p.cli(['guide', 'gates', '--locale', locale]).stdout;
      expect(text, locale).toMatch(/judge|судья/i);
      for (const field of ['pass', 'route', 'rework']) expect(text, `${locale} ${field}`).toContain(field);
    }
    const en = p.cli(['guide', 'gates', '--locale', 'en']).stdout;
    expect(en).toMatch(/route[^.\n]*(who|next|where)/i);
    expect(en).toMatch(/(all three|every field|required)/i);
  }, 120000);
});

describe('Ц1: signing from a commit on', () => {
  function signed(p: P, since: string | undefined) {
    const rolesFile = p.file('openspec/roles.yaml');
    const roles: Record<string, unknown> = {
      version: 1, signing: 'required',
      people: { pat: { name: 'Pat Owner', emails: ['pat@example.com'] } },
      roles: { 'product-owner': ['pat'], 'tech-lead': ['pat'], engineer: ['pat'], 'code-owner': ['pat'],
        'release-manager': ['pat'], maintainer: ['pat'] },
    };
    if (since) roles.signing_since = since;
    write(rolesFile, stringify(roles));
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'Require signed approvals']);
  }

  it('approvals in or before signing_since are pre-signing; a later unsigned approval fails', () => {
    const p = project();
    approvedIntent(p, 'old-one');
    approvedIntent(p, 'old-two');
    signed(p, p.head());
    const before = p.cli(['approvals', 'verify', '--json']);
    expect(before.code, before.stdout + before.stderr).toBe(0);
    expect(before.stdout).toMatch(/pre-signing/);
    approvedIntent(p, 'new-one');
    const after = p.cli(['approvals', 'verify']);
    expect(after.code).not.toBe(0);
    expect(after.stdout + after.stderr).toMatch(/new-one/);
  }, 300000);

  it('negative: without signing_since every unsigned approval fails as today; an unknown commit is refused', () => {
    const p = project();
    approvedIntent(p, 'old-one');
    signed(p, undefined);
    expect(p.cli(['approvals', 'verify']).code).not.toBe(0);
    const q = project();
    approvedIntent(q, 'old-one');
    signed(q, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    const r = q.cli(['approvals', 'verify', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/signing_since/);
  }, 300000);
});

describe('Ц2: signing off is said plainly', () => {
  it('approvals verify says signatures are not checked and how to turn signing on; the CI file says so too', () => {
    const p = project();
    const r = p.cli(['approvals', 'verify']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/not checked/i);
    expect(r.stdout).toMatch(/signing: (warn|required)/);
    expect(p.cli(['ci', 'init', '--provider', 'github']).code).toBe(0);
    expect(read(p.file('.github/workflows/sdlc.yml'))).toMatch(/signing: off/);
  }, 240000);
});

describe('Ц4 and Ц5: config proposals', () => {
  it('the log names the proposer and the applier with their email; show of an applied proposal keeps its diff', () => {
    const p = project();
    const id = p.cli(['config', 'propose', '--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'Docs', '--json'])
      .json<{ id: string }>().id;
    expect(p.cli(['config', 'apply', id]).code).toBe(0);
    const entries = p.log().filter((e) => e.event === 'config.proposed' || e.event === 'config.applied');
    expect(entries.length).toBe(2);
    for (const entry of entries) expect(entry.by, entry.event).toMatch(/<[^>]+@[^>]+>/);
    const configFile = p.file('openspec/sdlc.yaml');
    write(configFile, `${read(configFile)}# a later note by a person\n`);
    const show = p.cli(['config', 'show', id, '--json']).json<{ diff: string; status: string }>();
    expect(show.status).toBe('applied');
    expect(show.diff).toMatch(/auto_waive/);
    expect(show.diff).not.toMatch(/a later note/);
  }, 240000);
});
