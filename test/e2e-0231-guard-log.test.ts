import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E6 (bug fix from an alert) and E12 (CI, release, upgrade) team runs of 2026-10-17, decided by the
 * owner for 0.23.1, part A: the guard, the log, validation in CI and the license command.
 *
 * finding 2: Qwen's read tools (`grep_search`, `read_many_files`, `list_directory`) with a path counted as edits, so the plan
 * gate and a takeover denied an agent's search; the denials guide promises that reads still work.
 * finding 4: hook decisions were appended to the tracked `openspec/.sdlc/log.jsonl`: after an agent run with denials the working
 * copy was dirty, `git pull` refused and the agent went on with a stale copy. Decisions now go to an untracked
 * `openspec/.sdlc/hook-log.jsonl` and move into the shared log with the next CLI command that writes the log; `sdlc log`
 * and `sdlc health` read both.
 * finding 3: `sdlc validate --all`, the CI step, failed with "No delta specs" on every change before its spec stage and on
 * lite or docs changes that need no spec: the CI from `sdlc ci init` was red in ordinary work.
 * finding 6: `sdlc license set` rewrote `openspec/sdlc.yaml` and added defaults nobody asked for (`gates.qa.approvers`).
 */

interface HookOut {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
}

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.',
  '', '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project() {
  const root = tempDir('sdlc-0231-guard-log-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'src/app.js'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const init = cli(['init', '--tools', 'qwen', '--mode', 'block', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const hook = (name: string, input: Record<string, unknown>): HookOut => {
    const payload = { session_id: 's1', cwd: root, hook_event_name: 'PreToolUse', tool_name: name, tool_input: input };
    const r = cli(['hook', 'pre-tool', '--agent', 'qwen'], { QWEN_CODE: '1' }, JSON.stringify(payload));
    return r.stdout.trim() ? JSON.parse(r.stdout) as HookOut : {};
  };
  const decision = (out: HookOut) => out.hookSpecificOutput?.permissionDecision ?? 'allow';
  const file = (rel: string) => path.join(root, rel);
  const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim();
  const logText = () => read(file('openspec/.sdlc/log.jsonl'));
  return { root, cli, hook, decision, file, status, logText };
}

type P = ReturnType<typeof project>;

describe('finding 2: Qwen read tools are reads', () => {
  function atPlanGate(p: P) {
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/add-x/intent.md'), INTENT);
  }

  it('before the plan is approved, grep_search, read_many_files and list_directory with a path are allowed', () => {
    const p = project();
    atPlanGate(p);
    expect(p.decision(p.hook('grep_search', { pattern: 'x', path: p.file('src') }))).toBe('allow');
    expect(p.decision(p.hook('grep_search', { pattern: 'x', path: p.file('src/app.js') }))).toBe('allow');
    expect(p.decision(p.hook('read_many_files', { paths: [p.file('src/app.js')] }))).toBe('allow');
    expect(p.decision(p.hook('list_directory', { path: p.file('src') }))).toBe('allow');
  }, 240000);

  it('during a takeover a search is allowed and an edit is denied', () => {
    const p = project();
    atPlanGate(p);
    expect(p.cli(['takeover', '--change', 'add-x', '--note', 'mine']).code).toBe(0);
    expect(p.decision(p.hook('grep_search', { pattern: 'x', path: p.file('openspec/changes/add-x') }))).toBe('allow');
    expect(p.decision(p.hook('write_file', { file_path: p.file('openspec/changes/add-x/intent.md'), content: 'x' })))
      .toBe('deny');
  }, 240000);

  it('negative: before the plan is approved, write_file and replace on code are still denied', () => {
    const p = project();
    atPlanGate(p);
    expect(p.decision(p.hook('write_file', { file_path: p.file('src/app.js'), content: 'y' }))).toBe('deny');
    expect(p.decision(p.hook('replace', { file_path: p.file('src/app.js'), old_string: 'x', new_string: 'y' })))
      .toBe('deny');
  }, 240000);
});

