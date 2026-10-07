import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B45: sdlc reports process events to an MCP server. After a command writes an event to the log, sdlc calls the
 * configured tool with `{ event: { id, project, event, change?, gate?, at, sdlc, by?, waitingFor? }, ...args }`
 * (5 s timeout); an undelivered event waits in `.git/sdlc/outbox/` and goes with the next command or
 * `sdlc events flush`. A command never fails or waits longer because of delivery. No command text, output or email.
 * B54: an awaiting event names who may take the gate (`waitingFor`, person ids from roles.yaml).
 * B55: a gate waiting longer than `gates.<g>.overdue_hours` raises `gate.<g>.overdue` once.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const ROLES = [
  'version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }',
  'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]', '',
].join('\n');
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function execGit(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf-8' });
}

interface Received {
  event: { id: string; project: string; event: string; change?: string; gate?: string; at: string; sdlc: string;
    by?: string; waitingFor?: string[] };
  project?: string;
}

function project(options: { overdueHours?: number } = {}) {
  const root = tempDir('sdlc-events-');
  const events = path.join(tempDir('sdlc-events-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events });
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.project = { name: 'claims' };
  config.mcp = { servers: { central: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = [{ server: 'central', tool: 'report_event', on: ['gate.*', 'verify.*'], args: { project: 'claims' } }];
  if (options.overdueHours !== undefined) config.gates.intent.overdue_hours = options.overdueHours;
  write(file, stringify(config));
  expect(cli(['new', 'add-x', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-x/intent.md'), INTENT);
  const received = (): Received[] => (fs.existsSync(events) ? read(events).trim().split('\n').filter(Boolean)
    .map((line) => JSON.parse(line) as Received) : []);
  const named = (name: string) => received().filter((r) => r.event.event === name);
  return { root, cli, received, named };
}

describe('the event sink', () => {
  it('sends an approval to the configured tool, with the fixed shape and the static args', () => {
    const p = project();
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    const approved = p.named('gate.intent.approved');
    expect(approved).toHaveLength(1);
    expect(approved[0].project).toBe('claims');
    expect(approved[0].event).toMatchObject({ project: 'claims', change: 'add-x', gate: 'intent', by: 'alice' });
    expect(approved[0].event.id).toBeTruthy();
    expect(JSON.stringify(approved[0])).not.toContain('alice@corp.example');
  }, 180000);

  it('an awaiting gate names who may take it (B54)', () => {
    const p = project();
    expect(p.cli(['next', '--change', 'add-x', '--json']).code).toBe(0);
    const awaiting = p.named('gate.intent.awaiting');
    expect(awaiting).toHaveLength(1);
    expect(awaiting[0].event.waitingFor).toEqual(['alice']);
  }, 180000);

  it('keeps an event while the server is down and delivers it once with flush; the command does not fail', () => {
    const p = project();
    const started = Date.now();
    const down = p.cli(['approve', 'intent', '--change', 'add-x', '--json'], { FAKE_EXIT: '1' });
    expect(down.code).toBe(0);
    expect(Date.now() - started).toBeLessThan(30000);
    expect(p.named('gate.intent.approved')).toHaveLength(0);
    const pending = p.cli(['events', 'list', '--json']).json();
    expect(pending.pending.map((e: { event: string }) => e.event)).toContain('gate.intent.approved');
    expect(p.cli(['events', 'flush', '--json']).code).toBe(0);
    expect(p.cli(['events', 'flush', '--json']).code).toBe(0);
    expect(p.named('gate.intent.approved')).toHaveLength(1);
    expect(p.cli(['events', 'list', '--json']).json().pending).toEqual([]);
    // The queue lives in .git, so it never reaches a commit.
    expect(fs.existsSync(path.join(p.root, '.git/sdlc/outbox'))).toBe(true);
    git(p.root, ['add', '-A']);
    expect(execGit(p.root, ['diff', '--cached', '--name-only'])).not.toContain('outbox');
  }, 180000);

  it('negative: events outside `on`, hook decisions and command output are not sent', () => {
    const p = project();
    write(path.join(p.root, 'openspec/changes/add-x/tasks.md'), '# Tasks\n\n- [x] 1.1 done\n');
    expect(p.cli(['backlog', 'add', 'Something', '--json']).code).toBe(0);
    const hook = JSON.stringify({ cwd: p.root, tool_name: 'Edit', tool_input: { file_path: path.join(p.root, 'openspec/roles.yaml') } });
    runCli(['hook', 'pre-tool'], p.root, humanEnv(tempDir('sdlc-home-')), hook);
    const names = p.received().map((r) => r.event.event);
    expect(names.filter((n) => n.startsWith('backlog.') || n.startsWith('hook.'))).toEqual([]);
  }, 180000);
});

describe('overdue gates (B55)', () => {
  it('a gate waiting longer than its threshold raises one overdue event', async () => {
    const p = project({ overdueHours: 0.0005 });
    expect(p.cli(['next', '--change', 'add-x', '--json']).code).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 2500));
    expect(p.cli(['status', '--json']).code).toBe(0);
    expect(p.cli(['status', '--json']).code).toBe(0);
    const overdue = p.named('gate.intent.overdue');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].event.waitingFor).toEqual(['alice']);
  }, 180000);

  it('negative: without overdue_hours nothing is ever overdue', async () => {
    const p = project();
    expect(p.cli(['next', '--change', 'add-x', '--json']).code).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(p.cli(['status', '--json']).code).toBe(0);
    expect(p.named('gate.intent.overdue')).toHaveLength(0);
  }, 180000);
});
