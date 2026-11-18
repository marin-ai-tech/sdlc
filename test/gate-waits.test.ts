import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { decisionProject } from './e20-decision-fixture.js';
import { FILES } from './farewell-fixture.js';
import { git, read, runCli, write } from './helpers.js';

/**
 * OpenSpec change gate-waits-start-when-ready (B181, epic E17). A wait for a person starts when the agent's turn that
 * completed the gate's artifacts ends (the Stop hook records `gate.<g>.awaiting`), not when a person next runs a
 * command; and each approver of a gate that needs two gets a wait of their own (`approvals` on the awaiting entry,
 * `metrics.approverWaits` in `sdlc audit`). Recording never changes the Stop hook's answer. Oracles: the log files
 * and the gate's approvals in `.sdlc.yaml`; time is moved by editing the recorded timestamp, never by sleeping.
 */

const SLOW = 180000;
const HOURS = 3600 * 1000;
type Entry = Record<string, any>;

function logFiles(root: string): string[] {
  return ['log.jsonl', 'hook-log.jsonl'].map((name) => path.join(root, 'openspec/.sdlc', name));
}

function entries(root: string): Entry[] {
  return logFiles(root).filter((file) => fs.existsSync(file))
    .flatMap((file) => read(file).split('\n').filter(Boolean).map((line) => JSON.parse(line)));
}

function awaiting(root: string, gate: string): Entry[] {
  return entries(root).filter((e) => e.event === `gate.${gate}.awaiting` && e.change === 'demo');
}

/** Moves the recorded time of one awaiting entry (in whichever log file holds it) `ms` into the past. */
function shiftAwaiting(root: string, gate: string, ms: number, approvals = 0): void {
  for (const file of logFiles(root).filter((f) => fs.existsSync(f))) {
    const lines = read(file).split('\n');
    const moved = lines.map((line) => {
      if (!line) return line;
      const e = JSON.parse(line);
      if (e.event !== `gate.${gate}.awaiting` || e.change !== 'demo' || (e.approvals ?? 0) !== approvals) return line;
      return JSON.stringify({ ...e, ts: new Date(Date.parse(e.ts) - ms).toISOString() });
    });
    fs.writeFileSync(file, moved.join('\n'));
  }
}

function setConfig(root: string, edit: (config: Entry) => void): void {
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  edit(config);
  write(file, stringify(config));
}

function stopHook(root: string, env: NodeJS.ProcessEnv) {
  const input = JSON.stringify({ session_id: 's-b181', cwd: root, hook_event_name: 'Stop' });
  const r = runCli(['hook', 'stop'], root, env, input);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r.stdout.trim();
}

