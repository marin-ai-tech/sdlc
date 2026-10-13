import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B98: events across clones.
 * - A wait is one fact, wherever it is seen: `gate.<g>.awaiting` and `gate.<g>.overdue` get an id from the project,
 *   the change, the gate and the digest the gate waits on — not from the time — so two clones (or CI) announcing the
 *   same wait send events with the same id and a receiver keeps one. Different facts keep different ids.
 * - Chat handles: a person in openspec/roles.yaml may list `chat: { <channel>: <handle> }`. A receiver with
 *   `chat: <channel>` gets `waitingForChat` (the handles of the people in `waitingFor` on that channel) and its message
 *   mentions them. A receiver without `chat` never gets chat handles.
 * - CI flush: the CI configuration from `sdlc ci init` runs `sdlc events flush`, so waits seen in CI are delivered.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice:',
  '    name: Alice Ivanova',
  '    emails: [alice@corp.example]',
  '    chat: { telegram: "@alice_tg", slack: U0ALICE }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]', '',
].join('\n');
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

interface Received {
  event: { id: string; event: string; change?: string; gate?: string; waitingFor?: string[];
    waitingForChat?: string[] };
  text?: string;
}

/** A project with a sink and a change waiting for the intent gate, committed so that it can be cloned. */
function origin(receivers: Record<string, unknown>[], name: string | null = 'claims') {
  const root = tempDir('sdlc-events-origin-');
  const events = path.join(tempDir('sdlc-events-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events });
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const run = (cwd: string, args: string[]) => runCli(args, cwd, env);
  expect(run(root, ['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  if (name) config.project = { name };
  config.mcp = { servers: { central: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = receivers;
  write(file, stringify(config));
  expect(run(root, ['new', 'add-x', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-x/intent.md'), INTENT);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'a change waits for intent']);
  const received = (): Received[] => (fs.existsSync(events)
    ? read(events).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Received)
    : []);
  const clone = (folder: string) => {
    const dir = path.join(tempDir(`sdlc-events-${folder}-`), folder);
    git(path.dirname(dir), ['clone', '-q', root, dir]);
    git(dir, ['config', 'user.name', 'Alice Ivanova']);
    git(dir, ['config', 'user.email', 'alice@corp.example']);
    return dir;
  };
  return { root, run, received, clone };
}

const SINK = { server: 'central', tool: 'report_event', on: ['gate.*'] };

describe('B98: one wait, one id, from any clone', () => {
  it('two clones announcing the same wait send the same event id; another fact has another id', () => {
    const o = origin([SINK]);
    const first = o.clone('claims-a');
    const second = o.clone('claims-b');
    expect(o.run(first, ['next', '--change', 'add-x', '--json']).code).toBe(0);
    expect(o.run(second, ['next', '--change', 'add-x', '--json']).code).toBe(0);
    const waits = o.received().filter((r) => r.event.event === 'gate.intent.awaiting');
    expect(waits).toHaveLength(2);
    expect(new Set(waits.map((r) => r.event.id)).size).toBe(1);
    expect(o.run(first, ['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    const approved = o.received().find((r) => r.event.event === 'gate.intent.approved');
    expect(approved?.event.id).toBeTruthy();
    expect(approved?.event.id).not.toBe(waits[0].event.id);
  }, 300000);

  it('the same id also without project.name, from clones in folders with different names', () => {
    const o = origin([SINK], null);
    const laptop = o.clone('claims-laptop');
    const ci = o.clone('build-1234');
    expect(o.run(laptop, ['next', '--change', 'add-x', '--json']).code).toBe(0);
    expect(o.run(ci, ['next', '--change', 'add-x', '--json']).code).toBe(0);
    const waits = o.received().filter((r) => r.event.event === 'gate.intent.awaiting');
    expect(waits).toHaveLength(2);
    expect(new Set(waits.map((r) => r.event.id)).size).toBe(1);
  }, 300000);
});

describe('B98: chat handles', () => {
  it('a receiver with chat: telegram gets the telegram handles; one without chat gets none', () => {
    const chat = { server: 'central', tool: 'report_event', on: ['gate.*'], chat: 'telegram', message: 'text' };
    const o = origin([chat]);
    expect(o.run(o.root, ['next', '--change', 'add-x', '--json']).code).toBe(0);
    const wait = o.received().find((r) => r.event?.event === 'gate.intent.awaiting' || r.text !== undefined);
    expect(wait, JSON.stringify(o.received())).toBeTruthy();
    expect(JSON.stringify(wait)).toContain('@alice_tg');
    expect(JSON.stringify(wait)).not.toContain('U0ALICE');
    const plain = origin([SINK]);
    expect(plain.run(plain.root, ['next', '--change', 'add-x', '--json']).code).toBe(0);
    const plainWait = plain.received().find((r) => r.event.event === 'gate.intent.awaiting');
    expect(plainWait?.event.waitingFor).toEqual(['alice']);
    expect(plainWait?.event.waitingForChat).toBeUndefined();
    expect(JSON.stringify(plain.received())).not.toContain('alice_tg');
  }, 300000);

  it('negative: a chat handle that is not a string is an invalid roles.yaml', () => {
    const o = origin([SINK]);
    write(path.join(o.root, 'openspec/roles.yaml'), ROLES.replace('slack: U0ALICE', 'slack: [1, 2]'));
    const r = o.run(o.root, ['roles', 'check', '--json']);
    expect(r.code).not.toBe(0);
  }, 240000);
});

describe('B98: CI flushes the events', () => {
  it('sdlc ci init writes a step that runs sdlc events flush', () => {
    const o = origin([SINK]);
    expect(o.run(o.root, ['ci', 'init', '--provider', 'github', '--json']).code).toBe(0);
    expect(read(path.join(o.root, '.github/workflows/sdlc.yml'))).toContain('sdlc events flush');
    expect(o.run(o.root, ['ci', 'init', '--provider', 'gitlab', '--json']).code).toBe(0);
    expect(read(path.join(o.root, '.gitlab/sdlc.yml'))).toContain('sdlc events flush');
  }, 240000);
});
