import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderClaudePlugin } from '../src/integrations/plugin.js';
import { hookCommand } from '../src/integrations/settings.js';
import { tempDir, write } from './helpers.js';

/**
 * Claude Code runs the PreToolUse command in a shell; exit code 2 blocks the call with stderr as the reason, any
 * other failure lets the call through. A crashed `sdlc hook` must block (after one retry) instead of allowing, as
 * the OpenCode plugin does since 0.7.1; a machine without the CLI keeps working.
 */

const FAKE = [
  '#!/usr/bin/env bash',
  'input=$(cat)',
  'dir=$(dirname "$0")',
  'printf x >> "$dir/calls"',
  'calls=$(wc -c < "$dir/calls")',
  '[ -n "$input" ] || { echo "no stdin" >&2; exit 1; }',
  'case "$MODE" in',
  '  deny) printf \'{"hookSpecificOutput":{"permissionDecision":"deny"}}\' ;;',
  '  crash) exit 1 ;;',
  '  flaky) [ "$calls" -le 1 ] && exit 1; printf \'{"decision":"after-retry"}\' ;;',
  'esac',
  '',
].join('\n');

/** Git's bash on Windows (Claude Code runs hooks with it), the system bash elsewhere. */
function bashPath(): string {
  if (process.platform !== 'win32') return 'bash';
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf-8' }).stdout.trim();
  const bash = path.join(execPath, '..', '..', '..', 'usr', 'bin', 'bash.exe');
  return fs.existsSync(bash) ? bash : 'bash';
}

function run(mode: string, withCli = true) {
  const dir = tempDir('sdlc-fake-cli-');
  if (withCli) {
    write(path.join(dir, 'sdlc'), FAKE);
    fs.chmodSync(path.join(dir, 'sdlc'), 0o755);
  }
  const shellPath = `${dir.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`)}:/usr/bin:/bin`;
  const result = spawnSync(bashPath(), ['-c', `export PATH="${shellPath}"; ${hookCommand('sdlc', 'pre-tool')}`], {
    input: JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' } }),
    encoding: 'utf-8',
    env: { ...process.env, MODE: mode },
  });
  const callsFile = path.join(dir, 'calls');
  const calls = fs.existsSync(callsFile) ? fs.readFileSync(callsFile, 'utf-8').length : 0;
  return { ...result, calls };
}

describe('the Claude Code PreToolUse command when the check itself fails', () => {
  it('passes the decision through when sdlc hook answers', () => {
    const r = run('deny');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('"permissionDecision":"deny"');
    expect(r.calls).toBe(1);
  });

  it('a check that fails once is run again with the same input', () => {
    const r = run('flaky');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('after-retry');
    expect(r.calls).toBe(2);
  });

  it('a check that keeps failing blocks the call (exit 2) and says why', () => {
    const r = run('crash');
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/\[sdlc\][^\n]*could not run/i);
    expect(r.stderr).toMatch(/sdlc doctor/);
    expect(r.calls).toBe(2);
  });

  it('negative: without the CLI on the machine the call goes through quietly', () => {
    const r = run('deny', false);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it('the Claude Code plugin uses the same guarded command', () => {
    const files = renderClaudePlugin('sdlc');
    const hooks = files.find((file) => file.path.endsWith('hooks/hooks.json'));
    expect(hooks, 'plugin hooks.json').toBeDefined();
    expect(hooks!.content).toContain(JSON.stringify(hookCommand('sdlc', 'pre-tool')).slice(1, -1));
  });
});
