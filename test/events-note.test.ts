import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B112 (0.16.1): a receiver may opt in to the note of a rejection or a rework: `include_note: true` (default off,
 * so the chat still learns why a gate went back only when the team chose it). The note is one line, cut to about
 * 200 characters, with secrets masked. The event object gets `note`; a ready message gets the note after the text.
 * A receiver without `include_note` gets exactly what it got before (no note anywhere).
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const ROLES = ['version: 1', 'signing: off', 'people:',
  '  alice: { name: Alice Ivanova, emails: [alice@corp.example] }', 'roles:', '  product-owner: [alice]', '  engineer: [alice]', '  code-owner: [alice]', '  maintainer: [alice]', '',
].join('\n');
const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');
const TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

function project(receivers: Array<Record<string, unknown>>) {
  const root = tempDir('sdlc-events-note-');
  const events = path.join(tempDir('sdlc-events-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: events });
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  // The change first: a receiver with an invalid configuration must not stop the setup itself.
  expect(cli(['new', 'add-x', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/add-x/intent.md'), INTENT);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(file));
  config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [] } } };
  config.events = receivers.map((receiver) => ({ server: 'chat', tool: 'report_event', on: ['gate.*'], ...receiver }));
  write(file, stringify(config));
  const received = (): Array<Record<string, any>> => (fs.existsSync(events)
    ? read(events).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  return { cli, received };
}

describe('B112: the note of a rejection or a rework, for receivers that opt in', () => {
  it('a ready message carries the note: one line, cut, the secret masked', () => {
    const p = project([{ args: { chat_id: '1' }, message: 'text', include_note: true }]);
    const note = `Affected users are missing; token ${TOKEN} was pasted by mistake. ` + 'More detail. '.repeat(40);
    const r = p.cli(['reject', 'intent', '--change', 'add-x', '--note', note, '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const rejected = p.received().map((call) => String(call.text)).find((text) => /reject/i.test(text)) ?? '';
    expect(rejected).toContain('Affected users are missing');
    expect(rejected).not.toContain(TOKEN);
    expect(rejected).not.toContain('\n');
    expect(rejected.length).toBeLessThan(400);
  }, 180000);

  it('an event object carries note after a rework; a receiver without include_note gets no note', () => {
    const p = project([{ include_note: true }, { tool: 'report_event', args: { plain: true } }]);
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    const r = p.cli(['rework', 'intent', '--change', 'add-x', '--reason', 'missing-requirement',
      '--note', 'Who are the users?', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const rework = p.received().filter((call) => call.event?.event === 'gate.intent.rework');
    const withNote = rework.find((call) => call.plain !== true);
    const without = rework.find((call) => call.plain === true);
    expect(String(withNote?.event?.note)).toContain('Who are the users?');
    expect(without).toBeDefined();
    expect(without?.event?.note).toBeUndefined();
    expect(JSON.stringify(without)).not.toContain('Who are the users?');
  }, 180000);

  it('negative: by default a ready message has no note', () => {
    const p = project([{ args: { chat_id: '1' }, message: 'text' }]);
    expect(p.cli(['reject', 'intent', '--change', 'add-x', '--note', 'Secret plans inside', '--json']).code).toBe(0);
    expect(JSON.stringify(p.received())).not.toContain('Secret plans inside');
  }, 180000);

  it('negative: include_note must be true or false', () => {
    const p = project([{ include_note: 'yes' }]);
    const r = p.cli(['status', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 180000);
});
