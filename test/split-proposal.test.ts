import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change split-proposal (B225; epic E17 wave 3). Before a package-sized change starts its build, sdlc
 * estimates its full-verification minutes from comparable archived changes (median minutes per finished full run
 * times median finished full runs per change) and, when the estimate exceeds `loops.verify_minutes`, shows a split
 * proposal in status, next and the plan approval output, with a ready backlog command for a person. The items a
 * change covers are its source item plus the existing `B<n>` ids named in its planning artifacts (owner,
 * 2026-11-17). Oracles: the E20 run fixture with its real durations (11 finished runs, median 60.2 minutes, so
 * about 663 minutes), the backlog file on disk and the config proposal contract.
 */

const SLOW = 300000;
const AGENT = { QWEN_CODE: '1' };
const ITEMS = 51;

type Json = Record<string, any>;
type Ledger = { runs: Array<{ run: number; status: string; startedAt: string; durationMs?: number; source: string }> };

function backlog(count: number): string {
  const lines = ['# Backlog', '', 'Order is priority.', `<!-- next-B: ${count + 1} -->`, '<!-- next-E: 2 -->', '',
    '## E1 Field feedback', 'Granularity: package', ''];
  for (let i = 1; i <= count; i += 1) {
    lines.push(`### B${i} [open] Item ${i}`, '- **Outcome**: o', '- **Acceptance**:', '  - a', '');
  }
  return [...lines, '## Unassigned', ''].join('\n');
}

function proposal(ids: string[]): string {
  return ['## Why', '', 'A package.', '', '## What Changes', '', ...ids.map((id) => `- ${id}: covered.`), '',
    '## Impact', '', 'Everything.', ''].join('\n');
}

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `B${from + i}`);