describe('finding 4: hook decisions do not dirty the working copy', () => {
  function denyFiveTimes(p: P) {
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'change']);
    for (let index = 0; index < 5; index += 1) {
      expect(p.decision(p.hook('write_file', { file_path: p.file('src/app.js'), content: `y${index}` }))).toBe('deny');
    }
  }

  it('denials go to an ignored hook-log; git status stays clean; log and health see them', () => {
    const p = project();
    denyFiveTimes(p);
    expect(p.status()).toBe('');
    expect(p.logText()).not.toContain('hook.denied');
    const queue = p.file('openspec/.sdlc/hook-log.jsonl');
    expect(read(queue).match(/hook\.denied/g)?.length).toBe(5);
    expect(execFileSync('git', ['check-ignore', '-q', queue], { cwd: p.root }).length).toBe(0);
    const log = p.cli(['log', '--json']).json<{ entries: Array<{ event: string }> }>();
    expect(log.entries.filter((e) => e.event === 'hook.denied').length).toBe(5);
    const health = p.cli(['health', '--json']).json<{ findings: Array<{ id: string }> }>();
    expect(health.findings.map((f) => f.id)).toContain('discipline.denials');
  }, 300000);

  it('the next CLI command that writes the log moves the queued decisions into it, in order', () => {
    const p = project();
    denyFiveTimes(p);
    expect(p.cli(['new', 'add-y', '--json']).code).toBe(0);
    const events = p.logText().trim().split('\n').map((line) => JSON.parse(line).event as string);
    const firstCreated = events.lastIndexOf('change.created');
    expect(events.filter((e) => e === 'hook.denied').length).toBe(5);
    expect(events.lastIndexOf('hook.denied')).toBeLessThan(firstCreated);
    const queue = p.file('openspec/.sdlc/hook-log.jsonl');
    expect(fs.existsSync(queue) ? read(queue).trim() : '').toBe('');
  }, 300000);
});

describe('finding 3: validate --all in CI', () => {
  it('a new change before its spec stage and a lite docs change pass; nothing says "No delta specs"', () => {
    const p = project();
    expect(p.cli(['new', 'feature-x', '--json']).code).toBe(0);
    expect(p.cli(['new', 'readme-x', '--kind', 'docs', '--risk', 'low', '--json']).code).toBe(0);
    expect(p.cli(['track', 'set', 'lite', '--change', 'readme-x', '--note', 'docs', '--json']).code).toBe(0);
    const r = p.cli(['validate', '--all']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toMatch(/No delta specs/);
  }, 300000);

  it('negative: a full-track change whose intent is approved and that has a proposal but no delta spec still fails', () => {
    const p = project();
    expect(p.cli(['new', 'feature-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/feature-x/intent.md'), INTENT);
    expect(p.cli(['approve', 'intent', '--change', 'feature-x', '--json']).code).toBe(0);
    write(p.file('openspec/changes/feature-x/proposal.md'), '# Proposal\n\n## Why\nX.\n\n## What changes\nY.\n');
    const r = p.cli(['validate', '--all']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/No delta specs/);
  }, 300000);
});

describe('finding 6: license set changes only the license', () => {
  it('sdlc.yaml gains only license lines', () => {
    const p = project();
    const configFile = p.file('openspec/sdlc.yaml');
    const config = parse(read(configFile));
    config.gates.qa = { required: true };
    write(configFile, stringify(config));
    const before = read(configFile);
    const r = p.cli(['license', 'set', 'commercial', '--agreement', 'T-1', '--licensee', 'Team']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    const after = read(p.file('openspec/sdlc.yaml'));
    const old = new Set(before.split(/\r?\n/));
    const added = after.split(/\r?\n/).filter((line) => line.trim() && !old.has(line));
    expect(added.length).toBeGreaterThan(0);
    for (const line of added) expect(line, line).toMatch(/license|type:|agreement|licensee/);
    const removed = before.split(/\r?\n/).filter((line) => line.trim() && !after.split(/\r?\n/).includes(line));
    for (const line of removed) expect(line, line).toMatch(/license|type:|agreement|licensee/);
    expect(parse(after).license).toMatchObject({ type: 'commercial', agreement: 'T-1' });
  }, 240000);
});
