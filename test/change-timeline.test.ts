import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { parseManifest } from '../dist/plugins/manifest.js';
import { manifest } from './fixtures/plugin-modules.js';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change change-timeline (B228, first half; epic E17 wave 3). `sdlc timeline <change> [--json]` lists the
 * spans of a change from what sdlc already records: stage spans between the last approvals of its gates, gate waits
 * (awaiting entry to approval), verify runs (start to finish) and review rounds (points). Overlap is never summed;
 * ids are stable. Agent sessions come with B227. Oracles: the E20 handoff packet (history, approvals, awaiting
 * entries, run starts and durations) in test/fixtures/e20-timeline.json, hand-written log entries, the plugin
 * manifest contract, and the files on disk.
 */

const SLOW = 240000;
const HOUR = 3600 * 1000;
const MINUTE = 60 * 1000;

type Json = Record<string, any>;
type Span = { id: string; kind: string; name: string; start: string; end: string | null; open: boolean; attrs: Json };
type Fixture = {
  change: string; created: string; history: Json[]; gates: Json; awaiting: Json[];
  runs: Array<{ run: number; status: string; startedAt: string; durationMs?: number; source: string }>;
  reviewRounds: Array<{ ts: string; n: number }>;
};

function project(changes: string[]) {
  const root = tempDir('sdlc-b228-');
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
  const logFile = path.join(root, 'openspec/.sdlc/log.jsonl');
  const append = (entry: Json) => {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `${JSON.stringify({ sdlc: '0.33.0', license: 'community', ...entry })}\n`);
  };
  const stateFile = (change: string) => path.join(root, 'openspec/changes', change, '.sdlc.yaml');
  const setState = (change: string, edit: (state: Json) => void) => {
    const state = parse(read(stateFile(change)));
    edit(state);
    write(stateFile(change), stringify(state));
  };
  let serial = 0;
  const run = (change: string, status: string, start: string, ms: number | undefined, fingerprint: string) => {
    serial += 1;
    const id = serial.toString(16).padStart(12, '0');
    append({ ts: start, event: 'verify.started', change, run: { id, started_at: start, fingerprint } });
    if (status === 'unfinished' || ms === undefined) return id;
    const end = new Date(Date.parse(start) + ms).toISOString();
    append({ ts: end, event: `verify.${status}`, change, run: { id, started_at: start, finished_at: end,
      duration_ms: ms, fingerprint, trigger: 'changed', partial: false, checks: [] } });
    return id;
  };
  const round = (change: string, ts: string, n: number) => {
    serial += 1;
    append({ ts, event: 'review.round', change, round: { n, fingerprint: `git-tree:r${serial}`,
      review: serial.toString(16).padStart(64, '0'), counts: { total: 1, open: 1, blocking: 1 } } });
  };
  const timeline = (change: string): Json => {
    const r = ok(['timeline', change, '--json']);
    return r.json<Json>();
  };
  return { root, cli, ok, append, setState, stateFile, run, round, timeline };
}

function e20Project() {
  const fixture = JSON.parse(read(path.join(REPO_ROOT, 'test/fixtures/e20-timeline.json'))) as Fixture;
  const p = project([fixture.change]);
  p.setState(fixture.change, (state) => {
    state.created = fixture.created;
    state.history = fixture.history;
    state.gates = fixture.gates;
  });
  for (const entry of fixture.awaiting) p.append({ ...entry, change: fixture.change });
  for (const r of fixture.runs) p.run(fixture.change, r.status, r.startedAt, r.durationMs, `git-tree:${r.source}`);
  for (const r of fixture.reviewRounds) p.round(fixture.change, r.ts, r.n);
  return { p, fixture };
}

const ms = (iso: string | null) => (iso === null ? NaN : Date.parse(iso));
const byStart = (spans: Span[]) => [...spans].sort((a, b) => ms(a.start) - ms(b.start));

