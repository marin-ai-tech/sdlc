import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { setLocale } from '../src/core/i18n.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir } from './helpers.js';

function context(mode: 'off' | 'warn' | 'block' = 'warn') {
  const root = tempDir('sdlc-policy-070-');
  const config = defaultConfig();
  config.enforcement.mode = mode;
  return { root, ctx: { paths: projectPaths(root), config } };
}

describe('openspec/backlog.md is changed only through the CLI', () => {
  it('agents cannot edit, write or patch the backlog file, with a reason that names the commands to use', () => {
    setLocale('en');
    const { root, ctx } = context();
    const calls = [
      normalizeToolCall('Edit', { file_path: path.join(root, 'openspec/backlog.md') }, root),
      normalizeToolCall('Write', { file_path: 'openspec/backlog.md' }, root),
      normalizeToolCall('edit', { filePath: 'openspec/backlog.md' }, root),
      normalizeToolCall('apply_patch', { input: '*** Begin Patch\n*** Update File: openspec/backlog.md\n' }, root),
    ];
    for (const call of calls) {
      const decision = evaluateToolCall(call, ctx);
      expect(decision, call.tool).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
      expect(decision.reason, call.tool).toMatch(/backlog\.md/);
      expect(decision.reason, call.tool).toMatch(/sdlc backlog (add|edit)/);
    }
  });

  it('negative: the other state files keep their own reason, without backlog advice', () => {
    setLocale('en');
    const { root, ctx } = context();
    for (const call of [
      normalizeToolCall('Edit', { file_path: 'openspec/changes/x/.sdlc.yaml' }, root),
      normalizeToolCall('Bash', { command: 'echo x >> openspec/.sdlc/log.jsonl' }, root),
    ]) {
      const decision = evaluateToolCall(call, ctx);
      expect(decision.reason, call.tool).toMatch(/approvals/);
      expect(decision.reason, call.tool).not.toMatch(/sdlc backlog/);
    }
  });

  it('agents cannot rewrite the backlog file from the shell', () => {
    const { root, ctx } = context();
    const commands = [
      'echo "### B9 [open] x" >> openspec/backlog.md',
      'sed -i "s/B2/B1/" openspec/backlog.md',
      'cp /tmp/reordered.md openspec/backlog.md',
      'python reorder.py > openspec/backlog.md',
    ];
    for (const command of commands) {
      const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
      expect(decision, command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('state files cannot be restored from git, written by PowerShell cmdlets, or edited with another letter case', () => {
    const { root, ctx } = context();
    const commands = [
      'git checkout HEAD~3 -- openspec/backlog.md',
      'git restore --source=HEAD~3 openspec/backlog.md',
      'Set-Content openspec/backlog.md -Value x',
      'Copy-Item reordered.md openspec/backlog.md',
      'Move-Item reordered.md openspec/roles.yaml -Force',
      'Out-File -FilePath openspec/changes/x/.sdlc.yaml',
    ];
    for (const command of commands) {
      const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
      expect(decision, command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
    for (const file of ['OPENSPEC/Backlog.md', 'openspec/Roles.yaml', 'openspec/changes/x/.SDLC.yaml']) {
      const decision = evaluateToolCall(normalizeToolCall('Edit', { file_path: file }, root), ctx);
      expect(decision, file).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
  });

  it('backslash and dot spellings, symlinks and patch renames do not reach the backlog file', () => {
    const { root, ctx } = context();
    for (const command of [
      'Set-Content openspec\\backlog.md x',
      'echo x >> openspec\\backlog.md',
      'echo x >> openspec/./backlog.md',
      'ln -s openspec/backlog.md notes.md',
    ]) {
      const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
      expect(decision, command).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    }
    const patch = '*** Begin Patch\n*** Update File: notes.md\n*** Move to: openspec/backlog.md\n@@\n-a\n+b\n*** End Patch\n';
    const decision = evaluateToolCall(normalizeToolCall('apply_patch', { input: patch }, root), ctx);
    expect(decision).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('protected and locked-test paths match whatever the letter case of the edited path', () => {
    const { root, ctx } = context();
    ctx.config.enforcement.protectedPaths = ['src/payments/**'];
    const decision = evaluateToolCall(normalizeToolCall('Edit', { file_path: 'SRC/Payments/pay.ts' }, root), ctx);
    expect(decision).toMatchObject({ decision: 'deny', rule: 'protected-path' });
  });

  it('negative: reading the backlog, the backlog commands and other openspec files stay allowed', () => {
    const { root, ctx } = context();
    const allowed = [
      normalizeToolCall('Read', { file_path: 'openspec/backlog.md' }, root),
      normalizeToolCall('Bash', { command: 'cat openspec/backlog.md' }, root),
      normalizeToolCall('Bash', { command: 'grep -n "### B" openspec/backlog.md' }, root),
      normalizeToolCall('Bash', { command: 'sdlc backlog add "Export" --outcome "csv export" --accept "a csv file"' }, root),
      normalizeToolCall('Bash', { command: 'sdlc backlog edit B2 --outcome "x" --accept "y"' }, root),
      normalizeToolCall('Write', { file_path: 'openspec/explorations/backlog-ideas.md' }, root),
      normalizeToolCall('Write', { file_path: 'docs/backlog.md' }, root),
    ];
    for (const call of allowed) {
      expect(evaluateToolCall(call, ctx).decision, `${call.tool} ${call.command ?? call.files}`).toBe('allow');
    }
  });

  it('negative: enforcement off allows the edit', () => {
    const { root, ctx } = context('off');
    const call = normalizeToolCall('Edit', { file_path: 'openspec/backlog.md' }, root);
    expect(evaluateToolCall(call, ctx).decision).toBe('allow');
  });
});

describe('sdlc adopt --apply is a person\'s decision', () => {
  it('agents cannot apply the adoption draft, whatever the flag order', () => {
    const { root, ctx } = context();
    for (const command of ['sdlc adopt --apply', 'sdlc adopt --json --apply', 'npx --no-install sdlc adopt --apply --json']) {
      const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
      expect(decision, command).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    }
  });

  it('global options, Windows shims and line continuations do not hide a human-only command', () => {
    const { root, ctx } = context();
    const commands = [
      'sdlc --locale en adopt --apply',
      'sdlc --locale=ru adopt --json --apply',
      'sdlc.cmd adopt --apply',
      'sdlc adopt \\\n  --apply',
      'sdlc --locale ru approve plan --change x',
      'sdlc.cmd approve plan --change x',
    ];
    for (const command of commands) {
      const decision = evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
      expect(decision, command).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    }
    for (const command of ['sdlc --locale en adopt --json', 'sdlc --locale ru status', 'sdlc --locale en approvals']) {
      expect(evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx).decision, command).toBe('allow');
    }
  });

  it('negative: agents may run the analysis, and --apply of other commands is not caught', () => {
    const { root, ctx } = context();
    for (const command of ['sdlc adopt', 'sdlc adopt --json', 'sdlc adopt && git diff --stat', 'sdlc layout adapt --apply']) {
      expect(evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx).decision, command).toBe('allow');
    }
  });
});
