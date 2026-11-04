import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { humanEnv, runCli, tempDir, write } from './helpers.js';

/**
 * B241: a redirection of stderr to the null device, or a descriptor duplication, names no file the command writes. A
 * read of a guarded or state file with such a redirect is a read (E2E run of 2026-11-02, finding S12: an agent could
 * not read the review policy before the design). Every real write stays refused.
 */

function project() {
  const root = tempDir('sdlc-stderr-reads-');
  for (const file of ['openspec/sdlc.yaml', 'REVIEW.md', 'CLAUDE.md', 'openspec/backlog.md', 'openspec/roles.yaml',
    'openspec/changes/demo/.sdlc.yaml', 'openspec/.sdlc/log.jsonl', 'openspec/.sdlc/inbox/a', 'notes/a.txt',
    '$null/a']) {
    write(path.join(root, file), 'a: 1\n');
  }
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  const ctx = { paths: projectPaths(root), config };
  return (command: string, tool = 'Bash') => evaluateToolCall(normalizeToolCall(tool, { command }, root), ctx);
}

const decide = project();

describe('B241.C1: a read with stderr sent to the null device', () => {
  it.each([
    'cat openspec/sdlc.yaml 2>/dev/null',
    'cat REVIEW.md 2>/dev/null',
    'cat REVIEW.md 2> /dev/null',
    'head -20 openspec/sdlc.yaml 2>/dev/null',
    'type REVIEW.md 2>nul',
    'cat "REVIEW.md" 2>"/dev/null"',
  ])('allows %s', (command) => {
    expect(decide(command).decision).toBe('allow');
  });

  it.each([
    'Get-Content REVIEW.md 2>$null',
    'Get-Content openspec/sdlc.yaml 2>$null',
    'Get-Content REVIEW.md *>$null',
  ])('allows %s in PowerShell', (command) => {
    expect(decide(command, 'PowerShell').decision).toBe('allow');
  });
});

describe('B241.C2: a read with stderr merged or a descriptor closed', () => {
  it.each([
    'cat CLAUDE.md REVIEW.md 2>/dev/null | head',
    'cat CLAUDE.md REVIEW.md 2>&1 | head',
    'cat openspec/backlog.md 2>/dev/null',
    'cat openspec/roles.yaml 2>&1 | head -5',
    'cat openspec/sdlc.yaml 2>&-',
    'cat openspec/sdlc.yaml 1>&2',
    'head openspec/.sdlc/log.jsonl 2>/dev/null',
  ])('allows %s', (command) => {
    expect(decide(command).decision).toBe('allow');
  });

  it('allows *>&1 in PowerShell', () => {
    expect(decide('Get-Content REVIEW.md *>&1', 'PowerShell').decision).toBe('allow');
  });
});