describe('B181.S a wait starts when the agent turn ends', () => {
  it('S1 the Stop hook records the wait, and hours before the approval count as waiting', () => {
    const p = decisionProject();
    setConfig(p.root, (config) => { config.enforcement.verify_before_stop = false; });
    expect(awaiting(p.root, 'intent'), 'no command computed the next step yet').toHaveLength(0);
    stopHook(p.root, p.env);
    const recorded = awaiting(p.root, 'intent');
    expect(recorded, 'the Stop hook records the wait for the intent gate').toHaveLength(1);
    shiftAwaiting(p.root, 'intent', 3 * HOURS);
    const approve = p.cli(['approve', 'intent', '--change', 'demo', '--json']);
    expect(approve.code, approve.stdout + approve.stderr).toBe(0);
    expect(awaiting(p.root, 'intent'), 'the approval adds no second wait for the same digest').toHaveLength(1);
    const audit = p.cli(['audit', '--change', 'demo', '--json']);
    expect(audit.code, audit.stdout + audit.stderr).toBe(0);
    const seconds = audit.json().metrics.waits.intent.seconds;
    expect(seconds).toBeGreaterThanOrEqual(3 * 3600 - 5);
    expect(seconds).toBeLessThan(3 * 3600 + 600);
  }, SLOW);

  it('S2 negative: no wait while the spec artifacts are missing', () => {
    const p = decisionProject();
    for (const file of ['specs/greeting/spec.md', 'design.md']) fs.rmSync(path.join(p.dir, file));
    expect(p.cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    stopHook(p.root, p.env);
    expect(awaiting(p.root, 'spec')).toHaveLength(0);
  }, SLOW);

  it('S3 the stop message is unchanged while a wait is recorded', () => {
    const p = decisionProject();
    setConfig(p.root, (config) => {
      config.enforcement.verify_before_stop = true;
      config.verify.commands = [{ name: 'unit', run: 'node -e 0', required: true }];
    });
    expect(p.cli(['new', 'done', '--json']).code).toBe(0);
    const done = path.join(p.root, 'openspec/changes/done');
    write(path.join(done, 'intent.md'), FILES['intent.md']);
    for (const gate of ['intent', 'spec', 'plan']) {
      expect(p.cli(['waive', gate, '--change', 'done', '--note', 'test', '--json']).code).toBe(0);
    }
    write(path.join(done, 'plan.md'), FILES['plan.md']);
    write(path.join(done, 'tasks.md'), FILES['tasks.md']);
    const message = stopHook(p.root, p.env);
    expect(message).toContain('done');
    expect(message).toMatch(/verif/i);
    expect(message).not.toMatch(/awaiting/i);
    expect(awaiting(p.root, 'intent'), 'the wait of demo is recorded at the same stop').toHaveLength(1);
  }, SLOW);
});

describe('B181.S4 lead review: a code-bound gate waits from the stop too, with the default settings', () => {
  // The review and release gates' digests hold the source fingerprint. With verify_before_stop off (the default),
  // the stop observer must still evaluate with the fingerprint, or those gates have no digest and no wait.
  it('S4 after verify and review.md, the Stop hook records gate.review.awaiting', () => {
    const p = decisionProject();
    const change = (file: string) => path.join(p.dir, file);
    write(path.join(p.root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module',
      scripts: { test: 'node -e 0' } }));
    setConfig(p.root, (config) => {
      config.enforcement.verify_before_stop = false;
      config.verify.commands = [{ name: 'unit', run: 'npm test', required: true }];
    });
    fs.rmSync(change('review.md'));
    for (const gate of ['intent', 'spec', 'plan']) {
      const r = p.cli(['approve', gate, '--change', 'demo', '--json']);
      expect(r.code, `${gate}: ${r.stdout}${r.stderr}`).toBe(0);
    }
    const verified = p.cli(['verify', '--change', 'demo', '--json']);
    expect(verified.code, verified.stdout + verified.stderr).toBe(0);
    write(change('review.md'), FILES['review.md']);
    expect(awaiting(p.root, 'review'), 'no command computed the review step yet').toHaveLength(0);
    stopHook(p.root, p.env);
    expect(awaiting(p.root, 'review')).toHaveLength(1);
  }, SLOW);
});

describe('B181.A each approver has a wait of their own', () => {
  it('A1 the second approver of a high-risk gate waits from the first approval', () => {
    const p = decisionProject(true);
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    const first = p.cli(['approve', 'intent', '--change', 'demo', '--json']);
    expect(first.code, first.stdout + first.stderr).toBe(0);
    expect(p.gate().status).toBe('pending');
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    const waits = awaiting(p.root, 'intent');
    expect(waits.map((e) => e.approvals ?? 0)).toEqual([0, 1]);
    shiftAwaiting(p.root, 'intent', 4 * HOURS, 1);
    git(p.root, ['config', 'user.name', 'Other Lead']);
    git(p.root, ['config', 'user.email', 'other@example.com']);
    const second = p.cli(['approve', 'intent', '--change', 'demo', '--as', 'tech-lead', '--json']);
    expect(second.code, second.stdout + second.stderr).toBe(0);
    expect(p.gate().status).toBe('approved');
    const metrics = p.cli(['audit', '--change', 'demo', '--json']).json().metrics;
    const perApprover = metrics.approverWaits.intent;
    expect(perApprover.map((w: Entry) => w.approvals)).toEqual([0, 1]);
    expect(perApprover[1].seconds).toBeGreaterThanOrEqual(4 * 3600 - 5);
    expect(perApprover[1].seconds).toBeLessThan(4 * 3600 + 600);
  }, SLOW);

  it('A2 awaiting entries of 0.32.1 without approvals count as the first wait; waits stay as before', () => {
    const p = decisionProject();
    const approve = p.cli(['approve', 'intent', '--change', 'demo', '--json']);
    expect(approve.code).toBe(0);
    const state = parse(read(p.stateFile));
    const approval = state.gates.intent.approvals[0];
    for (const file of logFiles(p.root).filter((f) => fs.existsSync(f))) {
      const kept = read(file).split('\n').filter((line) => !line.includes('"gate.intent.awaiting"'));
      fs.writeFileSync(file, kept.join('\n'));
    }
    const old = { ts: new Date(Date.parse(approval.at) - 600000).toISOString(), event: 'gate.intent.awaiting',
      change: 'demo', detail: approval.digest, sdlc: '0.32.1', license: 'community' };
    fs.appendFileSync(logFiles(p.root)[0], `\n${JSON.stringify(old)}\n`);
    const audit = p.cli(['audit', '--change', 'demo', '--json']);
    expect(audit.code, audit.stdout + audit.stderr).toBe(0);
    const metrics = audit.json().metrics;
    expect(metrics.waits.intent.seconds).toBe(600);
    expect(metrics.approverWaits.intent).toEqual([{ approvals: 0, seconds: 600 }]);
  }, SLOW);
});

