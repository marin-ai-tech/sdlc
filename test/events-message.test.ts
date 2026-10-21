import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.15.0: a receiver may ask for a ready one-line message instead of the structured event: `message: <argument>`
 * (e.g. `message: text` for a Telegram server's `send_message(chat_id, text)`). sdlc then calls the tool with the
 * static `args` and that argument set to the text, and without `event` — a plain send-message tool rejects unknown
 * arguments. The text names the project, the change, the gate and people by their names from roles.yaml, in the
 * project's locale; never an email, a note, a command or its output. A receiver without `message` gets the event
 * object as before.
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

function project(receiver: Record<string, unknown>) {
  const root = tempDir('sdlc-events-message-');
  const events = path.join(tempDir('sdlc-events-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events });
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.project = { name: 'claims' };
  config.mcp = { servers: { telegram: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = [{ server: 'telegram', tool: 'report_event', on: ['gate.*'], ...receiver }];
  write(file, stringify(config));
  const started = cli(['new', 'add-x', '--json']);
  write(path.join(root, 'openspec/changes/add-x/intent.md'), INTENT);
  const received = (): Array<Record<string, unknown>> => (fs.existsSync(events)
    ? read(events).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { cli, received, started };
}

describe('events as a ready message', () => {
  it('an approval and a waiting gate arrive as one line of text in the named argument, with the static args', () => {
    const p = project({ args: { chat_id: '-100123' }, message: 'text' });
    expect(p.started.code).toBe(0);
    expect(p.cli(['next', '--change', 'add-x', '--json']).code).toBe(0);
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    const calls = p.received();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const call of calls) {
      expect(call.chat_id).toBe('-100123');
      expect(typeof call.text).toBe('string');
      expect(call.event).toBeUndefined();
      expect(String(call.text)).not.toContain('\n');
      expect(JSON.stringify(call)).not.toContain('alice@corp.example');
    }
    const waiting = calls.find((call) => /wait/i.test(String(call.text)));
    expect(String(waiting?.text)).toMatch(/claims/);
    expect(String(waiting?.text)).toMatch(/add-x/);
    expect(String(waiting?.text)).toMatch(/intent/);
    expect(String(waiting?.text)).toContain('Alice Ivanova');
    const approved = calls.find((call) => /approved/i.test(String(call.text)));
    expect(String(approved?.text)).toContain('Alice Ivanova');
  }, 180000);


  it('negative: a receiver without message still gets the event object', () => {
    const p = project({ args: { project: 'claims' } });
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    const isApproval = (c: Record<string, unknown>) =>
      (c.event as { event?: string } | undefined)?.event === 'gate.intent.approved';
    const call = p.received().find(isApproval);
    expect(call?.event).toBeDefined();
    expect(call?.text).toBeUndefined();
  }, 180000);

  it('negative: a message argument that is not a plain name is a configuration error', () => {
    const p = project({ message: 'text; rm -rf' });
    expect(p.started.code).toBe(1);
    expect(p.started.json().status[0].code).toBe('invalid_config');
  }, 180000);
});
