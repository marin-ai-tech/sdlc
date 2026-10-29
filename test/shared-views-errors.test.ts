import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIN, git, humanEnv, initGitRepo, tempDir, write } from './helpers.js';

/**
 * F8 (close-the-digest-integrity-review-findings): `sdlc next --me`, `sdlc board list` and the statusline evaluated
 * every change without a per-change guard, so one change that cannot be evaluated (B126 made `unsafe_path` and
 * `artifact_unreadable` throw) failed the whole view. Each change is now evaluated on its own: a broken change is one
 * entry naming the change and the error's code (`errors` in JSON, present only when non-empty; one line in text),
 * the other changes are listed as if it were absent, and the broken change is never offered as work.
 *
 * The broken artifact is real: a file link outside the change where the host allows links (`unsafe_path`), else an
 * unreadable file (`artifact_unreadable`, Windows without the symlink privilege). A junction cannot stand in for the
 * link: the artifact walk does not follow linked folders, so a junctioned folder gives no evaluation error.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/a.js` (new)\n\n## Order of work\n1. Do.\n\n## Proof\n'
  + '`node -e 0`\n\n## Rollback\nRevert.\n';
const OPEN_TASKS = '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 Do it and verify node -e 0 passes\n';
const ERROR_WORDS = /unsafe_path|artifact_unreadable|unexpected_error|cannot be evaluated|could not be evaluated/i;

interface ErrorEntry {
  change: string;
  code: string;
  message: string;
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, input, encoding: 'utf-8', timeout: 60000 });
  return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function denyRead(file: string): void {
  if (process.platform === 'win32') {
    const r = spawnSync('icacls', [file, '/deny', '*S-1-1-0:(R)'], { encoding: 'utf-8', timeout: 30000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  } else {
    fs.chmodSync(file, 0o000);
  }
  expect(() => fs.readFileSync(file), 'the fixture file is still readable').toThrow();
}

function allowRead(file: string): void {
  if (process.platform === 'win32') {
    spawnSync('icacls', [file, '/remove:d', '*S-1-1-0'], { encoding: 'utf-8', timeout: 30000 });
  } else {
    fs.chmodSync(file, 0o644);
  }
}

/**
 * Breaks a covered artifact for real: a file link outside the change folder where the host allows links, else an
 * unreadable file (Windows without the symlink privilege). Returns the code the evaluation reports and an undo.
 */
function breakArtifact(file: string, outside: string): { code: string; restore: () => void } {
  write(outside, '# Intent\n\nOutside the change.\n');
  fs.rmSync(file, { force: true });
  try {
    fs.symlinkSync(outside, file, 'file');
    return { code: 'unsafe_path', restore: () => undefined };
  } catch {
    write(file, INTENT);
    denyRead(file);
    return { code: 'artifact_unreadable', restore: () => allowRead(file) };
  }
}

/**
 * b-waiting waits for its intent approval (a person); c-building has a set-aside plan and an open task (an agent).
 * With `broken`, a-broken would wait for a person and have a board task if it could be evaluated.
 */
