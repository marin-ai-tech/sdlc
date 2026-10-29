import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadConfig, type SdlcConfig } from '../src/core/config.js';
import { SdlcError } from '../src/core/errors.js';
import { stopCheck } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { BIN, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F1 (close-the-digest-integrity-review-findings): B126 made `digestText` throw `unsafe_path` and
 * `artifact_unreadable`, but the stop check (verify-before-stop) caught every evaluation error and skipped the change,
 * so an agent could stop without verification by breaking one artifact. Every change that cannot be evaluated now
 * blocks the stop, whatever its task list shows, with a message that names the change and the error's code
 * (`unexpected_error` without one), sends the agent to a person and builds no command from the change name.
 * The limits stay: verify-before-stop off, enforcement off, and a repeated stop (`stop_hook_active`) never block.
 *
 * Unit cases make one change's evaluation throw (the rest is real). The hook cases break a real artifact: a file link
 * outside the change where the host allows links (`unsafe_path`), else an unreadable file (`artifact_unreadable`).
 * A junction cannot stand in for the link: the artifact walk does not follow linked folders, so a junctioned folder
 * covers no file and gives no evaluation error.
 */

const failures = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../src/core/lifecycle.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/lifecycle.js')>();
  return {
    ...real,
    evaluateChange: (...args: Parameters<typeof real.evaluateChange>) => {
      const failure = failures.get(args[1].id);
      if (failure !== undefined) throw failure;
      return real.evaluateChange(...args);
    },
  };
});

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome',
  'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');
const PLAN = '# Plan\n\n## Files that change\n- `src/a.js` (new)\n\n## Order of work\n1. Do.\n\n## Proof\n'
  + '`node -e 0`\n\n## Rollback\nRevert.\n';