function project() {
  const root = tempDir('sdlc-b225-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  const ok = (args: string[]) => {
    const r = cli(args);
    expect(r.code, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
    return r;
  };
  ok(['init', '--tools', 'none', '--json']);
  const file = (rel: string) => path.join(root, rel);
  write(file('openspec/backlog.md'), backlog(ITEMS));
  const configFile = file('openspec/sdlc.yaml');
  const setLoops = (loops: unknown) => {
    const config = parse(read(configFile));
    config.loops = loops;
    write(configFile, stringify(config));
  };
  const logFile = file('openspec/.sdlc/log.jsonl');
  const append = (entry: Json) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ sdlc: '0.33.0', license: 'community', ...entry })}\n`);
  };
  let serial = 0;
  const run = (change: string, status: string, start: string, ms: number | undefined, fingerprint: string) => {
    serial += 1;
    const id = serial.toString(16).padStart(12, '0');
    append({ ts: start, event: 'verify.started', change, run: { id, started_at: start, fingerprint } });
    if (status !== 'passed' && status !== 'failed') return;
    const end = new Date(Date.parse(start) + (ms ?? 1000)).toISOString();
    append({ ts: end, event: `verify.${status}`, change, run: { id, started_at: start, finished_at: end,
      duration_ms: ms ?? 1000, fingerprint, trigger: 'changed', partial: false, checks: [] } });
  };
  /** The E20 change, archived, naming all items, with its 18 recorded runs. */
  const archivedE20 = () => {
    ok(['new', 'e20', '--track', 'lite', '--json']);
    write(file('openspec/changes/e20/proposal.md'), proposal(range(1, ITEMS)));
    const ledger = JSON.parse(read(path.join(REPO_ROOT, 'test/fixtures/e20-verify-runs.json'))) as Ledger;
    for (const r of ledger.runs) run('e20', r.status, new Date(r.startedAt).toISOString(), r.durationMs, `git-tree:${r.source}`);
    fs.mkdirSync(file('openspec/changes/archive'), { recursive: true });
    fs.renameSync(file('openspec/changes/e20'), file('openspec/changes/archive/2026-10-31-e20'));
  };
  /** A lite change naming `ids`, with plan and tasks, ready for plan approval. */
  const pkg = (ids: string[]) => {
    ok(['new', 'pkg', '--track', 'lite', '--json']);
    write(file('openspec/changes/pkg/proposal.md'), proposal(ids));
    write(file('openspec/changes/pkg/plan.md'), FILES['plan.md']);
    write(file('openspec/changes/pkg/tasks.md'), FILES['tasks.md']);
  };
  const said = () => [
    JSON.stringify(ok(['status', '--change', 'pkg', '--json']).json<Json>()),
    JSON.stringify(ok(['next', '--change', 'pkg', '--json']).json<Json>()),
  ].join('\n');
  return { root, cli, ok, file, configFile, setLoops, append, run, archivedE20, pkg, said };
}

describe('B225.S a verification-cost estimate from comparable changes', () => {
  it('S1 the E20 backtest: a 51-item package over a 300-minute budget gets a split proposal', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 300, comparable_min: 1 });
    p.pkg(range(1, ITEMS));
    // Approval warnings go to stderr like every other warning of `approve`; the proposal must be printed either way.
    const approved = p.ok(['approve', 'plan', '--change', 'pkg']);
    const approve = approved.stdout + approved.stderr;
    for (const text of [p.said(), approve]) {
      expect(text).toContain('loops.verify_minutes');
      // Numbers are matched inside their sentence: the JSON also holds temp paths, hashes and times.
      expect(text, 'the estimate: median 60.2 min x 11 runs').toContain('estimated at 663 min');
      expect(text, 'minutes and runs').toContain('median 60.2 min per run x 11 runs per change');
      expect(text, 'covered items').toContain(`these ${ITEMS} backlog items`);
      expect(text).toMatch(/one data point/i);
      expect(text).toContain('sdlc backlog epic edit E1 --granularity feature');
    }
  }, SLOW);

  it('S2 too few comparable changes: no number and no command', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 300 });
    p.pkg(range(1, ITEMS));
    const text = p.said();
    expect(text).toContain('loops.verify_minutes');
    expect(text).toMatch(/1 of 3/);
    expect(text).not.toMatch(/estimated at \d+ min/);
    expect(text).not.toContain('backlog epic edit');
  }, SLOW);

  it('S3 under budget: no proposal', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 700, comparable_min: 1 });
    p.pkg(range(1, ITEMS));
    const text = p.said();
    expect(text).not.toContain('backlog epic edit');
    expect(text).not.toContain('loops.verify_minutes');
  }, SLOW);

  it('S4 nothing to split, unknown ids, no budget, or a run already finished: no line', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 300, comparable_min: 1 });
    p.pkg(['B1']);
    expect(p.said(), 'one item').not.toContain('loops.verify_minutes');
    write(p.file('openspec/changes/pkg/proposal.md'), proposal(range(900, 950)));
    expect(p.said(), 'ids not in the backlog').not.toContain('loops.verify_minutes');
    write(p.file('openspec/changes/pkg/proposal.md'), proposal(range(1, ITEMS)));
    expect(p.said(), 'positive control').toContain('loops.verify_minutes');
    p.run('pkg', 'passed', '2026-11-17T08:00:00.000Z', 60000, 'git-tree:pkg');
    expect(p.said(), 'a finished run').not.toContain('loops.verify_minutes');
  }, SLOW);

  it('S4b no budget: no line', () => {
    const p = project();
    p.archivedE20();
    p.pkg(range(1, ITEMS));
    expect(p.said()).not.toContain('loops.verify_minutes');
    expect(p.said()).not.toContain('backlog epic edit');
  }, SLOW);
});

describe('B225.S the proposal is a signal for a person', () => {
  it('S5 status, next and approve write nothing to the backlog', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 300, comparable_min: 1 });
    p.pkg(range(1, ITEMS));
    const before = read(p.file('openspec/backlog.md'));
    p.said();
    const approved = p.ok(['approve', 'plan', '--change', 'pkg']);
    expect(approved.stdout + approved.stderr).toContain('backlog epic edit E1');
    p.said();
    expect(read(p.file('openspec/backlog.md'))).toBe(before);
  }, SLOW);
});

describe('B225.S review round 1 (findings F3, F4)', () => {
  it('S7 a recorded duration that is not a number never becomes an estimate', () => {
    const p = project();
    p.archivedE20();
    p.ok(['new', 'odd', '--track', 'lite', '--json']);
    write(p.file('openspec/changes/odd/proposal.md'), proposal(['B1', 'B2']));
    const start = '2026-11-01T08:00:00.000Z';
    for (const [id, duration] of [['odd-1', 'bad'], ['odd-2', -5], ['odd-3', undefined]] as const) {
      p.append({ ts: start, event: 'verify.started', change: 'odd', run: { id, started_at: start } });
      p.append({ ts: start, event: 'verify.passed', change: 'odd', run: { id, started_at: start, finished_at: start,
        ...(duration === undefined ? {} : { duration_ms: duration }), partial: false, checks: [] } });
    }
    fs.renameSync(p.file('openspec/changes/odd'), p.file('openspec/changes/archive/2026-11-01-odd'));
    p.setLoops({ verify_minutes: 300, comparable_min: 1 });
    p.pkg(range(1, ITEMS));
    const text = p.said();
    expect(text).not.toMatch(/NaN/);
    expect(text, 'the E20 runs alone give the estimate').toContain('estimated at 663 min');
  }, SLOW);

  it('S8 a linked specs folder outside the change is not read', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 300, comparable_min: 1 });
    p.pkg(['B1']);
    const outside = tempDir('sdlc-b225-outside-');
    write(path.join(outside, 'x', 'spec.md'), proposal(range(2, ITEMS)));
    const specs = p.file('openspec/changes/pkg/specs');
    fs.rmSync(specs, { recursive: true, force: true });
    fs.symlinkSync(outside, specs, 'junction');
    expect(p.said(), 'a junction to another folder').not.toContain('loops.verify_minutes');
    fs.rmSync(specs, { recursive: true, force: true });
    write(path.join(specs, 'x', 'spec.md'), proposal(range(2, ITEMS)));
    expect(p.said(), 'positive control: a real specs folder').toContain('loops.verify_minutes');
  }, SLOW);
});

describe('B225.S the budget is protected configuration', () => {
  it('S6 an invalid value is ignored and reported; propose refuses it; raising is a weakening', () => {
    const p = project();
    p.archivedE20();
    p.setLoops({ verify_minutes: 0, comparable_min: 1 });
    p.pkg(range(1, ITEMS));
    expect(p.said()).not.toMatch(/estimated at \d+ min/);
    expect(p.said()).not.toContain('backlog epic edit');
    expect(JSON.stringify(p.cli(['doctor', '--json']).json<Json>())).toContain('loops.verify_minutes');
    const zero = p.cli(['config', 'propose', '--set', 'loops.verify_minutes=0', '--reason', 'r', '--json']);
    expect(zero.code).not.toBe(0);
    expect(zero.stdout + zero.stderr).toMatch(/loops\.verify_minutes must be a whole number of at least 1/);
    expect(zero.stdout + zero.stderr).not.toMatch(/unknown/i);
    p.setLoops({ verify_minutes: 300, comparable_min: 1 });
    const propose = (key: string, value: number) => {
      const r = p.ok(['config', 'propose', '--set', `${key}=${value}`, '--reason', 'r', '--json']);
      return r.json<{ id: string }>().id;
    };
    for (const [key, value] of [['loops.verify_minutes', 600], ['loops.comparable_min', 5]] as const) {
      const id = propose(key, value);
      const shown = p.ok(['config', 'show', id, '--json']).json<{ warnings: string[]; weakens: boolean }>();
      expect(shown.weakens, key).toBe(true);
      expect(shown.warnings.join('\n')).toContain(key);
      expect(p.cli(['config', 'apply', id], AGENT).code).not.toBe(0);
    }
    const lower = propose('loops.verify_minutes', 200);
    const shown = p.ok(['config', 'show', lower, '--json']).json<{ warnings: string[]; weakens: boolean }>();
    expect(shown.warnings.join('\n'), 'a lower budget is not a weakening').not.toContain('loops.verify_minutes');
  }, SLOW);
});
