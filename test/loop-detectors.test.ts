import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change loop-detectors (B230, first half; epic E17 wave 2). `sdlc health` reports a change whose finished
 * full verify runs on one source fingerprint reach `loops.repeat_runs` (default 3) and a change whose review rounds
 * reach `loops.round_warn` (default 3). Both thresholds sit in the top-level `loops:` section of B224 and follow its
 * rule for bad values: ignored with the default in effect, reported by doctor, refused by config propose.
 * Oracles: the E20 verify runs fixture (the green triple of runs 8-10 lies before run 20), log entries of B182/B226
 * written here by hand, and the config proposal contract.
 */

const SLOW = 240000;
const AGENT = { QWEN_CODE: '1' };

type Json = Record<string, any>;
type Ledger = { runs: Array<{ run: number; status: string; startedAt: string; durationMs?: number; source: string }> };

function project(changes: string[] = ['demo']) {
  const root = tempDir('sdlc-b230-');
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
  for (const change of changes) ok(['new', change, '--json']);
  const configFile = path.join(root, 'openspec/sdlc.yaml');
  const setLoops = (loops: unknown) => {
    const config = parse(read(configFile));
    config.loops = loops;
    write(configFile, stringify(config));
  };
  const logFile = path.join(root, 'openspec/.sdlc/log.jsonl');
  const append = (entry: Json) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ sdlc: '0.33.0', license: 'community', ...entry })}\n`);
  };
  let serial = 0;
  const rounds = (change: string, count: number) => {
    for (let i = 0; i < count; i += 1) {
      serial += 1;
      const round = { n: i + 1, fingerprint: `git-tree:r${serial}`, review: serial.toString(16).padStart(64, '0'),
        counts: { total: 1, open: 1, blocking: 1, open_by_severity: { important: 1 } } };
      append({ ts: new Date().toISOString(), event: 'review.round', change, round });
    }
  };
  const run = (change: string, status: string, source: string, fingerprint = `git-tree:${source}`) => {
    serial += 1;
    const id = serial.toString(16).padStart(12, '0');
    const at = new Date().toISOString();
    append({ ts: at, event: 'verify.started', change, run: { id, started_at: at, fingerprint } });
    if (status === 'unfinished') return;
    append({ ts: at, event: `verify.${status}`, change, run: { id, started_at: at, finished_at: at, duration_ms: 1000,
      fingerprint, trigger: 'changed', partial: false, checks: [] } });
  };
  const finding = (id: string): Json | undefined => {
    const health = ok(['health', '--json']).json<Json>();
    return ((health.findings ?? []) as Json[]).find((f) => f.id === id);
  };
  return { root, cli, ok, setLoops, rounds, run, finding };
}

describe('B230.D repeated verification on an unchanged source', () => {
  it('D1 the first 11 E20 runs raise a fact for the triple of runs 8-10, none for the two failed runs 1', () => {
    const ledger = JSON.parse(read(path.join(REPO_ROOT, 'test/fixtures/e20-verify-runs.json'))) as Ledger;
    const p = project();
    const first = ledger.runs.slice(0, 11);
    for (const r of first) p.run('demo', r.status, r.source);
    const triple = ledger.runs.find((r) => r.run === 8)!.source;
    const failed = ledger.runs.find((r) => r.run === 1)!.source;
    const found = p.finding('quality.repeat_runs');
    expect(found).toBeDefined();
    const text = JSON.stringify(found);
    expect(text).toContain('demo');
    expect(text).toContain(triple);
    expect(text).not.toContain(failed);
    expect(found!.facts).toHaveLength(1);
  }, SLOW);

  it('D2 negative: one run and one round raise neither finding', () => {
    const p = project();
    p.run('demo', 'passed', 'S1');
    p.rounds('demo', 1);
    expect(p.finding('quality.repeat_runs')).toBeUndefined();
    expect(p.finding('quality.review_rounds')).toBeUndefined();
  }, SLOW);

  it('D3 negative: four runs on four sources, and unfinished runs on one source, raise nothing', () => {
    const p = project();
    for (const source of ['S1', 'S2', 'S3', 'S4']) p.run('demo', 'passed', source);
    for (let i = 0; i < 4; i += 1) p.run('demo', 'unfinished', 'S5');
    expect(p.finding('quality.repeat_runs')).toBeUndefined();
  }, SLOW);

  it('D3b negative: runs with an empty fingerprint have no source and raise nothing (review F1)', () => {
    const p = project();
    for (let i = 0; i < 3; i += 1) p.run('demo', 'passed', 'none', '');
    expect(p.finding('quality.repeat_runs')).toBeUndefined();
  }, SLOW);
});

describe('B230.D many review rounds', () => {
  it('D4 three rounds are named, two are not', () => {
    const p = project(['alpha', 'bravo']);
    p.rounds('alpha', 3);
    p.rounds('bravo', 2);
    const found = p.finding('quality.review_rounds');
    expect(found).toBeDefined();
    expect(JSON.stringify(found)).toContain('alpha');
    expect(JSON.stringify(found)).not.toContain('bravo');
  }, SLOW);

  it('D5 a configured round_warn of 5 leaves four rounds unnamed', () => {
    const p = project();
    p.setLoops({ round_warn: 5 });
    p.rounds('demo', 4);
    expect(p.finding('quality.review_rounds')).toBeUndefined();
  }, SLOW);

  it('D7 a change whose state history is older than the window is named for rounds and runs logged inside it', () => {
    const p = project();
    const stateFile = path.join(p.root, 'openspec/changes/demo/.sdlc.yaml');
    const state = parse(read(stateFile));
    for (const event of state.history ?? []) event.at = '2020-01-01T00:00:00.000Z';
    if (state.created) state.created = '2020-01-01T00:00:00.000Z';
    write(stateFile, stringify(state));
    p.rounds('demo', 3);
    for (let i = 0; i < 3; i += 1) p.run('demo', 'passed', 'S1');
    expect(JSON.stringify(p.finding('quality.review_rounds'))).toContain('demo');
    expect(JSON.stringify(p.finding('quality.repeat_runs'))).toContain('demo');
  }, SLOW);
});

describe('B230.D thresholds are protected configuration', () => {
  it('D6 repeat_runs 1 by hand: the default 3 applies and doctor names the key', () => {
    const p = project();
    p.setLoops({ repeat_runs: 1 });
    p.run('demo', 'passed', 'S1');
    p.run('demo', 'passed', 'S1');
    expect(p.finding('quality.repeat_runs')).toBeUndefined();
    p.run('demo', 'failed', 'S1');
    expect(p.finding('quality.repeat_runs')).toBeDefined();
    const checks = (p.cli(['doctor', '--json']).json<Json>().checks ?? []) as Json[];
    const named = checks.filter((c) => JSON.stringify(c).includes('loops.repeat_runs'));
    expect(named.length).toBeGreaterThan(0);
    expect(named.every((c) => c.status === 'error')).toBe(true);
  }, SLOW);

  it.each([
    ['loops.repeat_runs=1', 'loops.repeat_runs'],
    ['loops.round_warn=x', 'loops.round_warn'],
  ])('D6 negative: a proposal with %s is refused naming %s', (set, key) => {
    const p = project();
    const r = p.cli(['config', 'propose', '--set', set, '--reason', 'x', '--json'], AGENT);
    expect(r.code).not.toBe(0);
    expect(r.json<{ status: Json[] }>().status[0].code).toBe('invalid_config');
    expect(r.stdout).toContain(key);
    // A known threshold with a bad value is not called unknown (the B224 message for loops values).
    expect(r.stdout).not.toMatch(/Unknown configuration key/i);
  }, SLOW);

  it('D6 a valid threshold proposal is accepted', () => {
    const p = project();
    const r = p.cli(['config', 'propose', '--set', 'loops.round_warn=4', '--reason', 'x', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
  }, SLOW);
});