/** Groups of three consecutive passed runs (by start) on one fingerprint. */
function greenTriples(runs: Span[]): string[] {
  const sorted = byStart(runs);
  const found: string[] = [];
  for (let i = 0; i + 2 < sorted.length; i += 1) {
    const three = sorted.slice(i, i + 3);
    const same = three.every((s) => s.attrs.fingerprint === three[0].attrs.fingerprint);
    if (same && three.every((s) => s.attrs.result === 'passed')) found.push(String(three[0].attrs.fingerprint));
  }
  return found;
}

describe('B228.T a change timeline from recorded data', () => {
  it('T1 the E20 replay: a 38-hour build/verify/review span, two green triples, rounds between them', () => {
    const { p, fixture } = e20Project();
    const t = p.timeline(fixture.change);
    expect(t.change).toBe(fixture.change);
    const spans = t.spans as Span[];
    const build = spans.find((s) => s.kind === 'stage' && s.name === 'build-verify-review');
    expect(build, JSON.stringify(spans.filter((s) => s.kind === 'stage'))).toBeDefined();
    expect(build!.start.startsWith('2026-10-30T10:36:28')).toBe(true);
    expect(build!.end?.startsWith('2026-11-01T00:49:51')).toBe(true);
    const hours = (ms(build!.end) - ms(build!.start)) / HOUR;
    expect(hours).toBeGreaterThan(38);
    expect(hours).toBeLessThan(38.5);
    const runs = spans.filter((s) => s.kind === 'run');
    expect(runs).toHaveLength(fixture.runs.length);
    const triples = greenTriples(runs);
    expect(triples.some((f) => f.includes('S8'))).toBe(true);
    expect(triples.some((f) => f.includes('S11'))).toBe(true);
    expect(triples.some((f) => f.includes('S1') && !f.includes('S11')), 'the failed runs 1 form no triple')
      .toBe(false);
    const run10 = byStart(runs).filter((s) => s.attrs.fingerprint.includes('S8')).at(-1)!;
    const run20 = byStart(runs).find((s) => s.attrs.fingerprint.includes('S11'))!;
    const rounds = spans.filter((s) => s.kind === 'round');
    expect(rounds.map((s) => s.attrs.n)).toEqual([1, 2]);
    for (const r of rounds) {
      expect(ms(r.start)).toBeGreaterThan(ms(run10.end));
      expect(ms(r.start)).toBeLessThan(ms(run20.start));
    }
    expect(t.traceId).toMatch(/^[0-9a-f]{32}$/);
  }, SLOW);

  it('T1b the text output lists the spans in time order and names the 38-hour stage', () => {
    const { p, fixture } = e20Project();
    const text = p.ok(['timeline', fixture.change]).stdout;
    expect(text).toContain('build-verify-review');
    expect(text).toContain('S8');
    expect(text.indexOf('intent')).toBeLessThan(text.indexOf('build-verify-review'));
    expect(text).not.toMatch(/idle/i);
    expect(text, 'acceptance: long spans read in hours').toContain('38.2 h');
    expect(text, 'acceptance: no raw milliseconds').not.toMatch(/\d{6,} ?ms/);
    expect(text, 'acceptance: fingerprints in their short form').not.toContain('git-tree:');
  }, SLOW);

  it('T2 a wait ends at its approval; a wait with no approval is open', () => {
    const p = project(['demo']);
    const t0 = Date.parse('2026-11-10T08:00:00.000Z');
    const at = (h: number) => new Date(t0 + h * HOUR).toISOString();
    const intent = `sha256:${'a'.repeat(64)}`;
    const spec = `sha256:${'b'.repeat(64)}`;
    p.setState('demo', (state) => {
      state.created = at(0);
      state.history = [{ at: at(0), event: 'change.created', by: 'P <p@example.com>' },
        { at: at(2), event: 'gate.intent.approved', by: 'P <p@example.com>', detail: 'role product-owner' }];
      state.gates = { intent: { approvals: [{ role: 'product-owner', by: 'P <p@example.com>', at: at(2), seq: 1,
        digest: intent }] } };
    });
    p.append({ ts: at(1), event: 'gate.intent.awaiting', change: 'demo', detail: intent });
    p.append({ ts: at(3), event: 'gate.spec.awaiting', change: 'demo', detail: spec });
    const waits = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'wait');
    const first = waits.find((s) => s.attrs.gate === 'intent')!;
    expect(first.start).toBe(at(1));
    expect(first.end).toBe(at(2));
    expect(first.open).toBe(false);
    const second = waits.find((s) => s.attrs.gate === 'spec')!;
    expect(second.start).toBe(at(3));
    expect(second.end).toBeNull();
    expect(second.open).toBe(true);
    expect(waits).toHaveLength(2);
  }, SLOW);

  it('T2b acceptance: a wait for a digest superseded by a newer one is not left open', () => {
    const p = project(['demo']);
    const t0 = Date.parse('2026-11-10T08:00:00.000Z');
    const at = (h: number) => new Date(t0 + h * HOUR).toISOString();
    const old = `sha256:${'c'.repeat(64)}`;
    const current = `sha256:${'d'.repeat(64)}`;
    p.setState('demo', (state) => {
      state.created = at(0);
      state.history = [{ at: at(0), event: 'change.created', by: 'P <p@example.com>' },
        { at: at(5), event: 'gate.intent.approved', by: 'P <p@example.com>', detail: 'role product-owner' }];
      state.gates = { intent: { approvals: [{ role: 'product-owner', by: 'P <p@example.com>', at: at(5), seq: 1,
        digest: current }] } };
    });
    p.append({ ts: at(3), event: 'gate.intent.awaiting', change: 'demo', detail: old });
    p.append({ ts: at(4), event: 'gate.intent.awaiting', change: 'demo', detail: current });
    const waits = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'wait');
    expect(waits.filter((s) => s.open), JSON.stringify(waits)).toHaveLength(0);
    expect(waits.find((s) => s.start === at(4) && s.end === at(5))).toBeDefined();
  }, SLOW);

  it('T2c acceptance: a gate approved again after a rework gives no span that ends before it starts', () => {
    const p = project(['demo']);
    const t0 = Date.parse('2026-11-10T08:00:00.000Z');
    const at = (h: number) => new Date(t0 + h * HOUR).toISOString();
    const by = 'P <p@example.com>';
    p.setState('demo', (state) => {
      state.created = at(0);
      state.history = [{ at: at(0), event: 'change.created', by },
        { at: at(1), event: 'gate.intent.approved', by }, { at: at(2), event: 'gate.spec.approved', by },
        { at: at(3), event: 'gate.plan.approved', by }, { at: at(4), event: 'gate.spec.approved', by }];
    });
    const stages = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'stage');
    for (const s of stages) {
      if (s.end !== null) expect(ms(s.end), JSON.stringify(s)).toBeGreaterThanOrEqual(ms(s.start));
    }
    const open = stages.filter((s) => s.open);
    expect(open, JSON.stringify(stages)).toHaveLength(1);
    expect(open[0]).toMatchObject({ name: 'plan', start: at(4) });
  }, SLOW);

  it('T3 an unfinished run is open and not counted in the covered run time', () => {
    const p = project(['demo']);
    p.run('demo', 'passed', '2026-11-10T08:00:00.000Z', 60 * MINUTE, 'git-tree:aaa');
    p.run('demo', 'unfinished', '2026-11-10T07:30:00.000Z', undefined, 'git-tree:aaa');
    const t = p.timeline('demo');
    const runs = (t.spans as Span[]).filter((s) => s.kind === 'run');
    expect(runs).toHaveLength(2);
    const open = runs.find((s) => s.attrs.result === 'unfinished')!;
    expect(open.end).toBeNull();
    expect(open.open).toBe(true);
    expect(t.summary.covered.run).toBe(60 * MINUTE);
  }, SLOW);

  it('T4 the command writes nothing', () => {
    const { p, fixture } = e20Project();
    const files = ['openspec/.sdlc/log.jsonl', 'openspec/.sdlc/hook-log.jsonl',
      `openspec/changes/${fixture.change}/.sdlc.yaml`].map((f) => path.join(p.root, f));
    const snapshot = () => files.map((f) => (fs.existsSync(f) ? read(f) : '<none>'));
    const before = snapshot();
    p.ok(['timeline', fixture.change, '--json']);
    p.ok(['timeline', fixture.change]);
    expect(snapshot()).toEqual(before);
  }, SLOW);

  it('T5 an archived change has its timeline; an unknown change is refused', () => {
    const p = project(['demo']);
    p.run('demo', 'passed', '2026-11-10T08:00:00.000Z', 30 * MINUTE, 'git-tree:aaa');
    const from = path.join(p.root, 'openspec/changes/demo');
    const to = path.join(p.root, 'openspec/changes/archive/2026-11-11-demo');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    const t = p.timeline('demo');
    expect(t.archived).toBe(true);
    expect((t.spans as Span[]).filter((s) => s.kind === 'run')).toHaveLength(1);
    const unknown = p.cli(['timeline', 'no-such-change', '--json']);
    expect(unknown.code).not.toBe(0);
    expect(unknown.stdout).not.toContain('"spans"');
  }, SLOW);
});

