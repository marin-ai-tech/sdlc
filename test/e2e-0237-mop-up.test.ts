import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { REPO_ROOT, git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E13 mop-up run (2026-10-18), decided by the owner for 0.23.7.
 *
 * finding 1: after every board task was submitted and merged, tasks.md was unticked and `sdlc next` said "4 of 4 tasks left"
 * with no word that the merged tasks only need marking. next names the tasks whose commits (trailers SDLC-Change and
 * SDLC-Task) are already in HEAD.
 * finding 2: on the board host, board events piled up in the shared log uncommitted and `git pull` refused. `sdlc board list`
 * says that the log has uncommitted entries.
 * finding 3: a wait event that could not be sent (an unset variable) stayed queued after the wait ended and would reach the
 * chat out of date. A queued wait for a gate that no longer waits on that digest is dropped when the queue is sent.
 * finding 4: reading commands created openspec/.sdlc/.gitignore in a project that had none, and rewrote one with CRLF line
 * ends, so the working copy changed. They leave tracked files alone; the queue is ignored through .git/info/exclude.
 */

const FAKE = path.join(REPO_ROOT, 'test/fixtures/mcp/fake-server.mjs').replace(/\\/g, '/');
const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const TASKS = ['# Tasks', '', '## 1. Farewell', '', '- [ ] 1.1 Add test/greet.test.js and verify it fails first',
  '- [ ] 1.2 Implement farewell and verify npm test passes', ''].join('\n');

function project(env: NodeJS.ProcessEnv = {}) {
  const root = tempDir('sdlc-0237-');
  const home = humanEnv(tempDir('sdlc-home-'), env);
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[], more: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...home, ...more });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = (rel: string) => path.join(root, rel);
  const commit = (message: string) => {
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
  };
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  commit('sdlc');
  return { root, cli, file, commit, status };
}

type P = ReturnType<typeof project>;

/** A change with an approved plan and open tasks. */
function planned(p: P): void {
  const change = (rel: string) => p.file(path.join('openspec/changes/add-farewell', rel));
  const approve = (gate: string) => expect(p.cli(['approve', gate, '--change', 'add-farewell', '--json']).code).toBe(0);
  expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  approve('intent');
  for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(rel), FILES[rel]);
  approve('spec');
  write(change('plan.md'), FILES['plan.md']);
  write(change('tasks.md'), TASKS);
  p.commit('planning');
  approve('plan');
  p.commit('plan approved');
}

describe('finding 1: next names tasks whose commits are merged', () => {
  it('a task with an SDLC-Task commit in HEAD is named for marking; negative: none without such a commit', () => {
    const p = project();
    planned(p);
    const before = p.cli(['next', '--change', 'add-farewell']);
    expect(before.stdout + before.stderr).not.toMatch(/1\.1[^\n]*tasks\.md|tasks\.md[^\n]*1\.1/);
    write(p.file('test/greet.test.js'), 'export {};\n');
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'Add the greeting test\n\nSDLC-Change: add-farewell\nSDLC-Task: 1.1']);
    const after = p.cli(['next', '--change', 'add-farewell']);
    expect(after.stdout + after.stderr).toMatch(/1\.1/);
    expect(after.stdout + after.stderr).toMatch(/tasks\.md/);
  }, 240000);
});

describe('finding 2: the board host is told to commit the log', () => {
  it('board list mentions uncommitted log entries after a claim; negative: nothing once committed', () => {
    const p = project();
    planned(p);
    write(p.file('openspec/executors.yaml'), stringify({ executors: { 'rep-a': { type: 'representative', max_risk: 'medium' } } }));
    p.commit('registry');
    expect(p.cli(['board', 'claim', '--change', 'add-farewell', '--task', '1.1', '--executor', 'rep-a',
      '--agent', 'bot']).code).toBe(0);
    const dirty = p.cli(['board', 'list']);
    expect(dirty.stdout + dirty.stderr).toMatch(/log\.jsonl/);
    p.commit('board log');
    const clean = p.cli(['board', 'list']);
    expect(clean.stdout + clean.stderr).not.toMatch(/log\.jsonl/);
  }, 240000);
});

describe('finding 3: a wait that ended is not sent late', () => {
  it('the queued awaiting event is dropped once the gate is approved; the approval is sent', () => {
    const sink = path.join(tempDir('sdlc-0237-sink-'), 'events.jsonl');
    const p = project({ FAKE_EVENTS_FILE: sink });
    const configFile = p.file('openspec/sdlc.yaml');
    const config = parse(read(configFile));
    config.mcp = { servers: { chat: { type: 'stdio', command: ['node', FAKE], stages: [], agents: false } } };
    config.events = [{ server: 'chat', tool: 'report_event', on: ['gate.*'], args: { chat_id: '${CHAT_0237}' },
      message: 'text' }];
    write(configFile, stringify(config));
    p.commit('events');
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/add-x/intent.md'), INTENT);
    expect(p.cli(['next', '--change', 'add-x']).code).toBe(0);
    expect(p.cli(['approve', 'intent', '--change', 'add-x', '--json']).code).toBe(0);
    expect(p.cli(['events', 'flush'], { CHAT_0237: '-100' }).code).toBe(0);
    const texts = (fs.existsSync(sink) ? read(sink).trim().split('\n').filter(Boolean) : []).map((l) => String(JSON.parse(l).text));
    expect(texts.some((t) => /approved/i.test(t))).toBe(true);
    expect(texts.some((t) => /wait/i.test(t))).toBe(false);
  }, 240000);
});

describe('finding 4: reading commands leave tracked files alone', () => {
  it('without openspec/.sdlc/.gitignore a wait is queued, the queue is ignored and git status stays clean', () => {
    const p = project();
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/add-x/intent.md'), INTENT);
    p.commit('change');
    fs.rmSync(p.file('openspec/.sdlc/.gitignore'), { force: true });
    p.commit('a project from before the queue');
    expect(p.cli(['status']).code).toBe(0);
    expect(p.cli(['next', '--change', 'add-x']).code).toBe(0);
    expect(p.status()).toBe('');
    expect(fs.existsSync(p.file('openspec/.sdlc/hook-log.jsonl'))).toBe(true);
  }, 240000);

  it('a CRLF .gitignore that has the lines is not rewritten by reading commands', () => {
    const p = project();
    git(p.root, ['config', 'core.autocrlf', 'false']);
    const ignore = p.file('openspec/.sdlc/.gitignore');
    const lines = read(ignore).split(/\r?\n/).filter(Boolean);
    fs.writeFileSync(ignore, `${lines.join('\r\n')}\r\n`);
    p.commit('crlf ignore');
    const bytes = fs.readFileSync(ignore);
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/add-x/intent.md'), INTENT);
    p.commit('change');
    for (const args of [['status'], ['next', '--change', 'add-x'], ['board', 'list'], ['health']]) p.cli(args);
    expect(fs.readFileSync(ignore).equals(bytes)).toBe(true);
  }, 240000);
});
