import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { acquireWriterLock } from '../src/core/writer-lock.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change review-rounds-are-recorded (B226, epic E17). `sdlc review check` appends a `review.round` entry to
 * the project log when it sees a new pair of source fingerprint and review.md digest for the change: the round number,
 * the fingerprint, the digest and finding counts, never finding text. Recording never changes the check's output or
 * exit code. `sdlc audit` and `sdlc report` show the rounds per change. Oracles: the log file, the check's own output
 * without recording, and B182's verify trigger `after_review`.
 */

const SLOW = 180000;
const SECRET = 'SECRET-TOKEN-4711';

type Entry = Record<string, any>;
type Finding = { id: string; severity: string; title: string; status: string; where?: string };

function reviewMd(findings: Finding[]): string {
  const lines = ['# Review: change', '', '## Summary', '', 'Test review.', '', '## Findings', ''];
  for (const f of findings) {
    lines.push(`### ${f.id} [${f.severity}][bugs] ${f.title}`);
    lines.push(`- **Where**: ${f.where ?? 'src/a.js:1'}`);
    lines.push('- **Detail**: detail');
    lines.push('- **Fix**: fix');
    lines.push(`- **Status**: ${f.status}`);
    lines.push('');
  }
  return lines.join('\n');
}

const twoOpen: Finding[] = [
  { id: 'F1', severity: 'important', title: 'first defect', status: 'open' },
  { id: 'F2', severity: 'important', title: 'second defect', status: 'open' },
];
const twoFixed: Finding[] = twoOpen.map((f) => ({ ...f, status: 'fixed (abc)' }));

function project(changes: string[] = ['demo']) {
  const root = tempDir('sdlc-b226-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  const ok = (args: string[]) => {
    const r = cli(args);
    expect(r.code, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
    return r;
  };
  ok(['init', '--tools', 'none', '--json']);
  for (const change of changes) ok(['new', change, '--json']);
  write(path.join(root, 'ok.cjs'), 'process.exit(0);\n');
  write(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  const configFile = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(configFile));
  config.verify.commands = [{ name: 'ok', run: 'node ok.cjs', required: true }];
  write(configFile, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'project']);
  const logFile = path.join(root, 'openspec/.sdlc/log.jsonl');
  const entries = (): Entry[] => (fs.existsSync(logFile) ? read(logFile) : '').split('\n')
    .filter(Boolean).map((line) => JSON.parse(line));
  const rounds = (change: string) => entries().filter((e) => e.event === 'review.round' && e.change === change);
  const setReview = (change: string, findings: Finding[]) =>
    write(path.join(root, 'openspec/changes', change, 'review.md'), reviewMd(findings));
  const check = (change?: string) => cli(['review', 'check', ...(change ? ['--change', change] : []), '--json']);
  const editSource = (value: number) => write(path.join(root, 'src/a.js'), `export const a = ${value};\n`);
  return { root, env, cli, ok, entries, rounds, setReview, check, editSource, logFile };
}