describe('B228.T overlap is never summed', () => {
  it('T6 two 60-minute runs overlapping by 30 minutes cover 90 minutes, not 120', () => {
    const p = project(['demo']);
    p.run('demo', 'passed', '2026-11-10T10:00:00.000Z', 60 * MINUTE, 'git-tree:aaa');
    p.run('demo', 'failed', '2026-11-10T10:30:00.000Z', 60 * MINUTE, 'git-tree:bbb');
    const t = p.timeline('demo');
    const runs = byStart((t.spans as Span[]).filter((s) => s.kind === 'run'));
    expect(runs.map((s) => [s.start, s.end])).toEqual([
      ['2026-11-10T10:00:00.000Z', '2026-11-10T11:00:00.000Z'],
      ['2026-11-10T10:30:00.000Z', '2026-11-10T11:30:00.000Z'],
    ]);
    expect(t.summary.covered.run).toBe(90 * MINUTE);
    expect(t.summary.covered.run).not.toBe(120 * MINUTE);
    expect(JSON.stringify(t.summary)).not.toMatch(/idle/i);
  }, SLOW);
});

describe('B228.T stable ids', () => {
  it('T7 the same change gives the same ids twice; another change another trace id', () => {
    const p = project(['alpha', 'beta']);
    for (const change of ['alpha', 'beta']) {
      p.run(change, 'passed', '2026-11-10T10:00:00.000Z', 10 * MINUTE, 'git-tree:aaa');
      p.round(change, '2026-11-10T11:00:00.000Z', 1);
    }
    const a1 = p.timeline('alpha');
    const a2 = p.timeline('alpha');
    const b = p.timeline('beta');
    expect(a1.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a2.traceId).toBe(a1.traceId);
    expect(b.traceId).not.toBe(a1.traceId);
    const ids = (t: Json) => (t.spans as Span[]).map((s) => s.id);
    expect(ids(a2)).toEqual(ids(a1));
    for (const id of ids(a1)) expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(new Set(ids(a1)).size).toBe(ids(a1).length);
    expect(ids(b).some((id) => ids(a1).includes(id))).toBe(false);
  }, SLOW);
});

