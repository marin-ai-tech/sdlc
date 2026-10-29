import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import { recordChangeEvent } from '../src/cli/context.js';
import { approveCommand } from '../src/commands/gates.js';
import { BIN, git, humanEnv, initGitRepo, read, tempDir, write } from './helpers.js';

/**
 * F5 (close-the-digest-integrity-review-findings): `persistApproval` moved the gate's checkpoint ref inside
 * `recordCheckpoint`, before its last digest recheck and before the approval record was written. An approval that
 * failed after its snapshot was captured left the ref on the refused snapshot, so `sdlc rework --reset` would restore
 * content nobody approved. The ref now moves only after the record is written; a failure before that keeps the
 * earlier ref, or leaves it absent.
 *
 * Real git and the real checkpoint. The approval runs in this process so that only the record write
 * (`recordChangeEvent`) can be made to fail; failures are rethrown instead of printed. The earlier approval in the
 * first case is a person's, through the CLI.
 */

const control = vi.hoisted(() => ({ fail: false }));
vi.mock('../src/cli/context.js', async (original) => {
  const actual = await original<typeof import('../src/cli/context.js')>();
  return { ...actual,
    recordChangeEvent: vi.fn((...args: Parameters<typeof actual.recordChangeEvent>) => {
      if (control.fail) throw new Error('the record write failed');
      return actual.recordChangeEvent(...args);
    }),
  };
});
vi.mock('../src/cli/output.js', async (original) => {
  const actual = await original<typeof import('../src/cli/output.js')>();
  return { ...actual, line: vi.fn(), warn: vi.fn(), printJson: vi.fn(),
    reportFailure: (error: unknown) => {
      throw error;
    },
  };
});

const CHANGE = 'add-farewell';
const ARTIFACT = `openspec/changes/${CHANGE}/intent.md`;
const REF = `refs/sdlc/${CHANGE}/intent`;
const CLI_TIMEOUT = 120000;
const AGENT_VARS = ['CLAUDECODE', 'OPENCODE', 'AGENT', 'SDLC_AGENT', 'CLAUDE_PROJECT_DIR', 'CURSOR_AGENT',
  'CODEX_CI', 'CODEX_SESSION_ID', 'QWEN_CODE', 'QWEN_CODE_SESSION_ID'];
const INTENT = [
  '# Intent: say goodbye', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem',
  'Sessions end without a goodbye.', '', '## Proposed outcome', 'Users see a named farewell.', '',
  '## Affected users and systems', 'All users.', '', '## Constraints', 'None', '', '## Success measures',
  'Shown on sign-out.', '', '## Out of scope', 'Localization.', '', '## Open questions', 'None', '',
].join('\n');
const EDITED = INTENT.replace('Sessions end without a goodbye.', 'Sessions end abruptly, without a goodbye.');

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8', timeout: CLI_TIMEOUT });
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

function refValue(root: string): string | undefined {
  const r = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${REF}^{commit}`],
    { cwd: root, encoding: 'utf-8', timeout: 30000 });
  return r.status === 0 ? r.stdout.trim() : undefined;
}

function savedIntent(root: string): string {
  return spawnSync('git', ['cat-file', 'blob', `${REF}:${ARTIFACT}`],
    { cwd: root, encoding: 'utf-8', timeout: 30000 }).stdout;
}

/** A committed project with one change whose intent is ready for a person's approval. */
function project() {
  const root = tempDir('sdlc-approval-order-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => {
    const r = run(args, root, env);
    expect(r.code, r.out).toBe(0);
  };
  cli(['init', '--tools', 'none', '--json']);
  cli(['new', CHANGE, '--kind', 'feature', '--json']);
  write(path.join(root, ARTIFACT), INTENT);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'change']);
  const approvals = () => {
    const state = parse(read(path.join(root, 'openspec', 'changes', CHANGE, '.sdlc.yaml')));
    return state.gates?.intent?.approvals ?? [];
  };
  return { root, cli, approvals };
}

/** The approval as a person runs it, in this process, from the project root. */
async function approveHere(root: string): Promise<void> {
  process.chdir(root);
  await approveCommand('intent', { change: CHANGE, json: true });
}

describe('F5: the checkpoint ref moves only after the approval record is written', () => {
  const cwd = process.cwd();
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    control.fail = false;
    vi.mocked(recordChangeEvent).mockClear();
    for (const key of AGENT_VARS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    process.chdir(cwd);
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('keeps an earlier checkpoint ref when the record write fails', async () => {
    const p = project();
    p.cli(['approve', 'intent', '--change', CHANGE, '--json']);
    const earlier = refValue(p.root);
    expect(earlier, 'the earlier approval recorded no checkpoint').toBeDefined();
    write(path.join(p.root, ARTIFACT), EDITED);
    control.fail = true;
    await expect(approveHere(p.root)).rejects.toThrow();
    expect(recordChangeEvent).toHaveBeenCalled();
    expect(refValue(p.root), 'the ref moved to the refused snapshot').toBe(earlier);
    // So `sdlc rework --reset` would restore the approved text, never the refused one.
    expect(savedIntent(p.root)).toBe(INTENT);
    expect(savedIntent(p.root)).not.toContain('abruptly');
  }, 240000);

  it('leaves the ref absent when the first approval fails after its snapshot', async () => {
    const p = project();
    control.fail = true;
    await expect(approveHere(p.root)).rejects.toThrow();
    expect(recordChangeEvent).toHaveBeenCalled();
    expect(refValue(p.root), 'the refused approval left a checkpoint ref').toBeUndefined();
    expect(p.approvals()).toEqual([]);
  }, 240000);

  it('moves the ref to the approval\'s snapshot after the record is written', async () => {
    const p = project();
    await expect(approveHere(p.root)).resolves.toBeUndefined();
    const events = vi.mocked(recordChangeEvent).mock.calls.map((call) => call[3]);
    expect(events.filter((event) => event === 'gate.intent.approved')).toHaveLength(1);
    expect(p.approvals()).toHaveLength(1);
    expect(refValue(p.root), 'the recorded approval has no checkpoint ref').toBeDefined();
    expect(savedIntent(p.root)).toBe(INTENT);
  }, 240000);
});