describe('B241.C3: a write stays refused next to a harmless redirect', () => {
  it.each([
    'echo x > openspec/sdlc.yaml',
    'echo x >> openspec/sdlc.yaml',
    'echo x >> REVIEW.md',
    'cat a 2>/dev/null > openspec/sdlc.yaml',
    'cat a > REVIEW.md 2>/dev/null',
    'cat a 2>&1 > REVIEW.md',
    'cmd 2> REVIEW.md',
    'cmd 2>> REVIEW.md',
    'cmd &> REVIEW.md',
    'echo x | tee openspec/sdlc.yaml',
    'echo x 2>/dev/null | tee REVIEW.md',
    'echo x > "$PWD/REVIEW.md"',
    'echo x 2>/dev/null > "$PWD/openspec/sdlc.yaml"',
    'cat REVIEW.md 2>/dev/null > ./openspec/sdlc.yaml',
  ])('refuses %s as guard-config', (command) => {
    expect(decide(command)).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it.each([
    'echo x > openspec/roles.yaml',
    'echo x 2>/dev/null > openspec/backlog.md',
    'cat a 2>&1 >> openspec/.sdlc/log.jsonl',
    'echo x 2>/dev/null > openspec/changes/demo/.sdlc.yaml',
  ])('refuses %s as state-integrity', (command) => {
    expect(decide(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    'Set-Content REVIEW.md x 2>$null',
    'Get-Content a 2>$null > REVIEW.md',
    'echo x *> REVIEW.md',
  ])('refuses %s in PowerShell', (command) => {
    expect(decide(command, 'PowerShell')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it.each([
    'cat x 2>/dev/nullx > REVIEW.md',
    'cat REVIEW.md 2>/dev/null/../../REVIEW.md',
    'cat REVIEW.md 2>nul.txt && echo y > REVIEW.md',
    'cat x 2>&1REVIEW.md > REVIEW.md',
  ])('negative: a target that only looks like a null device is not one: %s', (command) => {
    expect(decide(command).decision).toBe('deny');
  });

  it('negative: an in-place edit with stderr silenced is still a write', () => {
    expect(decide('sed -i s/a/b/ REVIEW.md 2>/dev/null')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    expect(decide('rm REVIEW.md 2>/dev/null')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });
});

describe('review round 1: a harmless redirect hides nothing', () => {
  // The plain form of each is refused; the redirect between the program and its arguments must not change that.
  it.each([
    'git 2>/dev/null checkout HEAD~1 -- openspec/changes/demo/.sdlc.yaml',
    'git 2>&1 restore --source=HEAD~1 openspec/roles.yaml',
    'git -C . 2>&1 checkout REVIEW.md',
    'git 2> /dev/null checkout REVIEW.md',
    'git &>/dev/null checkout REVIEW.md',
    'git &>>/dev/null checkout REVIEW.md',
    'fsutil 2>nul hardlink create notes/l openspec/roles.yaml',
    'sh -c "git 2>/dev/null checkout REVIEW.md"',
    '( git 2>&1 checkout REVIEW.md )',
  ])('refuses %s', (command) => {
    expect(decide(command).decision).toBe('deny');
  });

  it('refuses the same through PowerShell', () => {
    expect(decide('git 2>$null restore openspec/sdlc.yaml', 'PowerShell').decision).toBe('deny');
  });

  // Git Bash writes a real file named nul, and a quoted $null is a literal name.
  it.each([
    'cd openspec/.sdlc/inbox && echo x > nul',
    "cd openspec/.sdlc/inbox && echo x > '$null'",
  ])('refuses a write inside a state folder: %s', (command) => {
    expect(decide(command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  // Review round 2: a variable named null can hold any directory, and a real folder may be called $null.
  it.each([
    'null=.; cd $null; cp notes/a.txt REVIEW.md',
    'cd $null; cp notes/a.txt REVIEW.md',
    'cd $null; cp -r notes/. openspec/changes/demo',
    'pushd $null; cp notes/a.txt openspec/roles.yaml',
  ])('refuses a copy after a directory named by $null: %s', (command) => {
    expect(decide(command).decision).toBe('deny');
  });

  it('refuses the same through PowerShell', () => {
    expect(decide('Set-Location $null; Copy-Item notes/a.txt REVIEW.md', 'PowerShell').decision).toBe('deny');
  });

  it('a read with stderr sent to nul stays a read', () => {
    expect(decide('type REVIEW.md 2>nul').decision).toBe('allow');
  });
});

describe('B241 through the real hook', () => {
  const root = tempDir('sdlc-stderr-hook-');
  const env = humanEnv(tempDir('sdlc-home-'));
  const hook = (command: string, tool = 'Bash') => {
    const input = JSON.stringify({ cwd: root, tool_name: tool, tool_input: { command } });
    return runCli(['hook', 'pre-tool'], root, env, input);
  };
  const denied = (command: string, tool = 'Bash') => hook(command, tool).stdout.includes('"permissionDecision":"deny"');

  it('allows the reads and refuses the writes', () => {
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    write(path.join(root, 'REVIEW.md'), 'r\n');
    for (const read of ['cat openspec/sdlc.yaml 2>/dev/null', 'cat REVIEW.md 2>&1 | head -5']) {
      expect(denied(read), read).toBe(false);
    }
    expect(denied('Get-Content REVIEW.md 2>$null', 'PowerShell')).toBe(false);
    for (const change of ['cat a 2>/dev/null > REVIEW.md', 'git 2>/dev/null checkout REVIEW.md',
      'echo x 2>/dev/null | tee openspec/sdlc.yaml']) {
      expect(denied(change), change).toBe(true);
    }
  }, 180000);
});
