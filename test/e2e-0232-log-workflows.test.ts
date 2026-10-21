import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseCoverage } from '../src/core/review.js';
import { t } from '../src/core/i18n.js';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E7 team run (signed approvals and an audit, 2026-10-17), decided by the owner for 0.23.2, part A:
 * the log, the agent workflows and the gates.
 *
 * finding 6: `sdlc status` and `sdlc next` appended `gate.<gate>.awaiting` to the tracked shared log, so after an agent run
 * the working copy was dirty and `git pull` refused (the class of finding 4, whose test covered only hook decisions). Waits
 * recorded by commands that only read go to the local queue like hook decisions.
 * finding 10: a gate decision deleted from the shared log by hand went unnoticed; `sdlc health` compares the log with the
 * change records.
 * finding 7: the plan workflow (and build, verify, review, release) did not say where to write, and an agent put plan.md and
 * tasks.md at the repository root; `sdlc next` now says where such a file belongs.
 * finding 1: the agent guide did not say that the process settings change only through a proposal.
 * finding 8: `sdlc tests unlock` took no reason; the reason is recorded.
 * finding 9: a review record whose coverage used `### <pass>` headings was refused with a message that did not show the form.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(tools = 'claude') {
  const root = tempDir('sdlc-0232-log-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', tools, '--json']).code).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const file = (rel: string) => path.join(root, rel);
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  const commit = (message: string) => {
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
  };
  const events = () => read(file('openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
  return { root, cli, file, status, commit, events };
}

type P = ReturnType<typeof project>;

function atIntentGate(p: P): void {
  expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
  write(p.file('openspec/changes/add-x/intent.md'), INTENT);
  p.commit('intent');
}

describe('finding 6: commands that only read keep the working copy clean', () => {
  it('status and next record the wait locally; log sees it; the next log write moves it into the shared log', () => {
    const p = project();
    atIntentGate(p);
    expect(p.cli(['status']).code).toBe(0);
    expect(p.cli(['next', '--change', 'add-x']).code).toBe(0);
    expect(p.status()).toBe('');
    const log = p.cli(['log', '--json']).json<{ entries: Array<{ event: string }> }>();
    expect(log.entries.map((e) => e.event)).toContain('gate.intent.awaiting');
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    const shared = p.events();
    expect(shared.indexOf('gate.intent.awaiting')).toBeGreaterThan(-1);
    expect(shared.indexOf('gate.intent.awaiting')).toBeLessThan(shared.indexOf('gate.intent.approved'));
    expect(shared.filter((e) => e === 'gate.intent.awaiting').length).toBe(1);
  }, 240000);
});

describe('finding 10: health notices a gate decision missing from the shared log', () => {
  it('a gate.intent.approved line deleted by hand is a finding; negative: an untouched log has none', () => {
    const p = project();
    atIntentGate(p);
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    p.commit('approve');
    const before = p.cli(['health', '--json']).json<{ findings: Array<{ id: string }> }>();
    expect(before.findings.map((f) => f.id)).not.toContain('discipline.log-gaps');
    const logFile = p.file('openspec/.sdlc/log.jsonl');
    const kept = read(logFile).split('\n').filter((line) => !line.includes('"gate.intent.approved"'));
    write(logFile, kept.join('\n'));
    p.commit('tidy log');
    const after = p.cli(['health', '--json']).json<{ findings: Array<{ id: string; detail?: string }> }>();
    const finding = after.findings.find((f) => f.id === 'discipline.log-gaps');
    expect(finding, JSON.stringify(after.findings.map((f) => f.id))).toBeDefined();
    expect(JSON.stringify(finding)).toMatch(/add-x/);
    expect(JSON.stringify(finding)).toMatch(/intent/);
  }, 240000);
});

describe('finding 7: artifacts go into the change folder', () => {
  it('the plan, build, verify, review and release workflows name resolvedOutputPath', () => {
    const p = project('claude');
    for (const step of ['plan', 'build', 'verify', 'review', 'release']) {
      const skill = read(p.file(`.claude/skills/sdlc-${step}/SKILL.md`));
      expect(skill, step).toMatch(/resolvedOutputPath/);
    }
  }, 120000);

  it('next says where an artifact found at the repository root belongs; negative: no hint without one', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    const clean = p.cli(['next', '--change', 'add-x']);
    expect(clean.stdout + clean.stderr).not.toMatch(/openspec\/changes\/add-x\/intent\.md/);
    write(p.file('intent.md'), INTENT);
    const hinted = p.cli(['next', '--change', 'add-x']);
    expect(hinted.stdout + hinted.stderr).toMatch(/openspec\/changes\/add-x\/intent\.md/);
  }, 120000);
});

describe('finding 1: the agent guide names the settings proposal', () => {
  it('AGENTS.md says that sdlc.yaml and roles.yaml change only through sdlc config propose', () => {
    const guide = read(path.join(REPO_ROOT, 'assets/project/ai-ready/AGENTS.md'));
    expect(guide).toMatch(/sdlc config propose/);
    expect(guide).toMatch(/openspec\/sdlc\.yaml/);
    expect(guide).toMatch(/openspec\/roles\.yaml/);
  });
});

describe('finding 8: unlocking the tests records why', () => {
  it('tests unlock --note puts the reason into the log entry', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    expect(p.cli(['tests', 'lock', '--change', 'add-x']).code).toBe(0);
    const r = p.cli(['tests', 'unlock', '--change', 'add-x', '--note', 'The test itself expects the wrong count']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const entries = read(p.file('openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
    const unlocked = entries.filter((e) => e.event === 'tests.unlocked');
    expect(unlocked.length).toBe(1);
    expect(unlocked[0].detail).toMatch(/expects the wrong count/);
  }, 120000);
});

describe('finding 9: review coverage', () => {
  it('a coverage section with one ### heading per pass is read like the list form', () => {
    const content = [
      '# Review', '', '## Coverage', '', '### bugs', 'none found — checked: the counter logic', '',
      '### security', '2 findings', '', '## Summary', 'Fine.', '',
    ].join('\n');
    const entries = parseCoverage(content).map((e) => [e.name, 'findings' in e ? e.findings : 'none']);
    expect(entries).toEqual([['bugs', 'none'], ['security', 2]]);
  });

  it('the refusal shows the line a pass needs and drops an empty unchecked part', () => {
    for (const locale of ['en']) {
      const text = t('gate.reviewCoverage', { missing: 'bugs, security', unchecked: '' }, locale);
      expect(text, locale).toMatch(/- bugs: none found — checked:/);
      expect(text, locale).not.toMatch(/: \.?$/);
    }
  });
  });
