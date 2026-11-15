import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { eventBody, outboxDir } from '../src/mcp/outbox.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * OpenSpec change events-carry-the-stage (2026-11-15, stand finding F-0321-1). SkillForge's sdlc-registry plugin
 * matched the `<x>` of `gate.<x>.<outcome>` against the roles' stages, but `<x>` is the gate id. An event of a gate
 * now names the lifecycle stage of that gate in `stage`; a verify event names `test`; other events have none.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');

function project() {
  const root = tempDir('sdlc-event-stage-');
  const events = path.join(tempDir('sdlc-event-stage-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events });
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  for (const args of [['init', '--tools', 'none', '--json'], ['new', 'add-x', '--json']]) {
    const r = cli(args);
    expect(r.code, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
  }
  write(path.join(root, 'openspec/changes/add-x/intent.md'), INTENT);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = [{ server: 'chat', tool: 'report_event', on: ['gate.*', 'verify.*'] }];
  write(file, stringify(config));
  const received = (): Array<Record<string, any>> => (fs.existsSync(events)
    ? read(events).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { root, cli, received };
}

const entry = (event: string) => ({ ts: '2026-11-15T10:00:00.000Z', event, change: 'add-x', sdlc: '0.32.1',
  license: 'community' });

describe('E1 a gate approval names its stage', () => {
  it('approving the intent gate sends gate.intent.approved with gate intent and stage plan', () => {
    const p = project();
    const r = p.cli(['approve', 'intent', '--change', 'add-x', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const approved = p.received().find((call) => call.event?.event === 'gate.intent.approved');
    expect(approved?.event).toMatchObject({ gate: 'intent', stage: 'plan' });
  }, 180000);
});

describe('E2 every gate maps to its stage', () => {
  it.each([
    ['intent', 'plan'], ['spec', 'design'], ['plan', 'build'], ['verify', 'test'], ['qa', 'test'],
    ['review', 'deploy'], ['release', 'deploy'],
  ])('gate %s -> stage %s, for an outcome and a wait', (gate, stage) => {
    const root = tempDir('sdlc-event-stage-unit-');
    for (const outcome of ['approved', 'rejected', 'rework', 'awaiting']) {
      const body = eventBody(root, {}, entry(`gate.${gate}.${outcome}`) as never);
      expect(body, `${gate}.${outcome}`).toMatchObject({ gate, stage });
    }
  });
});

describe('E3 verify events name the test stage', () => {
  it.each(['verify.passed', 'verify.failed'])('%s has stage test and no gate', (event) => {
    const body = eventBody(tempDir('sdlc-event-stage-unit-'), {}, entry(event) as never);
    expect(body.stage).toBe('test');
    expect(body).not.toHaveProperty('gate');
  });
});

describe('E4 negative: other events and unknown gates carry no stage', () => {
  it.each(['change.archived', 'summary.daily', 'gate.unknown.approved', 'hook.denied', 'gate.__proto__.approved',
    'gate.constructor.approved', 'gate.toString.approved'])('%s has no stage', (event) => {
    const body = eventBody(tempDir('sdlc-event-stage-unit-'), {}, entry(event) as never);
    expect(body).not.toHaveProperty('stage');
  });
});

describe('E5 an event queued before the change gets its stage on delivery', () => {
  it('a queue file without stage is delivered with it and is not rewritten with it', () => {
    const p = project();
    // A second receiver whose server cannot start keeps the file in the queue, so the test sees what is left there.
    const file = path.join(p.root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.mcp.servers.down = { type: 'stdio', command: ['node', path.join(p.root, 'missing.mjs')], stages: [] };
    config.events.push({ server: 'down', tool: 'report_event', on: ['gate.*'] });
    write(file, stringify(config));
    const dir = outboxDir(p.root)!;
    fs.mkdirSync(dir, { recursive: true });
    const old = { id: 'old0000000000000000000001', project: 'x', event: 'gate.spec.approved', change: 'add-x',
      gate: 'spec', at: '2026-11-14T10:00:00.000Z', sdlc: '0.32.0' };
    const queued = path.join(dir, `${old.id}.json`);
    fs.writeFileSync(queued, JSON.stringify({ event: old, receivers: ['chat/report_event', 'down/report_event'] }));
    const r = p.cli(['events', 'flush', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const delivered = p.received().find((call) => call.event?.id === old.id);
    expect(delivered?.event).toMatchObject({ event: 'gate.spec.approved', gate: 'spec', stage: 'design' });
    const left = JSON.parse(read(queued));
    expect(left.receivers).toEqual(['down/report_event']);
    expect(left.event).not.toHaveProperty('stage');
  }, 180000);
});
