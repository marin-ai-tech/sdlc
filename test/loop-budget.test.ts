import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change loop-budget (B224, epic E17 wave 2). An optional top-level `loops:` section of sdlc.yaml sets a
 * budget of review rounds and full verify runs per change. When a budget is spent and the next step would be the
 * agent's, `next` and `status` give a person's step `loop-budget` with three choices; a person's own step stays and
 * gets a warning. An invalid `loops:` value is ignored and reported (owner, 2026-11-16): no command and no hook fails.
 * Oracles: the B61 rework-limit step shape, the log entries of B182/B226 written here by hand, the config proposal
 * contract and the hook's config-load rule (a bad `health:` value as the positive control).
 */

const SLOW = 240000;
const AGENT = { QWEN_CODE: '1' };
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const ROLES = [
  'version: 1', 'signing: off', 'people:', '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]', '',
].join('\n');

type Json = Record<string, any>;
type Ledger = { runs: Array<{ run: number; status: string; startedAt: string; durationMs?: number; source: string }> };

function project(changes: string[] = ['demo']) {
  const root = tempDir('sdlc-b224-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  write(path.join(root, 'src/a.js'), 'export const a = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const ok = (args: string[], extra: NodeJS.ProcessEnv = {}) => {
    const r = cli(args, extra);
    expect(r.code, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
    return r;
  };
  ok(['init', '--tools', 'none', '--json']);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  for (const change of changes) ok(['new', change, '--json']);
  const configFile = path.join(root, 'openspec/sdlc.yaml');
  const setLoops = (loops: unknown) => {
    const config = parse(read(configFile));
    if (loops === undefined) delete config.loops;
    else config.loops = loops;
    write(configFile, stringify(config));
  };
  const setHealth = (health: unknown) => {
    const config = parse(read(configFile));
    config.health = health;
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
  const run = (change: string, status: 'passed' | 'failed' | 'unfinished', source: string, partial = false) => {
    serial += 1;
    const id = serial.toString(16).padStart(12, '0');
    const at = new Date().toISOString();
    const fingerprint = `git-tree:${source}`;
    append({ ts: at, event: 'verify.started', change, run: { id, started_at: at, fingerprint } });
    if (status === 'unfinished') return;
    append({ ts: at, event: `verify.${status}`, change, run: { id, started_at: at, finished_at: at, duration_ms: 1000,
      fingerprint, trigger: 'changed', partial, checks: [] } });
  };
  const next = (change = 'demo') => ok(['next', '--change', change, '--json']).json<Json>().next;
  const nextJson = (change = 'demo') => ok(['next', '--change', change, '--json']).json<Json>();
  return { root, env, cli, ok, setLoops, setHealth, append, rounds, run, next, nextJson, configFile };
}

describe('B224.N no budget, no change', () => {
  it('N1 rounds and runs without a loops section leave next and health as they were', () => {
    const p = project();
    const before = p.next();
    expect(before.actor).toBe('agent');
    p.rounds('demo', 5);
    for (let i = 0; i < 6; i += 1) p.run('demo', 'passed', 'S1');
    expect(p.next()).toEqual(before);
    const health = p.ok(['health', '--json']).json<Json>();
    expect(JSON.stringify(health)).not.toContain('loop_budget');
  }, SLOW);
});

describe('B224.B a spent budget hands the agent step to a person', () => {
  it('B1 three rounds with review_rounds 3: a loop-budget step for the person who decides the open gate', () => {
    const p = project();
    p.setLoops({ review_rounds: 3 });
    p.rounds('demo', 3);
    const next = p.next();
    expect(next).toMatchObject({ actor: 'human', action: 'loop-budget' });
    expect(next.params).toMatchObject({ kind: 'review_rounds', count: 3, budget: 3 });
    expect(JSON.stringify(next)).toContain('Alice Ivanova');
    expect(next.cli).toMatch(/^sdlc config propose --set loops\.review_rounds=4 --reason "[^"<>]+"$/);
    // The suggested command must run as it is (review F1: --reason is required).
    const args = next.cli.replace(/^sdlc /, '').match(/"[^"]*"|\S+/g).map((a: string) => a.replace(/^"|"$/g, ''));
    const proposed = p.cli([...args, '--json']);
    expect(proposed.code, proposed.stdout + proposed.stderr).toBe(0);
    for (const word of [/split/i, /accept/i, /extend/i]) expect(next.message).toMatch(word);
    const status = p.ok(['status', '--change', 'demo', '--json']).json<Json>();
    expect(status.change.next.action).toBe('loop-budget');
  }, SLOW);

  it('B2 negative: two rounds under a budget of three give the agent step', () => {
    const p = project();
    p.setLoops({ review_rounds: 3 });
    p.rounds('demo', 2);
    const next = p.next();
    expect(next.actor).toBe('agent');
    expect(next.action).not.toBe('loop-budget');
  }, SLOW);

  it('B3 negative: a person\'s approval step stays, with a warning naming the spent budget', () => {
    const p = project();
    write(path.join(p.root, 'openspec/changes/demo/intent.md'), INTENT);
    const before = p.next();
    expect(before.actor).toBe('human');
    p.setLoops({ review_rounds: 3 });
    p.rounds('demo', 3);
    const answer = p.nextJson();
    expect(answer.next.action).toBe(before.action);
    expect(answer.next.action).not.toBe('loop-budget');
    expect(JSON.stringify(answer.warnings ?? [])).toContain('loops.review_rounds');
  }, SLOW);

  it('B4 the E20 replay: verify_runs 10 signals after 15 runs with the repeats, not after 9; 16 does not', () => {
    const ledger = JSON.parse(read(path.join(REPO_ROOT, 'test/fixtures/e20-verify-runs.json'))) as Ledger;
    const replay = (count: number, budget: number) => {
      const p = project();
      p.setLoops({ verify_runs: budget });
      for (const r of ledger.runs.slice(0, count)) {
        p.run('demo', r.status as 'passed' | 'failed' | 'unfinished', r.source);
      }
      return p.next();
    };
    const spent = replay(15, 10);
    expect(spent).toMatchObject({ actor: 'human', action: 'loop-budget' });
    // Finished full runs beyond the first on one source: S1 one, S8 two, S11 none yet (one failed run).
    expect(spent.params).toMatchObject({ kind: 'verify_runs', count: 15, budget: 10, repeats: 3 });
    expect(replay(9, 10).action).not.toBe('loop-budget');
    expect(replay(15, 16).action).not.toBe('loop-budget');
  }, 3 * SLOW);

  it('B6 an agent step made from a person\'s step (an intent with an empty section) is handed over too', () => {
    const p = project();
    const draft = INTENT.replace('## Problem\nP.\n', '## Problem\n\n');
    write(path.join(p.root, 'openspec/changes/demo/intent.md'), draft);
    const before = p.next();
    // Precondition: the approval step was turned back into the agent's step by the draft-intent rule.
    expect(before).toMatchObject({ actor: 'agent', action: 'write-artifact' });
    p.setLoops({ review_rounds: 3 });
    p.rounds('demo', 3);
    expect(p.next()).toMatchObject({ actor: 'human', action: 'loop-budget' });
  }, SLOW);

  it('B5 negative: --only runs do not count against verify_runs', () => {
    const p = project();
    p.setLoops({ verify_runs: 2 });
    p.run('demo', 'passed', 'S1');
    for (let i = 0; i < 3; i += 1) p.run('demo', 'passed', `P${i}`, true);
    expect(p.next().action).not.toBe('loop-budget');
  }, SLOW);
});

describe('B224.A an agent cannot extend the budget', () => {
  it('A1 a proposal sets the budget; raising it is a weakening; an agent cannot apply it', () => {
    const p = project();
    const propose = (value: number) => {
      const r = p.cli(['config', 'propose', '--set', `loops.review_rounds=${value}`, '--reason', 'budget', '--json'],
        AGENT);
      expect(r.code, r.stdout + r.stderr).toBe(0);
      return r.json<{ id: string }>().id;
    };
    const first = propose(3);
    p.ok(['config', 'apply', first, '--json']);
    expect(parse(read(p.configFile)).loops).toEqual({ review_rounds: 3 });
    const raise = propose(5);
    const shown = p.ok(['config', 'show', raise, '--json']).json<{ warnings: string[]; weakens: boolean }>();
    expect(shown.weakens).toBe(true);
    expect(shown.warnings.join('\n')).toContain('loops.review_rounds');
    expect(p.cli(['config', 'apply', raise], AGENT).code).not.toBe(0);
    const payload = { session_id: 's1', cwd: p.root, hook_event_name: 'PreToolUse', tool_name: 'run_shell_command',
      tool_input: { command: `sdlc config apply ${raise}` } };
    const hook = p.cli(['hook', 'pre-tool', '--agent', 'qwen'], AGENT, JSON.stringify(payload));
    expect(JSON.parse(hook.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(parse(read(p.configFile)).loops).toEqual({ review_rounds: 3 });
  }, SLOW);

  it.each([
    ['loops.review_rounds=0', 'loops.review_rounds'],
    ['loops.verify_runs=two', 'loops.verify_runs'],
    ['loops.rounds=3', 'loops.rounds'],
  ])('A2 negative: a proposal with %s is refused naming %s', (set, key) => {
    const p = project();
    const r = p.cli(['config', 'propose', '--set', set, '--reason', 'x', '--json'], AGENT);
    expect(r.code).not.toBe(0);
    expect(r.json<{ status: Json[] }>().status[0].code).toBe('invalid_config');
    expect(r.stdout).toContain(key);
    // A known key with a bad value is not called unknown.
    if (key !== 'loops.rounds') expect(r.stdout).not.toMatch(/Unknown configuration key/i);
  }, SLOW);
});

describe('B224.I an invalid budget is ignored and reported', () => {
  function badBudget() {
    const p = project();
    p.setLoops({ review_rounds: -1, verify_runs: 2 });
    p.rounds('demo', 3);
    p.run('demo', 'passed', 'S1');
    return p;
  }

  it('I1 next keeps the agent step; doctor reports the key; status warns; the hook allows a read', () => {
    const p = badBudget();
    const next = p.next();
    expect(next.actor).toBe('agent');
    const doctor = p.cli(['doctor', '--json']);
    const checks = (doctor.json<Json>().checks ?? []) as Json[];
    const loops = checks.filter((c) => JSON.stringify(c).includes('loops.review_rounds'));
    expect(loops.length, doctor.stdout).toBeGreaterThan(0);
    expect(loops.every((c) => c.status === 'error')).toBe(true);
    expect(JSON.stringify(checks)).not.toContain('loops.verify_runs');
    const status = p.ok(['status', '--change', 'demo']);
    expect(status.stdout + status.stderr).toContain('loops.review_rounds');
    const read = (extra: Json = {}) => {
      const payload = { session_id: 's1', cwd: p.root, hook_event_name: 'PreToolUse', tool_name: 'read_file',
        tool_input: { absolute_path: path.join(p.root, 'src/a.js') }, ...extra };
      const r = p.cli(['hook', 'pre-tool', '--agent', 'qwen'], AGENT, JSON.stringify(payload));
      return r.stdout.trim() ? JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision ?? 'none' : 'none';
    };
    expect(read()).not.toBe('deny');
    // Positive control: the same hook call is denied for a bad health: value (config-load).
    p.setHealth({ no_such_key: 1 });
    expect(read()).toBe('deny');
  }, SLOW);

  it('I2 a valid key next to a bad one still applies', () => {
    const p = badBudget();
    p.run('demo', 'failed', 'S2');
    const next = p.next();
    expect(next).toMatchObject({ actor: 'human', action: 'loop-budget' });
    expect(next.params).toMatchObject({ kind: 'verify_runs', count: 2, budget: 2 });
  }, SLOW);
});

describe('B224.H health reports spent budgets', () => {
  it('H1 the finding names the change over its budget and not the one under it', () => {
    const p = project(['alpha', 'bravo']);
    p.setLoops({ review_rounds: 2 });
    p.rounds('alpha', 2);
    p.rounds('bravo', 1);
    const health = p.ok(['health', '--json']).json<Json>();
    const findings = JSON.stringify(health.findings ?? health);
    const finding = ((health.findings ?? []) as Json[]).find((f) => f.id === 'discipline.loop_budget');
    expect(finding, findings).toBeDefined();
    expect(JSON.stringify(finding)).toContain('alpha');
    expect(JSON.stringify(finding)).not.toContain('bravo');
  }, SLOW);

  it('H2 a change whose history is older than the health window but whose budget is spent is named', () => {
    const p = project();
    const stateFile = path.join(p.root, 'openspec/changes/demo/.sdlc.yaml');
    const state = parse(read(stateFile));
    for (const event of state.history ?? []) event.at = '2020-01-01T00:00:00.000Z';
    if (state.created) state.created = '2020-01-01T00:00:00.000Z';
    write(stateFile, stringify(state));
    p.setLoops({ review_rounds: 2 });
    p.rounds('demo', 2);
    expect(p.next().action).toBe('loop-budget');
    const health = p.ok(['health', '--json']).json<Json>();
    const finding = ((health.findings ?? []) as Json[]).find((f) => f.id === 'discipline.loop_budget');
    expect(finding, JSON.stringify(health.findings)).toBeDefined();
    expect(JSON.stringify(finding)).toContain('demo');
  }, SLOW);
});
