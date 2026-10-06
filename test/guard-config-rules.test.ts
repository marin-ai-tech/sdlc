import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { assertKeepsGuard, guardWeakenings, type GuardSettings } from '../src/core/guard-setup.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { GUARD_FILE } from '../src/core/policy-guard.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/** B41, the pure parts: which paths are guard files, what weakens the guard, and the shell fallbacks. */

const NOW: GuardSettings = { mode: 'block', tools: ['claude', 'opencode'], cli: 'sdlc' };

describe('guard files', () => {
  it('are the root-relative configuration files, in any case', () => {
    const guard = ['openspec/sdlc.yaml', '.claude/settings.dev.json', '.opencode/opencode.jsonc', 'OPENCODE.JSON'];
    for (const rel of guard) {
      expect(GUARD_FILE.test(rel), rel).toBe(true);
    }
    for (const rel of ['src/opencode.json', 'docs/sdlc.yaml', '.claude/agents/x.md', 'openspec/config.yaml']) {
      expect(GUARD_FILE.test(rel), rel).toBe(false);
    }
  });
});

describe('guardWeakenings', () => {
  it('names a lower mode, a dropped tool, no hooks with claude, another cli', () => {
    expect(guardWeakenings(NOW, { mode: 'warn' })).toEqual(['--mode: block -> warn']);
    expect(guardWeakenings(NOW, { tools: ['opencode'] })).toEqual(['--tools: claude,opencode -> opencode']);
    expect(guardWeakenings(NOW, { tools: [] })).toEqual(['--tools: claude,opencode -> none']);
    expect(guardWeakenings(NOW, { hooks: false })).toEqual(['--no-hooks']);
    expect(guardWeakenings(NOW, { cli: 'true' })).toEqual(['--cli: sdlc -> true']);
  });

  it('negative: the same or a stronger setting, more tools, no hooks without claude', () => {
    expect(guardWeakenings(NOW, {})).toEqual([]);
    expect(guardWeakenings(NOW, { mode: 'block', tools: ['opencode', 'claude'], cli: 'sdlc' })).toEqual([]);
    expect(guardWeakenings(NOW, { hooks: true })).toEqual([]);
    expect(guardWeakenings({ ...NOW, mode: 'warn' }, { mode: 'block' })).toEqual([]);
    expect(guardWeakenings({ ...NOW, tools: ['opencode'] }, { hooks: false })).toEqual([]);
  });
});

describe('assertKeepsGuard', () => {
  const session = (agent: string | undefined) => ({ agent, knownTools: ['claude', 'opencode'], fix: 'run it' });
  const config = () => {
    const c = defaultConfig();
    c.enforcement.mode = 'block';
    c.tools = ['claude', 'opencode'];
    return c;
  };

  it('refuses a weakening request from an agent with agent_cannot_weaken_guard', () => {
    expect(() => assertKeepsGuard(config(), { mode: 'off' }, session('claude-code')))
      .toThrow(expect.objectContaining({ code: 'agent_cannot_weaken_guard', fix: 'run it' }));
  });

  it('negative: a person, a project that lets agents decide, and mode off are not refused', () => {
    expect(() => assertKeepsGuard(config(), { mode: 'off' }, session(undefined))).not.toThrow();
    const open = config();
    open.enforcement.forbidAgentApprovals = false;
    expect(() => assertKeepsGuard(open, { mode: 'off' }, session('claude-code'))).not.toThrow();
    const off = config();
    off.enforcement.mode = 'off';
    expect(() => assertKeepsGuard(off, { tools: [] }, session('claude-code'))).not.toThrow();
  });
});

describe('the guard-config rule, beyond the acceptance cases', () => {
  function project() {
    const root = tempDir('sdlc-guard-rules-');
    write(path.join(root, '.mcp.json'), '{}\n');
    write(path.join(root, '.claude/settings.json'), '{}\n');
    write(path.join(root, 'src/opencode.json'), '{}\n');
    const config = defaultConfig();
    config.enforcement.mode = 'warn';
    config.enforcement.requireApprovedPlan = false;
    const ctx = { paths: projectPaths(root), config };
    const shell = (command: string, cwd = root) => evaluateToolCall(normalizeToolCall('Bash', { command }, cwd), ctx);
    return { root, shell };
  }

  it('follows the directory: the same name elsewhere is not a guard file, ../ back to the root is', () => {
    const p = project();
    expect(p.shell('echo {} > opencode.json', path.join(p.root, 'src')).decision).toBe('allow');
    expect(p.shell('echo {} > ../.mcp.json', path.join(p.root, 'src'))).toMatchObject({ rule: 'guard-config' });
  });

  it('denies the path text when the directory cannot be told or the path starts at a variable', () => {
    const p = project();
    expect(p.shell('cd "$DIR" && rm .mcp.json')).toMatchObject({ rule: 'guard-config' });
    expect(p.shell('rm "$PWD/.mcp.json"')).toMatchObject({ rule: 'guard-config' });
  });

  it('denies a write through a symbolic link that points at a guard file not created yet', () => {
    const p = project();
    let linked = true;
    try {
      fs.symlinkSync(path.join(p.root, '.claude', 'settings.local.json'), path.join(p.root, 'notes.json'));
    } catch {
      linked = false; // Windows without the symlink privilege: nothing to check.
    }
    if (linked) expect(p.shell('echo {} > notes.json')).toMatchObject({ rule: 'guard-config' });
  });
});
