import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E10 team run (MCP and integrations, 2026-10-18), decided by the owner for 0.23.4.
 *
 * finding 1: the settings check let unknown keys through: a receiver with `events:` instead of `on:` silently got the
 * default patterns, a server had an invented `role`, and a context source without `server` failed only at
 * `sdlc context pull`. A proposal with such content is refused naming the key; doctor names unknown keys of a file
 * already in place, and the commands keep working.
 * finding 2: an agent's shell turned `${HEAD}` and `${CHAT_ID}` into empty strings in `--set`; `config show` warns about empty
 * values in `args`, `headers` and `env`, and the workflow says to single-quote `${…}`.
 * finding 3: the root artifact hint fired on the project's REVIEW.md (case-insensitive file systems) and was not translated.
 * finding 4: another language messages wrote "`MCP`" as code instead of the plain name.
 * finding 5: `${VAR}` in a receiver's `args` was sent literally; it is expanded from the environment when the event is sent.
 * finding 6: without `project.name` events named the clone's folder; the package.json name comes first.
 * finding 7: a secret in a person's note went verbatim into the shared log and the change record; it is masked.
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
const TOKEN = `ghp_${'A1b2C3d4E5'.repeat(3)}abcdef`;

function project(options: { receiver?: Record<string, unknown>; env?: NodeJS.ProcessEnv; pkg?: string } = {}) {
  const root = tempDir('sdlc-0234-');
  const sink = path.join(tempDir('sdlc-0234-sink-'), 'events.jsonl');
  const env = humanEnv(tempDir('sdlc-home-'), { FAKE_EVENTS_FILE: sink, ...options.env });
  initGitRepo(root);
  git(root, ['config', 'user.name', 'Alice Ivanova']);
  git(root, ['config', 'user.email', 'alice@corp.example']);
  if (options.pkg) write(path.join(root, 'package.json'), JSON.stringify({ name: options.pkg, version: '1.0.0' }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'claude', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/roles.yaml'), ROLES);
  const configFile = path.join(root, 'openspec/sdlc.yaml');
  const config = parse(read(configFile));
  config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [], agents: false } } };
  if (options.receiver) config.events = [{ server: 'chat', tool: 'report_event', on: ['gate.*'], ...options.receiver }];
  write(configFile, stringify(config));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const file = (rel: string) => path.join(root, rel);
  const received = (): Array<Record<string, unknown>> => (fs.existsSync(sink)
    ? read(sink).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
  const atIntentGate = () => {
    expect(cli(['new', 'add-x', '--json']).code).toBe(0);
    write(file('openspec/changes/add-x/intent.md'), INTENT);
  };
  return { root, cli, file, received, atIntentGate, configFile };
}

type P = ReturnType<typeof project>;

/** A proposal file: the current sdlc.yaml with `edit` applied. */
function proposalFile(p: P, edit: (config: Record<string, any>) => void): string {
  const config = parse(read(p.configFile));
  edit(config);
  const out = path.join(tempDir('sdlc-0234-proposal-'), 'sdlc.yaml');
  write(out, stringify(config));
  return out;
}

describe('finding 1: unknown keys and incomplete entries are named', () => {
  it('a proposal with events: instead of on:, a server role or a source without server is refused naming the key', () => {
    const p = project();
    const cases: Array<[string, (c: Record<string, any>) => void, RegExp]> = [
      ['events', (c) => { c.events = [{ server: 'chat', tool: 'report_event', events: ['gate.*'] }]; }, /events\[0\]\.events/],
      ['role', (c) => { c.mcp.servers.chat.role = 'chat'; }, /mcp\.servers\.chat\.role/],
      ['server', (c) => { c.context = { sources: [{ name: 'faq', tool: 'search_docs', stages: ['build'] }] }; },
        /context\.sources\[0\]\.server/],
    ];
    for (const [label, edit, key] of cases) {
      const r = p.cli(['config', 'propose', '--file', proposalFile(p, edit), '--reason', label]);
      expect(r.code, label).not.toBe(0);
      expect(r.stdout + r.stderr, label).toMatch(key);
    }
  }, 240000);

  it('a file already in place with an unknown receiver key: doctor names it, and events list still works', () => {
    const p = project({ receiver: { on: ['gate.*'] } });
    const config = parse(read(p.configFile));
    config.events[0].events = ['summary.daily'];
    write(p.configFile, stringify(config));
    const doctor = p.cli(['doctor']);
    expect(doctor.stdout + doctor.stderr).toMatch(/events\[0\]\.events/);
    expect(p.cli(['events', 'list']).code).toBe(0);
  }, 240000);
});