function project(broken: boolean) {
  const root = tempDir('sdlc-shared-views-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], input?: string) => run(args, root, env, input);
  const ok = (args: string[]) => {
    const r = cli([...args, '--json']);
    expect(r.code, r.out).toBe(0);
  };
  ok(['init', '--tools', 'none']);
  const dir = (id: string) => path.join(root, 'openspec', 'changes', id);
  const change = (id: string, waive: string[], tasks: boolean) => {
    ok(['new', id]);
    write(path.join(dir(id), 'intent.md'), INTENT);
    for (const gate of waive) ok(['waive', gate, '--change', id, '--note', 'test']);
    if (!tasks) return;
    write(path.join(dir(id), 'plan.md'), PLAN);
    write(path.join(dir(id), 'tasks.md'), OPEN_TASKS);
  };
  change('b-waiting', [], false);
  change('c-building', ['intent', 'spec', 'plan'], true);
  if (!broken) return { root, cli, code: undefined, restore: () => undefined };
  change('a-broken', ['spec', 'plan'], true);
  const failure = breakArtifact(path.join(dir('a-broken'), 'intent.md'), path.join(root, 'outside', 'intent.md'));
  return { root, cli, code: failure.code, restore: failure.restore };
}

type Project = ReturnType<typeof project>;

function withBroken(test: (p: Project) => void): void {
  const p = project(true);
  try {
    test(p);
  } finally {
    p.restore();
  }
}

function json(p: Project, args: string[]) {
  const r = p.cli([...args, '--json']);
  expect(r.code, r.out).toBe(0);
  return JSON.parse(r.stdout);
}

function statusline(p: Project): string {
  const r = p.cli(['statusline'], JSON.stringify({ cwd: p.root, workspace: { current_dir: p.root } }));
  expect(r.code, r.out).toBe(0);
  return r.stdout;
}

const queueGates = (out: { items: Array<{ change: string; gate: string }> }) =>
  out.items.map((item) => `${item.change}:${item.gate}`);

describe('F8: one broken change is one error entry in the shared views', () => {
  it('next --me --json lists the waiting change and an unsafe_path (or artifact_unreadable) error', () => {
    withBroken((p) => {
      const out = json(p, ['next', '--me']);
      expect(queueGates(out)).toContain('b-waiting:intent');
      const errors = out.errors as ErrorEntry[];
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ change: 'a-broken', code: p.code });
      expect(errors[0].message.length).toBeGreaterThan(0);
      const text = p.cli(['next', '--me']);
      expect(text.code, text.out).toBe(0);
      expect(text.stdout).toContain('b-waiting');
      const lines = text.stdout.split('\n').filter((line) => line.includes('a-broken'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(p.code!);
    });
  }, 240000);

  it('board list text and JSON list the healthy change\'s tasks and one error entry', () => {
    withBroken((p) => {
      const out = json(p, ['board', 'list']);
      const changes = (out.tasks as Array<{ change: string }>).map((task) => task.change);
      expect(changes).toContain('c-building');
      const errors = out.errors as ErrorEntry[];
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ change: 'a-broken', code: p.code });
      const text = p.cli(['board', 'list']);
      expect(text.code, text.out).toBe(0);
      expect(text.stdout).toContain('c-building');
      const lines = text.stdout.split('\n').filter((line) => line.includes('a-broken'));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(p.code!);
    });
  }, 240000);

  it('statusline prints the healthy change and says one change cannot be evaluated', () => {
    withBroken((p) => {
      const out = statusline(p);
      expect(out, 'the statusline printed nothing').not.toBe('');
      expect(out).toMatch(/b-waiting · /);
      expect(out).toMatch(/evaluat/i);
      expect(out).toMatch(/(^|\D)1(\D|$)/);
      // As if the broken change were absent: two changes are counted, not three.
      expect(out).not.toMatch(/3 changes/);
    });
  }, 240000);

  it('the broken change is no queue item, board task or statusline change', () => {
    withBroken((p) => {
      const queue = json(p, ['next', '--me']);
      expect(queueGates(queue).filter((gate) => gate.startsWith('a-broken'))).toEqual([]);
      expect(JSON.stringify(queue.items)).not.toContain('--change a-broken');
      const board = json(p, ['board', 'list']);
      expect((board.tasks as Array<{ change: string }>).filter((task) => task.change === 'a-broken')).toEqual([]);
      expect(statusline(p)).not.toMatch(/a-broken · /);
    });
  }, 240000);

  it('no errors field and no error lines when every change evaluates', () => {
    const p = project(false);
    const queue = json(p, ['next', '--me']);
    expect(queueGates(queue)).toContain('b-waiting:intent');
    expect('errors' in queue).toBe(false);
    const board = json(p, ['board', 'list']);
    expect((board.tasks as Array<{ change: string }>).map((task) => task.change)).toContain('c-building');
    expect('errors' in board).toBe(false);
    for (const args of [['next', '--me'], ['board', 'list']]) {
      const text = p.cli(args);
      expect(text.code, text.out).toBe(0);
      expect(text.stdout).not.toMatch(ERROR_WORDS);
    }
    const line = statusline(p);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(line).toMatch(/2 changes · b-waiting · /);
    expect(line).not.toMatch(ERROR_WORDS);
  }, 240000);
});
