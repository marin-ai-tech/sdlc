import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * 0.14.7 (B87): Cursor's user-level hooks (`~/.cursor/hooks.json`) apply to every project, so an agent could switch
 * sdlc's hooks off there. They are the guard's configuration, like Claude Code's, OpenCode's, Codex's, Qwen Code's and
 * GigaCode's user settings (B42): an agent's edits and shell writes of the file are denied (rule `guard-config`, also
 * in warn mode). Other files under ~/.cursor stay writable.
 */

function project(mode: 'warn' | 'block' = 'warn') {
  const home = tempDir('sdlc-cursor-home-');
  const root = tempDir('sdlc-cursor-user-guard-');
  write(path.join(root, 'src/app.js'), 'a\n');
  const config = defaultConfig();
  config.enforcement.mode = mode;
  config.enforcement.requireApprovedPlan = false;
  const env = { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config') };
  const ctx = { paths: projectPaths(root), config, env };
  const edit = (file: string) => evaluateToolCall(normalizeToolCall('Write', { file_path: file }, root), ctx);
  const shell = (command: string, tool = 'Bash') => evaluateToolCall(normalizeToolCall(tool, { command }, root), ctx);
  return { home, edit, shell, posixHome: home.replace(/\\/g, '/') };
}

const DENY = { decision: 'deny', rule: 'guard-config' };

describe("B87: Cursor's user-level hooks", () => {
  it('cannot be edited or created by an agent, also in warn mode', () => {
    const p = project('warn');
    expect(p.edit(path.join(p.home, '.cursor', 'hooks.json'))).toMatchObject(DENY);
  });

  it('cannot be written from the shell', () => {
    const p = project();
    expect(p.shell(`echo '{}' > ${p.posixHome}/.cursor/hooks.json`)).toMatchObject(DENY);
    expect(p.shell("printf '{}' > ~/.cursor/hooks.json")).toMatchObject(DENY);
    expect(p.shell('rm ~/.cursor/hooks.json')).toMatchObject(DENY);
    const ps = "Set-Content $env:USERPROFILE\\.cursor\\hooks.json '{}'";
    expect(p.shell(ps, 'PowerShell'), ps).toMatchObject(DENY);
  });

  it('negative: other files under ~/.cursor and reads stay allowed', () => {
    const p = project();
    expect(p.edit(path.join(p.home, '.cursor', 'rules', 'mine.mdc')).decision).not.toBe('deny');
    expect(p.shell('cat ~/.cursor/hooks.json').decision).not.toBe('deny');
  });
});
