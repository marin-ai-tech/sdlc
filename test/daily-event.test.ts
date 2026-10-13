import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B99: the team gets the daily summary and alerts in its chat, through the event sink (no chat API in sdlc: a
 * Telegram MCP server is a receiver like any other).
 * - `sdlc events summary [--since <date>] [--json]` records the event `summary.daily` (`summary`: counts of changes
 *   done, active, waiting for people and blocked, and the waiting changes) and delivers it to the receivers whose
 *   `on` matches; a receiver with `message` gets a short text that names the project and the waiting changes.
 *   One summary per project and day: a second run the same day sends nothing new.
 * - `sdlc triage intake [--json]` reads one alert as JSON from stdin (`{ id, title, severity?, url? }`) and adds a
 *   backlog item with `Source: alert:<id>`; the same alert again adds nothing (`duplicate: true`). An alert without
 *   an id or a title is refused with `invalid_alert` and adds nothing.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');

interface Received {
  event?: { id: string; event: string; summary?: Record<string, unknown> };
  text?: string;
}

function project(receivers: Record<string, unknown>[]) {
  const root = tempDir('sdlc-daily-');
  const events = path.join(tempDir('sdlc-daily-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events });
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], input?: string) => runCli(args, root, env, input);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.project = { name: 'claims' };
  config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = receivers;
  write(file, stringify(config));
  expect(cli(['new', 'add-export', '--json']).code).toBe(0);
  const received = (): Received[] => (fs.existsSync(events)
    ? read(events).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line) as Received)
    : []);
  return { root, cli, received };
}

describe('B99: the daily summary as an event', () => {
  it('sends summary.daily once a day to the matching receiver, with the counts', () => {
    const p = project([{ server: 'chat', tool: 'report_event', on: ['summary.*'] }]);
    const r = p.cli(['events', 'summary', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const sent = p.received().filter((item) => item.event?.event === 'summary.daily');
    expect(sent).toHaveLength(1);
    expect(sent[0].event?.summary).toMatchObject({ active: 1 });
    expect(p.cli(['events', 'summary', '--json']).code).toBe(0);
    expect(p.received().filter((item) => item.event?.event === 'summary.daily')).toHaveLength(1);
  }, 240000);

  it('a message receiver gets a text naming the project and the waiting change', () => {
    const p = project([{ server: 'chat', tool: 'report_event', on: ['summary.daily'], message: 'text' }]);
    expect(p.cli(['events', 'summary', '--json']).code).toBe(0);
    const texts = p.received().map((item) => item.text).filter(Boolean);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('claims');
    expect(texts[0]).toContain('add-export');
  }, 240000);

  it('negative: a receiver for gate events only does not get the summary', () => {
    const p = project([{ server: 'chat', tool: 'report_event', on: ['gate.*'] }]);
    expect(p.cli(['events', 'summary', '--json']).code).toBe(0);
    expect(p.received().filter((item) => item.event?.event === 'summary.daily')).toEqual([]);
  }, 240000);
});

describe('B99: alert intake for triage', () => {
  const ALERT = JSON.stringify({ id: 'PD-1', title: 'Checkout answers 500', severity: 'high' });

  it('adds one backlog item per alert; the same alert again adds nothing', () => {
    const p = project([]);
    const r = p.cli(['triage', 'intake', '--json'], ALERT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json()).toMatchObject({ duplicate: false, item: { id: 'B1' } });
    const items = p.cli(['backlog', 'list', '--json']).json().items;
    expect(items).toHaveLength(1);
    expect(items[0].title).toContain('Checkout answers 500');
    expect(JSON.stringify(items[0])).toContain('PD-1');
    expect(read(path.join(p.root, 'openspec/backlog.md'))).toMatch(/alert.*PD-1/);
    const again = p.cli(['triage', 'intake', '--json'], ALERT);
    expect(again.code).toBe(0);
    expect(again.json()).toMatchObject({ duplicate: true });
    expect(p.cli(['backlog', 'list', '--json']).json().items).toHaveLength(1);
  }, 240000);

  it('negative: an alert without an id or a title, or not JSON, is refused and adds nothing', () => {
    const p = project([]);
    for (const input of [JSON.stringify({ title: 'no id' }), JSON.stringify({ id: 'PD-2' }), 'not json']) {
      const r = p.cli(['triage', 'intake', '--json'], input);
      expect(r.code, input).not.toBe(0);
      expect(r.json().status[0].code).toBe('invalid_alert');
    }
    expect(p.cli(['backlog', 'list', '--json']).json().items ?? []).toEqual([]);
  }, 240000);
});
