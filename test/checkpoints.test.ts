import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B3: approving a gate records a checkpoint (`refs/sdlc/<change>/<gate>`, a snapshot commit; branches and HEAD stay).
 * `sdlc rework <gate> --reset` restores, from the checkpoint, only the files of plan.md "Files that change" and the
 * change folder; it refuses when those files have uncommitted edits, and is unavailable without plan.md.
 */

const FILES: Record<string, string> = {
  'intent.md': '# Intent: say goodbye\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n',
  'proposal.md': '# Proposal\n\n## Why\n\nSessions end abruptly because users never see a farewell message that uses their name.\n\n## What Changes\n\n- Add farewell(name).\n\n## Capabilities\n\n### New Capabilities\n- `greeting`: greeting and farewell messages\n\n## Impact\n\nsrc/greet.js\n',
  'specs/greeting/spec.md': '# Spec Delta\n\n## Purpose\n\nProvide friendly, personalized greeting and farewell messages to users.\n\n## ADDED Requirements\n\n### Requirement: Farewell message\nThe system SHALL produce a farewell message that includes the user\'s name.\n\n#### Scenario: Named farewell\n- **WHEN** Ada signs out\n- **THEN** the message is "Goodbye, Ada"\n',
  'design.md': '# Design\n\n## Context\nsrc/greet.js\n\n## Decisions\nAdd farewell next to greet.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n\n## Order of work\n1. Implement.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n',
  'tasks.md': '# Tasks\n\n## 1. Farewell\n\n- [ ] 1.1 Implement farewell\n',
};

function gitOut(cwd: string, args: string[]): string {
  return spawnSync('git', args, { cwd, encoding: 'utf-8' }).stdout.trim();
}

function project(approve: string[] = ['intent', 'spec', 'plan']) {
  const root = tempDir('sdlc-checkpoints-');
  initGitRepo(root);
  write(path.join(root, 'src/greet.js'), 'export const greet = (n) => `Hello, ${n}`;\n');
  write(path.join(root, 'src/other.js'), 'export const other = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'add-farewell', '--json']).code).toBe(0);
  const dir = path.join(root, 'openspec/changes/add-farewell');
  for (const [file, text] of Object.entries(FILES)) write(path.join(dir, file), text);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
  for (const gate of approve) expect(cli(['approve', gate, '--change', 'add-farewell', '--json']).code, gate).toBe(0);
  return { root, cli, dir };
}

/** The agent builds: greet.js and other.js change, tasks.md is ticked, all committed. */
function build(root: string, dir: string): void {
  write(path.join(root, 'src/greet.js'), 'export const greet = (n) => `Hi, ${n}`;\nexport const bye = 1;\n');
  write(path.join(root, 'src/other.js'), 'export const other = 2;\n');
  write(path.join(dir, 'tasks.md'), FILES['tasks.md'].replace('- [ ]', '- [x]'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'build']);
}

const RESET = ['rework', 'plan', '--change', 'add-farewell', '--reason', 'design-flaw', '--note', 'wrong approach', '--reset'];

describe('checkpoints before a stage and rework --reset', () => {
  it('approving a gate records a checkpoint ref; HEAD and branches stay', () => {
    const p = project();
    expect(gitOut(p.root, ['show-ref', 'refs/sdlc/add-farewell/plan'])).toMatch(/refs\/sdlc\/add-farewell\/plan$/);
    expect(gitOut(p.root, ['log', '-1', '--format=%s'])).toBe('change');
    expect(gitOut(p.root, ['branch', '--format=%(refname:short)'])).not.toMatch(/sdlc/);
  }, 240000);

  it('--reset restores the plan files and the change folder from the checkpoint, nothing else', () => {
    const p = project();
    build(p.root, p.dir);
    const head = gitOut(p.root, ['rev-parse', 'HEAD']);
    const r = p.cli([...RESET, '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    expect(read(path.join(p.root, 'src/greet.js'))).toBe('export const greet = (n) => `Hello, ${n}`;\n');
    expect(read(path.join(p.dir, 'tasks.md'))).toBe(FILES['tasks.md']);
    expect(read(path.join(p.root, 'src/other.js'))).toBe('export const other = 2;\n');
    expect(gitOut(p.root, ['rev-parse', 'HEAD'])).toBe(head);
    expect(r.json().restored).toEqual(expect.arrayContaining(['src/greet.js']));
  }, 240000);

  it('the text output warns that external actions are not undone', () => {
    const p = project();
    build(p.root, p.dir);
    const out = p.cli(RESET).stdout;
    expect(out).toMatch(/external/i);
  }, 240000);

  it('negative: uncommitted edits in the files to restore are listed and nothing is restored', () => {
    const p = project();
    build(p.root, p.dir);
    write(path.join(p.root, 'src/greet.js'), 'export const greet = 0; // not committed\n');
    const r = p.cli([...RESET, '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('dirty_worktree');
    expect(r.json().status[0].message).toMatch(/src\/greet\.js/);
    expect(read(path.join(p.root, 'src/greet.js'))).toBe('export const greet = 0; // not committed\n');
  }, 240000);

  it('negative: --reset never writes through a link out of the project', (context_) => {
    const p = project();
    build(p.root, p.dir);
    const outside = tempDir('sdlc-outside-');
    const victim = path.join(outside, 'greet.js');
    const committed = read(path.join(p.root, 'src/greet.js'));
    write(victim, committed);
    fs.rmSync(path.join(p.root, 'src'), { recursive: true, force: true });
    try {
      fs.symlinkSync(outside, path.join(p.root, 'src'), 'junction');
    } catch {
      context_.skip();
    }
    const r = p.cli([...RESET, '--json']);
    expect(r.code, r.stdout).toBe(1);
    expect(r.json().status[0].code).toBe('unsafe_path');
    expect(read(victim)).toBe(committed);
    // Review finding: a refused reset records no rework either (the checks run before anything is written).
    expect(parse(read(path.join(p.dir, '.sdlc.yaml'))).gates.plan.rework).toBeUndefined();
  }, 240000);

  it('negative: without plan.md --reset is unavailable; without --reset the work stays', () => {
    const p = project(['intent']);
    fs.rmSync(path.join(p.dir, 'plan.md'));
    const noPlan = p.cli(['rework', 'intent', '--change', 'add-farewell', '--reason', 'other', '--note', 'n', '--reset', '--json']);
    expect(noPlan.code).toBe(1);
    expect(noPlan.json().status[0].code).toBe('no_plan');
    const q = project();
    build(q.root, q.dir);
    expect(q.cli(RESET.slice(0, -1).concat('--json')).code).toBe(0);
    expect(read(path.join(q.root, 'src/greet.js'))).toMatch(/Hi, /);
  }, 360000);
});
