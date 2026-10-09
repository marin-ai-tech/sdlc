import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { defaultConfig, loadConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/** Findings of the independent review of 0.8.0 that were accepted for a fix. */

function context() {
  const root = tempDir('sdlc-review-080-');
  return { root, ctx: { paths: projectPaths(root), config: defaultConfig() } };
}
const bash = (root: string, command: string) => normalizeToolCall('Bash', { command }, root);
const denied = (decision: { decision: string }) => decision.decision === 'deny';

describe('1-2: more shell writes to state files, file by file or a whole folder', () => {
  it('Windows, PowerShell and option variants of writing a state file are denied', () => {
    const { root, ctx } = context();
    for (const command of [
      'del openspec\\changes\\demo\\.sdlc.yaml',
      'copy C:\\tmp\\fake.yaml openspec\\changes\\demo\\.sdlc.yaml',
      "[IO.File]::WriteAllText('openspec/changes/demo/.sdlc.yaml','x')",
      "sed -E -i 's/a/b/' openspec/changes/demo/.sdlc.yaml",
      "perl -pi -e 's/a/b/' openspec/roles.yaml",
      'find openspec -name .sdlc.yaml -delete',
      'git -C openspec/changes/demo checkout HEAD~1 -- .sdlc.yaml',
    ]) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('a write to a folder that holds state files is denied', () => {
    const { root, ctx } = context();
    for (const command of ['rm -rf openspec/changes/demo', 'git checkout HEAD~3 -- openspec/changes/demo',
      'git restore openspec/', 'cp -r /tmp/forged openspec/changes/demo', 'mv openspec/changes/demo /tmp/x',
      'git checkout HEAD~1 -- openspec/.sdlc']) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('negative: writes inside a change folder to ordinary files, and reads, stay allowed', () => {
    const { root, ctx } = context();
    for (const command of ['rm -rf openspec/changes/demo/tmp', 'cp a.md openspec/changes/demo/notes.md',
      'ls -la openspec/changes/demo', 'git diff -- openspec/changes/demo', 'del build\\out.txt']) {
      expect(evaluateToolCall(bash(root, command), ctx).decision, command).toBe('allow');
    }
  });
});

describe('3, 4, 6: links, markers and removing the CLI', () => {
  it('creating a hard link to a state file is denied', () => {
    const { root, ctx } = context();
    for (const command of ['link openspec/changes/demo/.sdlc.yaml notes.yaml',
      'cmd /c mklink /H notes.yaml openspec\\changes\\demo\\.sdlc.yaml',
      'fsutil hardlink create notes.yaml openspec\\roles.yaml']) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('more ways to change the agent markers are denied', () => {
    const { root, ctx } = context();
    for (const command of ['CLAUDECODE+=x sdlc status', 'export CLAUDECODE+=0', '$env:CLAUDECODE += "x"',
      'exec -c sdlc status', 'Remove-Item Env:CLAUDE*', 'Get-Item Env:CLAUDECODE | Remove-Item',
      'Start-Process sdlc -UseNewEnvironment']) {
      expect(evaluateToolCall(bash(root, command), ctx), command).toMatchObject({ decision: 'deny', rule: 'agent-marker' });
    }
  });

  it('uninstalling the sdlc CLI is denied', () => {
    const { root, ctx } = context();
    for (const command of ['npm uninstall -g sdlc', 'npm rm sdlc', 'npm remove --global sdlc']) {
      expect(denied(evaluateToolCall(bash(root, command), ctx)), command).toBe(true);
    }
    expect(evaluateToolCall(bash(root, 'npm uninstall left-pad'), ctx).decision).toBe('allow');
  });
});

const PLAN = '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n\n## Order of work\n1. Do.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n';

function held() {
  const root = tempDir('sdlc-review-080-held-');
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  expect(cli(['new', 'demo', '--json']).code).toBe(0);
  write(path.join(root, 'openspec/changes/demo/plan.md'), PLAN);
  expect(cli(['takeover', '--change', 'demo', '--note', 'mine', '--json']).code).toBe(0);
  const ctx = () => ({ paths: projectPaths(root), config: loadConfig(path.join(root, 'openspec/sdlc.yaml')) });
  return { root, cli, ctx };
}

describe('5: a held change is held for the shell too', () => {
  it('shell writes to the held files and agent CLI steps on the held change are denied', () => {
    const p = held();
    for (const command of ["printf 'x' > src/greet.js", 'sed -i s/a/b/ openspec/changes/demo/plan.md',
      'sdlc verify --change demo', 'sdlc tests lock --change demo']) {
      expect(evaluateToolCall(bash(p.root, command), p.ctx()), command).toMatchObject({ decision: 'deny', rule: 'takeover' });
    }
    for (const command of ['cat src/greet.js', "printf 'x' > src/other.js", 'sdlc status --change demo']) {
      // 0.14.0: shell writes count for the plan gate (a warning here); the held change does not hold other files.
      const decision = evaluateToolCall(bash(p.root, command), p.ctx());
      expect(decision.decision, command).not.toBe('deny');
      expect(decision.rule, command).not.toBe('takeover');
    }
  }, 120000);
});

describe('7, 9, 12: approvals, record versions, hook speed', () => {
  it('without roles.yaml --by cannot be used on a gate that needs several approvers', () => {
    const root = tempDir('sdlc-review-080-by-');
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'));
    const cli = (args: string[]) => runCli(args, root, env);
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.gates.intent.min_approvals = 2;
    write(file, stringify(config));
    expect(cli(['new', 'demo', '--json']).code).toBe(0);
    write(path.join(root, 'openspec/changes/demo/intent.md'), '# Intent: x\n\n## Problem\nP.\n');
    const r = cli(['approve', 'intent', '--change', 'demo', '--by', 'Bob <bob@x.example>', '--json']);
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('by_not_allowed');
  }, 120000);

  it('a record with a rework or a takeover is written as version 2, which older CLIs refuse; plain ones stay 1', () => {
    const p = held();
    expect(parse(read(path.join(p.root, 'openspec/changes/demo/.sdlc.yaml'))).version).toBe(2);
    expect(p.cli(['release-control', '--change', 'demo', '--note', 'back', '--json']).code).toBe(0);
    expect(parse(read(path.join(p.root, 'openspec/changes/demo/.sdlc.yaml'))).version).toBe(1);
    expect(p.cli(['status', '--change', 'demo', '--json']).code).toBe(0);
  }, 120000);

  it('the pre-tool hook does not compute the names of approvers', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'policy.ts'), 'utf-8');
    expect(source).toMatch(/skipPeople:\s*true/);
  });
});

describe('10: rework --reset keeps ignored files', () => {
  const FILES: Record<string, string> = {
    'intent.md': '# Intent: x\n\nAuthor: Pat. Status: draft. Source: idea\n\n## Problem\nP.\n\n## Proposed outcome\nO.\n\n## Affected users and systems\nAll.\n\n## Constraints\nNone\n\n## Success measures\nM.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n',
    'plan.md': '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n- `config/local.json` (new)\n\n## Order of work\n1. Do.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n',
  };

  function project() {
    const root = tempDir('sdlc-review-080-reset-');
    initGitRepo(root);
    write(path.join(root, '.gitignore'), 'config/local.json\n');
    write(path.join(root, 'src/greet.js'), 'a\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'init']);
    const env = humanEnv(tempDir('sdlc-home-'));
    const cli = (args: string[]) => runCli(args, root, env);
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.gates.spec.required = false;
    write(file, stringify(config));
    expect(cli(['new', 'demo', '--json']).code).toBe(0);
    for (const [name, text] of Object.entries(FILES)) write(path.join(root, 'openspec/changes/demo', name), text);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'change']);
    expect(cli(['approve', 'intent', '--change', 'demo', '--json']).code).toBe(0);
    return { root, cli };
  }

  it('an ignored planned file that was never in git is not deleted by --reset', () => {
    const p = project();
    write(path.join(p.root, 'config/local.json'), '{"secret":1}\n');
    const r = p.cli(['rework', 'intent', '--change', 'demo', '--reason', 'other', '--note', 'n', '--reset', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(path.join(p.root, 'config/local.json'))).toBe(true);
  }, 180000);

});