describe('B181 review round 1', () => {
  // Independent review (e17-r2, 2026-11-16) F1: recordAwaiting also records policy waivers, and writes them into the
  // change record when no agent marker is in the environment. A hook must never make a policy waiver permanent
  // (src/core/auto-waive.ts); the markers are not a reliable sign of a hook. A person's command still records it.
  it('R1-F1 the Stop and session-start hooks never write a policy waiver into the change record', () => {
    const p = decisionProject();
    expect(parse(read(p.stateFile)).kind).toBe('feature');
    setConfig(p.root, (config) => {
      config.gates.intent = { ...(config.gates.intent ?? {}), auto_waive: { kinds: ['feature'] } };
    });
    stopHook(p.root, p.env);
    const start = JSON.stringify({ session_id: 's-b181', cwd: p.root, hook_event_name: 'SessionStart', source: 'startup' });
    expect(runCli(['hook', 'session-start'], p.root, p.env, start).code).toBe(0);
    expect(parse(read(p.stateFile)).gates?.intent?.waived, 'a hook recorded the waiver').toBeUndefined();
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
    expect(parse(read(p.stateFile)).gates.intent.waived).toMatchObject({ by: 'policy' });
  }, SLOW);

  // F2: the stop observer looked at the first eight active changes only; a ninth change's wait started later.
  it('R1-F2 the Stop hook records the waits of every active change, not the first eight', () => {
    const p = decisionProject();
    setConfig(p.root, (config) => { config.enforcement.verify_before_stop = false; });
    const ids = Array.from({ length: 9 }, (_, i) => `extra-${i + 1}`);
    for (const id of ids) {
      expect(p.cli(['new', id, '--json']).code).toBe(0);
      write(path.join(p.root, 'openspec/changes', id, 'intent.md'), FILES['intent.md']);
    }
    stopHook(p.root, p.env);
    const waiting = new Set(entries(p.root).filter((e) => e.event === 'gate.intent.awaiting').map((e) => e.change));
    expect([...waiting].sort()).toEqual(['demo', ...ids].sort());
  }, SLOW);

  // F3: the outbox id of a wait ignored the approvals count, so a receiver that drops repeated ids dropped the second
  // approver's wait. A first wait keeps the id it had in 0.32.1.
  it('R1-F3 a second approver wait has its own outbox id; the first keeps the old one', async () => {
    const { createHash } = await import('node:crypto');
    const { entryEventId } = await import('../src/mcp/outbox.js');
    const digest = `sha256:${'a'.repeat(64)}`;
    const base = { ts: '2026-11-16T10:00:00.000Z', event: 'gate.intent.awaiting', change: 'demo', detail: digest,
      sdlc: '0.33.0', license: 'community' };
    const legacy = createHash('sha256').update(['wait', 'demo', 'intent', 'gate.intent.awaiting', digest].join('\n'))
      .digest('hex').slice(0, 24);
    expect(entryEventId(undefined, base, 'intent')).toBe(legacy);
    expect(entryEventId(undefined, { ...base, approvals: 1 }, 'intent')).not.toBe(legacy);
  });
});