describe('B226.R a review round is a counted log event', () => {
  it('R1 two rounds: numbered 1 and 2, with their fingerprints and open counts 2 and 0', () => {
    const p = project();
    p.setReview('demo', twoOpen);
    p.check('demo');
    p.editSource(2);
    p.setReview('demo', twoFixed);
    p.check('demo');
    const rounds = p.rounds('demo');
    expect(rounds.map((e) => e.round.n)).toEqual([1, 2]);
    const [first, second] = rounds.map((e) => e.round);
    expect(first.fingerprint).toMatch(/^git-tree:[0-9a-f]+$/);
    expect(second.fingerprint).toMatch(/^git-tree:[0-9a-f]+$/);
    expect(second.fingerprint).not.toBe(first.fingerprint);
    expect(first.review).toMatch(/[0-9a-f]{64}/);
    expect(second.review).not.toBe(first.review);
    expect(first.counts).toMatchObject({ total: 2, open: 2, blocking: 2 });
    expect(first.counts.open_by_severity).toMatchObject({ important: 2 });
    expect(second.counts).toMatchObject({ total: 2, open: 0, blocking: 0 });
  }, SLOW);

  it('R2 a repeated check on the same source and review.md is not a round', () => {
    const p = project();
    p.setReview('demo', twoOpen);
    for (let i = 0; i < 3; i++) p.check('demo');
    expect(p.rounds('demo')).toHaveLength(1);
  }, SLOW);

  it('R2b line endings alone do not make a round; a changed review.md on the same source does', () => {
    const p = project();
    p.setReview('demo', twoOpen);
    p.check('demo');
    const file = path.join(p.root, 'openspec/changes/demo/review.md');
    write(file, read(file).replace(/\n/g, '\r\n'));
    p.check('demo');
    expect(p.rounds('demo')).toHaveLength(1);
    p.setReview('demo', twoFixed);
    p.check('demo');
    expect(p.rounds('demo').map((e) => e.round.n)).toEqual([1, 2]);
  }, SLOW);

  it('R3 negative: another change is not counted', () => {
    const p = project(['a', 'b']);
    p.setReview('a', twoOpen);
    p.check('a');
    p.editSource(2);
    p.setReview('a', twoFixed);
    p.check('a');
    p.setReview('b', twoOpen);
    p.check('b');
    expect(p.rounds('a').map((e) => e.round.n)).toEqual([1, 2]);
    expect(p.rounds('b').map((e) => e.round.n)).toEqual([1]);
  }, SLOW);
});

describe('B226.P rounds carry counts only', () => {
  it('P1 no finding id text, title, Where path or token reaches the entry', () => {
    const p = project();
    p.setReview('demo', [
      { id: 'F1', severity: 'important', title: `leaks ${SECRET}`, status: 'open', where: '/private/secret-path.ts:9' },
    ]);
    p.check('demo');
    const rounds = p.rounds('demo');
    expect(rounds).toHaveLength(1);
    const text = JSON.stringify(rounds);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain('secret-path');
    expect(text).not.toContain('leaks');
  }, SLOW);

  it('P1b negative: a made-up severity word never becomes a key; it counts under other', () => {
    // The severity is any word from the finding heading (src/core/review.ts HEADING), and review.md is written by the
    // agent; keys of open_by_severity are limited to known severities so a heading cannot carry text into the log.
    const p = project();
    p.setReview('demo', [
      { id: 'F1', severity: 'important', title: 'real', status: 'open' },
      { id: 'F2', severity: `tok${SECRET.replace(/-/g, '')}`, title: 'smuggled', status: 'open' },
      { id: 'F3', severity: 'nit', title: 'style', status: 'open' },
    ]);
    p.check('demo');
    const round = p.rounds('demo')[0].round;
    expect(JSON.stringify(round)).not.toMatch(/tok|4711/i);
    expect(round.counts.open_by_severity).toMatchObject({ important: 1, nit: 1, other: 1 });
    expect(Object.keys(round.counts.open_by_severity).sort()).toEqual(
      expect.arrayContaining(['important', 'nit', 'other']));
    for (const key of Object.keys(round.counts.open_by_severity)) {
      expect(['important', 'nit', 'pre-existing', 'other']).toContain(key);
    }
  }, SLOW);
});

describe('B226.F recording never changes the verdict', () => {
  it('F1 with the writer lock held the check prints and exits the same, and leaves no entry', () => {
    const p = project();
    p.setReview('demo', twoOpen);
    const lease = acquireWriterLock(path.join(p.root, 'openspec/.sdlc/log.lock'), 1000);
    let locked;
    try {
      locked = p.check('demo');
    } finally {
      lease.release();
    }
    expect(p.rounds('demo')).toHaveLength(0);
    const free = p.check('demo');
    expect(locked.code).toBe(free.code);
    expect(locked.stdout).toBe(free.stdout);
    expect(p.rounds('demo').map((e) => e.round.n)).toEqual([1]);
  }, SLOW);

  it('F2 the check exit code is unchanged by recording: blocking findings exit 1, none exit as before', () => {
    const p = project();
    p.setReview('demo', twoOpen);
    expect(p.check('demo').code).toBe(1);
    expect(p.rounds('demo')).toHaveLength(1);
  }, SLOW);
});