describe('finding 2: empty values that a shell left behind', () => {
  it('config show warns about an empty args value; the workflow says to single-quote ${…}', () => {
    const p = project({ receiver: { on: ['gate.*'] } });
    const file = proposalFile(p, (c) => { c.events[0].args = { chat_id: '' }; });
    const r = p.cli(['config', 'propose', '--file', file, '--reason', 'R', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const show = p.cli(['config', 'show', r.json<{ id: string }>().id, '--json']).json<{ warnings: string[] }>();
    expect(show.warnings.join('\n')).toMatch(/chat_id/);
    expect(show.warnings.join('\n')).toMatch(/empty/i);
    expect(read(p.file('.claude/skills/sdlc-config/SKILL.md'))).toMatch(/single quotes?/i);
  }, 240000);
});



describe('finding 5 and finding 6: what a receiver gets', () => {
  it('${VAR} in args is expanded from the environment; the project is named from package.json', () => {
    const p = project({ receiver: { args: { chat_id: '${CHAT_ID}' }, message: 'text' }, env: { CHAT_ID: '-100777' },
      pkg: 'todo-app' });
    p.atIntentGate();
    expect(p.cli(['next', '--change', 'add-x']).code).toBe(0);
    const calls = p.received();
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.chat_id).toBe('-100777');
    expect(String(calls[0].text)).toMatch(/todo-app/);
    expect(String(calls[0].text)).not.toMatch(new RegExp(path.basename(p.root)));
  }, 240000);

  it('negative: an unset variable is not sent literally; the event waits and names the variable', () => {
    const p = project({ receiver: { args: { chat_id: '${CHAT_ID_UNSET}' }, message: 'text' } });
    p.atIntentGate();
    expect(p.cli(['next', '--change', 'add-x']).code).toBe(0);
    expect(JSON.stringify(p.received())).not.toContain('${CHAT_ID_UNSET}');
    const list = p.cli(['events', 'list']);
    expect(list.stdout + list.stderr).toMatch(/CHAT_ID_UNSET/);
  }, 240000);
});

describe('finding 7: a secret in a person\'s note', () => {
  it('reject --note with a token: the log and the change record keep the note without the token', () => {
    const p = project();
    p.atIntentGate();
    const r = p.cli(['reject', 'intent', '--change', 'add-x', '--note', `Wrong scope; token ${TOKEN} must not be here`]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    for (const rel of ['openspec/.sdlc/log.jsonl', 'openspec/changes/add-x/.sdlc.yaml']) {
      const text = read(p.file(rel));
      expect(text, rel).not.toContain(TOKEN);
      expect(text, rel).toMatch(/Wrong scope/);
    }
  }, 240000);
  it('REVIEW.md is not review.md; a real intent.md at the root is hinted, in English', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('REVIEW.md'), '# Review policy\n');
    const quiet = p.cli(['next', '--change', 'add-x']);
    expect(quiet.stdout + quiet.stderr).not.toMatch(/review\.md/i);
    write(p.file('intent.md'), INTENT);
    fs.rmSync(p.file('openspec/changes/add-x/intent.md'), { force: true });
    const hinted = p.cli(['next', '--change', 'add-x']);
    expect(hinted.stdout + hinted.stderr).toMatch(/openspec\/changes\/add-x\/intent\.md/);
  }, 240000);
});
