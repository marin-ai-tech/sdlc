import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, tempDir, write } from './helpers.js';

/**
 * B85 (0.14.3): Codex CLI 0.158.0 lets a tool call through when its PreToolUse hook fails — a non-zero exit, exit 2
 * included, a crash, bad JSON or a timeout (probed live on Windows, 2026-10-09); only a JSON `deny` answer blocks.
 * Qwen Code and GigaCode document the same fail-open behaviour. sdlc's rule (src/hook.ts) is that a hook that cannot
 * run blocks the call, and only a CLI that is not installed lets it through. So for these agents the CLI entry itself
 * answers a JSON deny when the pre-tool hook fails to load or throws.
 *
 * The oracle: a copy of bin/sdlc.js next to a broken dist/hook.js — no switch in the product code.
 */

type Broken = 'throws' | 'rejects-later' | 'missing';

const HOOK_JS: Record<Exclude<Broken, 'missing'>, string> = {
  throws: 'export async function runHook() { throw new Error("hook broke"); }\n',
  'rejects-later': [
    'export function runHook() {',
    '  return new Promise(() => { setTimeout(() => { throw new Error("hook broke later"); }, 10); });',
    '}',
    '',
  ].join('\n'),
};

function brokenInstall(kind: Broken): string {
  const root = tempDir('sdlc-broken-');
  write(path.join(root, 'package.json'), '{"type": "module"}\n');
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, 'bin', 'sdlc.js'), path.join(root, 'bin', 'sdlc.js'));
  if (kind !== 'missing') write(path.join(root, 'dist', 'hook.js'), HOOK_JS[kind]);
  return root;
}

function runBroken(kind: Broken, args: string[]) {
  const root = brokenInstall(kind);
  const input = JSON.stringify({ session_id: 's', cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Bash',
    tool_input: { command: 'echo x > src/a.js' } });
  const r = spawnSync(process.execPath, [path.join(root, 'bin', 'sdlc.js'), ...args], {
    input, encoding: 'utf-8', timeout: 30000,
  });
  return { code: r.status, stdout: r.stdout.trim(), stderr: r.stderr };
}

function decision(stdout: string): string | undefined {
  if (stdout === '') return undefined;
  const answer = JSON.parse(stdout) as { hookSpecificOutput?: { permissionDecision?: string; hookEventName?: string } };
  return answer.hookSpecificOutput?.permissionDecision;
}

describe('B85: a pre-tool hook that fails blocks the call for agents without a shell guard', () => {
  for (const agent of ['codex', 'qwen', 'gigacode']) {
    for (const kind of ['throws', 'rejects-later', 'missing'] as const) {
      it(`${agent}: ${kind}`, () => {
        const r = runBroken(kind, ['hook', 'pre-tool', '--agent', agent]);
        expect(r.code, r.stderr).toBe(0);
        expect(decision(r.stdout), r.stdout).toBe('deny');
        const answer = JSON.parse(r.stdout);
        expect(answer.hookSpecificOutput.hookEventName).toBe('PreToolUse');
        expect(String(answer.hookSpecificOutput.permissionDecisionReason)).toMatch(/sdlc doctor/);
      }, 60000);
    }
  }

  it('negative: Claude Code keeps its own guard (a non-zero exit, no JSON answer from the entry)', () => {
    const r = runBroken('throws', ['hook', 'pre-tool']);
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
  }, 60000);

  it('negative: session-start and stop stay fail-open for Codex (no deny, no answer)', () => {
    for (const event of ['session-start', 'stop']) {
      const r = runBroken('throws', ['hook', event, '--agent', 'codex']);
      expect(decision(r.stdout), event).toBeUndefined();
    }
  }, 60000);

  it('negative: other commands still fail with exit 1', () => {
    const root = brokenInstall('missing');
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'sdlc.js'), 'status'], { encoding: 'utf-8' });
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe('');
  }, 60000);
});

describe('B85: a working hook is not touched', () => {
  it('outside an sdlc project the Codex pre-tool hook still answers nothing (fail open)', () => {
    const dir = tempDir('sdlc-not-a-project-');
    const input = JSON.stringify({ session_id: 's', cwd: dir, hook_event_name: 'PreToolUse', tool_name: 'Bash',
      tool_input: { command: 'echo x > a.js' } });
    const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'bin', 'sdlc.js'), 'hook', 'pre-tool', '--agent',
      'codex'], { input, encoding: 'utf-8', cwd: dir, timeout: 30000 });
    expect(r.status).toBe(0);
    expect(decision(r.stdout.trim())).toBeUndefined();
  }, 60000);
});