describe('B226.W the branch picks the change', () => {
  it('W1 on branch change/b the check without --change records on b', () => {
    const p = project(['a', 'b']);
    p.setReview('b', twoOpen);
    git(p.root, ['checkout', '-q', '-b', 'change/b']);
    const r = p.check();
    expect(r.json().change).toBe('b');
    expect(p.rounds('b')).toHaveLength(1);
    expect(p.rounds('a')).toHaveLength(0);
  }, SLOW);

  it('W2 negative: an unknown branch keeps change_required and records nothing', () => {
    const p = project(['a', 'b']);
    p.setReview('b', twoOpen);
    git(p.root, ['checkout', '-q', '-b', 'feature/x']);
    const r = p.check();
    expect(r.code).not.toBe(0);
    expect(`${r.stdout}${r.stderr}`).toContain('change_required');
    expect(p.entries().filter((e) => e.event === 'review.round')).toHaveLength(0);
  }, SLOW);
});

describe('B226.I the verify trigger sees the round', () => {
  it('I1 a verify run after a review round on a new source is after_review', () => {
    const p = project();
    p.ok(['verify', '--change', 'demo', '--json']);
    p.setReview('demo', twoOpen);
    p.check('demo');
    p.editSource(2);
    p.ok(['verify', '--change', 'demo', '--json']);
    const finishes = p.entries().filter((e) => e.change === 'demo' && /^verify\.(passed|failed)$/.test(e.event));
    expect(finishes.map((e) => e.run.trigger)).toEqual(['first', 'after_review']);
  }, SLOW);
});

describe('B226 review round 1', () => {
  // Independent review (e17-r3, 2026-11-16) F2: n counted log lines, so a round duplicated by a union merge of two
  // branches made the next distinct round number 3 while audit counted 2.
  it('R1-F2 a duplicated round line does not skip the next number', () => {
    const p = project();
    p.setReview('demo', twoOpen);
    p.check('demo');
    const line = read(p.logFile).split('\n').find((text) => text.includes('"review.round"'));
    fs.appendFileSync(p.logFile, `${line}\n`);
    p.editSource(2);
    p.setReview('demo', twoFixed);
    p.check('demo');
    const numbers = p.rounds('demo').map((e) => e.round.n);
    expect(numbers).toEqual([1, 1, 2]);
    expect(p.ok(['audit', '--change', 'demo', '--json']).json().metrics.reviewRounds).toBe(2);
  }, SLOW);

  // F3: the text audit printed no rounds; only `--json` had them.
  it('R1-F3 the text audit names the review rounds of the change', () => {
    const p = project(['a', 'b']);
    p.setReview('a', twoOpen);
    p.check('a');
    p.editSource(2);
    p.setReview('a', twoFixed);
    p.check('a');
    expect(p.ok(['audit', '--change', 'a']).stdout).toMatch(/review rounds 2\b/);
    expect(p.ok(['audit', '--change', 'b']).stdout).toMatch(/review rounds 0\b/);
  }, SLOW);
});

describe('B226.M rounds per change in audit and report', () => {
  // Lesson of B182 F6: the proposal names audit and tasks.md names the report's change page; both are tested here.
  const section = (html: string, id: string) => {
    const start = html.indexOf(`<section id="change-${id}"`);
    expect(start, `no page for ${id}`).toBeGreaterThanOrEqual(0);
    return html.slice(start, html.indexOf('</section>', start));
  };

  it('M1 audit and report show the rounds of each change and none for a change without review', () => {
    const p = project(['a', 'b']);
    p.setReview('a', twoOpen);
    p.check('a');
    p.editSource(2);
    p.setReview('a', twoFixed);
    p.check('a');
    expect(p.ok(['audit', '--change', 'a', '--json']).json().metrics.reviewRounds).toBe(2);
    expect(p.ok(['audit', '--change', 'b', '--json']).json().metrics.reviewRounds).toBe(0);
    const report = p.ok(['report', '--format', 'json']).json();
    const row = (id: string) => report.changes.find((change: Entry) => change.id === id);
    expect(row('a').reviewRounds).toBe(2);
    expect(row('b').reviewRounds).toBe(0);
    const html = p.ok(['report', '--format', 'html']).stdout;
    expect(section(html, 'a')).toContain('Review rounds');
    expect(section(html, 'b')).toContain('Review rounds');
  }, SLOW);
});
