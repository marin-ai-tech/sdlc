import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, type EnforcementMode } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { harnessHooks } from '../src/integrations/settings.js';
import { tempDir, write } from './helpers.js';

/**
 * B41: the files that switch the guard on are the guard's own configuration. An agent that could edit them could
 * turn every rule off (`enforcement.mode: off`), drop the hooks or disarm the OpenCode plugin. Their edits and shell
 * writes are denied as a hard rule (`guard-config`, also in `warn`); the sdlc CLI still writes them.
 */

const GUARD_FILES = [
  'openspec/sdlc.yaml',
  'openspec/.sdlc/manifest.json',
  '.claude/settings.json',
  '.claude/settings.local.json',
  '.opencode/plugins/sdlc.js',
  '.mcp.json',
  'opencode.json',
  'opencode.jsonc',
];

function project(mode: EnforcementMode = 'warn') {
  const root = tempDir('sdlc-guard-');
  for (const file of GUARD_FILES) write(path.join(root, file), '{}\n');
  write(path.join(root, 'src/app.js'), 'a\n');
  const config = defaultConfig();
  config.enforcement.mode = mode;
  config.enforcement.requireApprovedPlan = false;
  const ctx = { paths: projectPaths(root), config };
  const edit = (file: string, tool = 'Edit') =>
    evaluateToolCall(normalizeToolCall(tool, { file_path: path.join(root, file) }, root), ctx);
  const shell = (command: string, tool = 'Bash') =>
    evaluateToolCall(normalizeToolCall(tool, { command }, root), ctx);
  return { root, edit, shell };
}

describe('the guard configuration', () => {
  it('cannot be edited or created by an agent, also in warn mode', () => {
    const p = project('warn');
    for (const file of GUARD_FILES) {
      expect(p.edit(file), file).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    }
    // A new local settings file can carry `disableAllHooks`: creating it is an edit of the guard.
    fs.rmSync(path.join(p.root, '.claude/settings.local.json'));
    expect(p.edit('.claude/settings.local.json', 'Write')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    expect(p.edit('OpenSpec/SDLC.yaml')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it('names the file and sends the agent to a person', () => {
    const reason = project().edit('openspec/sdlc.yaml').reason ?? '';
    expect(reason).toContain('openspec/sdlc.yaml');
    expect(reason).toMatch(/person/i);
  });

  it('cannot be written, deleted or replaced from the shell', () => {
    const p = project('warn');
    const commands = [
      "sed -i 's/mode: warn/mode: off/' openspec/sdlc.yaml",
      'echo "enforcement: {mode: off}" >> openspec/sdlc.yaml',
      'rm .claude/settings.json',
      'cd .claude && rm settings.json',
      'rm .claude/sett*',
      'rm -rf .claude',
      'rm -rf .opencode/plugins',
      'cp /tmp/empty.js .opencode/plugins/sdlc.js',
      'git checkout HEAD~3 -- openspec/sdlc.yaml',
      "printf '{}' > .mcp.json",
      'mv opencode.json opencode.json.bak',
      'ln -f openspec/sdlc.yaml notes.yaml',
    ];
    for (const command of commands) {
      expect(p.shell(command), command).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    }
  });

  it('cannot be written through the PowerShell tool', () => {
    const p = project('warn');
    const commands = [
      "Set-Content openspec/sdlc.yaml 'enforcement: {mode: off}'",
      'Remove-Item .opencode/plugins/sdlc.js',
      "Out-File -FilePath .claude/settings.local.json -InputObject '{}'",
    ];
    for (const command of commands) {
      expect(p.shell(command, 'PowerShell'), command).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    }
  });

  it('cannot be edited through a hard link', () => {
    const p = project('warn');
    fs.linkSync(path.join(p.root, 'openspec/sdlc.yaml'), path.join(p.root, 'notes.yaml'));
    expect(p.edit('notes.yaml')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });

  it('negative: reading it, other files and files of the same name elsewhere stay allowed', () => {
    const p = project('warn');
    for (const file of ['src/app.js', 'src/opencode.json', 'docs/sdlc.yaml', '.claude/agents/reviewer.md',
      '.opencode/plugins/other.js', 'openspec/config.yaml']) {
      expect(p.edit(file).decision, file).toBe('allow');
    }
    for (const command of ['cat openspec/sdlc.yaml', 'grep mode openspec/sdlc.yaml', 'ls .claude',
      'echo ok > src/out.txt', 'rm src/app.js']) {
      expect(p.shell(command).decision, command).toBe('allow');
    }
  });

  it('negative: with enforcement off a person has switched the guard off, and nothing is denied', () => {
    const p = project('off');
    expect(p.edit('openspec/sdlc.yaml').decision).toBe('allow');
    expect(p.shell('rm .claude/settings.json').decision).toBe('allow');
  });
});

describe('the Claude Code PreToolUse matcher', () => {
  it('also covers the PowerShell tool, so its writes reach the rules', () => {
    const tools = String(harnessHooks('sdlc').PreToolUse[0].matcher).split('|');
    expect(tools).toEqual(expect.arrayContaining(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell']));
  });
});