const DONE_TASKS = '# Tasks\n\n## 1. Work\n\n- [x] 1.1 Do it and verify node -e 0 passes\n';
const OPEN_TASKS = '# Tasks\n\n## 1. Work\n\n- [ ] 1.1 Do it and verify node -e 0 passes\n';
const HOOK_TIMEOUT = 60000;

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, input, encoding: 'utf-8', timeout: HOOK_TIMEOUT });
  return { code: r.status, stdout: r.stdout ?? '', out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function project() {
  const root = tempDir('sdlc-stop-errors-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => {
    const r = run([...args, '--json'], root, env);
    expect(r.code, r.out).toBe(0);
    return JSON.parse(r.stdout);
  };
  cli(['init', '--tools', 'none']);
  const configFile = path.join(root, 'openspec', 'sdlc.yaml');
  const config = parse(read(configFile));
  config.enforcement.verify_before_stop = true;
  config.verify.commands = [{ name: 'unit', run: 'node -e 0', required: true }];
  write(configFile, stringify(config));
  const dir = (id: string) => path.join(root, 'openspec', 'changes', id);
  /** A change past its plan (planning gates set aside by a person) with the given task list. */
  const change = (id: string, tasks: string) => {
    cli(['new', id]);
    write(path.join(dir(id), 'intent.md'), INTENT);
    for (const gate of ['intent', 'spec', 'plan']) cli(['waive', gate, '--change', id, '--note', 'test']);
    write(path.join(dir(id), 'plan.md'), PLAN);
    write(path.join(dir(id), 'tasks.md'), tasks);
  };
  const context = (edit: (c: SdlcConfig) => void = () => undefined) => {
    const paths = projectPaths(root);
    const loaded = loadConfig(paths.sdlcConfig);
    edit(loaded);
    return { paths, config: loaded };
  };
  const hook = (payload: Record<string, unknown> = {}) => {
    const input = JSON.stringify({ session_id: 's', cwd: root, hook_event_name: 'Stop', ...payload });
    const r = run(['hook', 'stop'], root, env, input);
    expect(r.code, r.out).toBe(0);
    return r.stdout.trim();
  };
  return { root, env, cli, dir, change, context, hook };
}

function expectBlock(message: string | undefined, change: string, code: string): void {
  expect(message, 'the stop is not blocked').toBeDefined();
  expect(message).toContain(change);
  expect(message).toContain(code);
  expect(message).toMatch(/person|human/i);
  // Negative: no command is built from the change name.
  expect(message).not.toContain('--change');
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

describe('F1: an evaluation error blocks the stop (unit)', () => {
  it('blocks the stop for a change with unsafe_path', () => {
    const p = project();
    p.change('a-open', OPEN_TASKS);
    p.change('broken', DONE_TASKS);
    failures.set('broken', new SdlcError('unsafe_path',
      { key: 'error.digestArtifactUnsafe', params: { file: 'intent.md' } }));
    try {
      const message = stopCheck(p.context());
      expectBlock(message, 'broken', 'unsafe_path');
      expect(message).not.toContain('a-open');
    } finally {
      failures.clear();
    }
  }, 180000);

  it('blocks the stop for a change with artifact_unreadable', () => {
    const p = project();
    p.change('broken', DONE_TASKS);
    failures.set('broken', new SdlcError('artifact_unreadable',
      { key: 'error.digestArtifactUnreadable', params: { file: 'intent.md' } }));
    try {
      expectBlock(stopCheck(p.context()), 'broken', 'artifact_unreadable');
    } finally {
      failures.clear();
    }
  }, 180000);

  it('blocks the stop with unexpected_error for an error without a code', () => {
    const p = project();
    p.change('broken', DONE_TASKS);
    failures.set('broken', new Error('the disk went away'));
    try {
      expectBlock(stopCheck(p.context()), 'broken', 'unexpected_error');
    } finally {
      failures.clear();
    }
  }, 180000);

  it('blocks for a broken change whose tasks are not all done', () => {
    const p = project();
    p.change('broken', OPEN_TASKS);
    failures.set('broken', new SdlcError('unsafe_path',
      { key: 'error.digestArtifactUnsafe', params: { file: 'intent.md' } }));
    try {
      expectBlock(stopCheck(p.context()), 'broken', 'unsafe_path');
    } finally {
      failures.clear();
    }
  }, 180000);

  it('does not block a broken change when verifyBeforeStop is off', () => {
    const p = project();
    p.change('broken', DONE_TASKS);
    failures.set('broken', new Error('the disk went away'));
    try {
      expect(stopCheck(p.context((c) => { c.enforcement.verifyBeforeStop = false; }))).toBeUndefined();
    } finally {
      failures.clear();
    }
  }, 180000);

  it('does not block a broken change when enforcement is off', () => {
    const p = project();
    p.change('broken', DONE_TASKS);
    failures.set('broken', new Error('the disk went away'));
    try {
      expect(stopCheck(p.context((c) => { c.enforcement.mode = 'off'; }))).toBeUndefined();
    } finally {
      failures.clear();
    }
  }, 180000);

  it('does not block when every change is healthy and done changes have fresh passing verification', () => {
    const p = project();
    p.change('a-open', OPEN_TASKS);
    p.change('done-work', DONE_TASKS);
    // The rule is live: a done change without verification blocks (the existing message, with its command).
    expect(stopCheck(p.context())).toMatch(/done-work.*sdlc verify --change done-work/s);
    expect(p.cli(['verify', '--change', 'done-work']).status).toBe('passed');
    expect(stopCheck(p.context())).toBeUndefined();
  }, 180000);
});

describe('F1: an evaluation error blocks the stop (hook)', () => {
  it('the hook stop blocks for a covered artifact linked outside the change, or unreadable where links are refused',
    () => {
      const p = project();
      p.change('a-open', OPEN_TASKS);
      p.change('broken', DONE_TASKS);
      const broken = breakArtifact(path.join(p.dir('broken'), 'intent.md'), path.join(p.root, 'outside', 'intent.md'));
      try {
        // The fixture really breaks the evaluation (sdlc status reports it per change).
        const status = p.cli(['status']);
        const entry = status.changes.find((c: { change: string }) => c.change === 'broken');
        expect(entry.error).toMatch(broken.code === 'unsafe_path' ? /outside its change folder/ : /could not be read/);
        const answer = p.hook();
        expect(answer, 'the stop is not blocked').not.toBe('');
        const parsed = JSON.parse(answer) as { decision?: string; reason?: string };
        expect(parsed.decision).toBe('block');
        expectBlock(parsed.reason, 'broken', broken.code);
        expect(parsed.reason).not.toContain('a-open');
      } finally {
        broken.restore();
      }
    }, 180000);

  it('the hook stop does not block a repeated stop marked stop_hook_active', () => {
    const p = project();
    p.change('broken', DONE_TASKS);
    const broken = breakArtifact(path.join(p.dir('broken'), 'intent.md'), path.join(p.root, 'outside', 'intent.md'));
    try {
      expect(p.hook({ stop_hook_active: true })).toBe('');
    } finally {
      broken.restore();
    }
  }, 180000);
});