describe('B228.T review round 1 (findings F1, F2, F3, F5)', () => {
  it('T9 two different rounds numbered 1 (merged branches) are two spans with different ids', () => {
    const p = project(['demo']);
    p.round('demo', '2026-11-10T10:00:00.000Z', 1);
    p.round('demo', '2026-11-10T12:00:00.000Z', 1);
    const rounds = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'round');
    expect(rounds, JSON.stringify(rounds)).toHaveLength(2);
    expect(new Set(rounds.map((s) => s.id)).size).toBe(2);
  }, SLOW);

  it('T9b the same round recorded twice by a merge stays one span', () => {
    const p = project(['demo']);
    const round = { n: 1, fingerprint: 'git-tree:same', review: 'e'.repeat(64),
      counts: { total: 0, open: 0, blocking: 0 } };
    p.append({ ts: '2026-11-10T10:00:00.000Z', event: 'review.round', change: 'demo', round });
    p.append({ ts: '2026-11-10T10:00:05.000Z', event: 'review.round', change: 'demo', round });
    const rounds = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'round');
    expect(rounds).toHaveLength(1);
  }, SLOW);

  it('T10 wall time reaches the start of an open span after the last closed one', () => {
    const p = project(['demo']);
    const created = '2026-11-10T07:00:00.000Z';
    p.setState('demo', (state) => {
      state.created = created;
      state.history = [{ at: created, event: 'change.created', by: 'P <p@example.com>' }];
    });
    p.run('demo', 'passed', '2026-11-10T08:00:00.000Z', 60 * MINUTE, 'git-tree:aaa');
    p.run('demo', 'unfinished', '2026-11-10T20:00:00.000Z', undefined, 'git-tree:aaa');
    const t = p.timeline('demo');
    const first = Math.min(...(t.spans as Span[]).map((s) => ms(s.start)));
    expect(t.summary.wallMs).toBe(Date.parse('2026-11-10T20:00:00.000Z') - first);
  }, SLOW);

  it('T11 a finish with a bad finished_at ends at its log time, never an open passed run', () => {
    const p = project(['demo']);
    const start = '2026-11-10T08:00:00.000Z';
    const end = '2026-11-10T08:20:00.000Z';
    p.append({ ts: start, event: 'verify.started', change: 'demo', run: { id: 'r1', started_at: start } });
    p.append({ ts: end, event: 'verify.passed', change: 'demo', run: { id: 'r1', started_at: start,
      finished_at: 'not-a-time', duration_ms: 20 * MINUTE, partial: false, checks: [] } });
    const runs = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'run');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ end, open: false });
    expect(runs.filter((s) => s.open && s.attrs.result === 'passed')).toHaveLength(0);
  }, SLOW);

  it('T12 two open waits of one gate at the same time with different digests get different ids', () => {
    const p = project(['demo']);
    const ts = '2026-11-10T08:00:00.000Z';
    p.append({ ts, event: 'gate.intent.awaiting', change: 'demo', detail: `sha256:${'1'.repeat(64)}` });
    p.append({ ts, event: 'gate.intent.awaiting', change: 'demo', detail: `sha256:${'2'.repeat(64)}` });
    const waits = (p.timeline('demo').spans as Span[]).filter((s) => s.kind === 'wait');
    expect(new Set(waits.map((s) => s.id)).size, JSON.stringify(waits)).toBe(waits.length);
  }, SLOW);
});

describe('B228.T trace keeps its meaning; the name is reserved', () => {
  it('T8 trace JSON has no timeline fields', () => {
    const p = project(['demo']);
    p.run('demo', 'passed', '2026-11-10T10:00:00.000Z', 10 * MINUTE, 'git-tree:aaa');
    const trace = p.ok(['trace', 'demo', '--json']).json<Json>();
    expect(trace).not.toHaveProperty('spans');
    expect(trace).not.toHaveProperty('traceId');
  }, SLOW);

  it('T8b a plugin cannot take the name timeline, in the loader and in the published schema', () => {
    const value = manifest({ name: 'timeline' });
    expect(() => parseManifest(value)).toThrow(/reserved/);
    const Ajv = createRequire(import.meta.url)('ajv/dist/2020');
    const schemaFile = path.join(REPO_ROOT, 'schemas/contracts/plugin-manifest.schema.json');
    const valid = new Ajv({ strict: false }).compile(JSON.parse(read(schemaFile)));
    expect(valid(value)).toBe(false);
    expect(valid(manifest({ name: 'timeline-tools' })), 'a longer name stays allowed').toBe(true);
  });
});
