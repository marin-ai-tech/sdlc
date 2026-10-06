import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, type EnforcementMode } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { humanEnv, runCli, tempDir, write } from './helpers.js';

/**
 * B42: user-level agent settings switch the hooks off for every project (`disableAllHooks` in
 * `~/.claude/settings.json`; the global OpenCode config). They are the guard's configuration too: an agent's edits
 * and shell writes of them are denied (rule `guard-config`, also in `warn`), and `sdlc doctor` warns when a setting
 * already disables the hooks.
 */

interface Homes {
  home: string;
  env: NodeJS.ProcessEnv;
}

function homes(extra: NodeJS.ProcessEnv = {}): Homes {
  const home = tempDir('sdlc-user-home-');
  return { home, env: { HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: path.join(home, '.config'), ...extra } };
}

function project(h: Homes, mode: EnforcementMode = 'warn') {
  const root = tempDir('sdlc-user-guard-');
  write(path.join(root, 'src/app.js'), 'a\n');
  const config = defaultConfig();
  config.enforcement.mode = mode;
  config.enforcement.requireApprovedPlan = false;
  const ctx = { paths: projectPaths(root), config, env: h.env };
  const edit = (file: string, tool = 'Edit') =>
    evaluateToolCall(normalizeToolCall(tool, { file_path: file }, root), ctx);
  const shell = (command: string, tool = 'Bash') =>
    evaluateToolCall(normalizeToolCall(tool, { command }, root), ctx);
  return { root, edit, shell };
}

const DENY = { decision: 'deny', rule: 'guard-config' };

describe('user-level agent settings', () => {
  it('cannot be edited or created by an agent, also in warn mode', () => {
    const h = homes();
    write(path.join(h.home, '.claude/settings.json'), '{}\n');
    const p = project(h);
    expect(p.edit(path.join(h.home, '.claude/settings.json'))).toMatchObject(DENY);
    expect(p.edit(path.join(h.home, '.config/opencode/opencode.json'), 'Write')).toMatchObject(DENY);
    expect(p.edit(path.join(h.home, '.config/opencode/opencode.jsonc'), 'Write')).toMatchObject(DENY);
  });

  it('follow CLAUDE_CONFIG_DIR, XDG_CONFIG_HOME and OPENCODE_CONFIG', () => {
    const other = tempDir('sdlc-user-other-');
    const h = homes({
      CLAUDE_CONFIG_DIR: path.join(other, 'claude'),
      XDG_CONFIG_HOME: path.join(other, 'xdg'),
      OPENCODE_CONFIG: path.join(other, 'team/opencode.json'),
    });
    const p = project(h);
    expect(p.edit(path.join(other, 'claude/settings.json'), 'Write')).toMatchObject(DENY);
    expect(p.edit(path.join(other, 'xdg/opencode/opencode.json'), 'Write')).toMatchObject(DENY);
    expect(p.edit(path.join(other, 'team/opencode.json'), 'Write')).toMatchObject(DENY);
  });

  it('cannot be written from the shell', () => {
    const h = homes();
    const p = project(h);
    const home = h.home.replace(/\\/g, '/');
    const commands = [
      `echo '{"disableAllHooks": true}' > ~/.claude/settings.json`,
      `printf '{}' > "$HOME/.claude/settings.json"`,
      `rm ${home}/.claude/settings.json`,
      `cp /tmp/x.json ${home}/.config/opencode/opencode.json`,
    ];
    for (const command of commands) expect(p.shell(command), command).toMatchObject(DENY);
    const ps = "Set-Content $env:USERPROFILE\\.claude\\settings.json '{\"disableAllHooks\": true}'";
    expect(p.shell(ps, 'PowerShell'), ps).toMatchObject(DENY);
  });

  it('negative: other files in the user folders, reads, and mode off stay allowed', () => {
    const h = homes();
    const p = project(h);
    for (const file of ['.claude/CLAUDE.md', '.claude/projects/x/memory/note.md', 'notes/settings.json',
      '.config/opencode/agents/reviewer.md']) {
      expect(p.edit(path.join(h.home, file)).decision, file).toBe('allow');
    }
    expect(p.shell('cat ~/.claude/settings.json').decision).toBe('allow');
    const off = project(h, 'off');
    expect(off.edit(path.join(h.home, '.claude/settings.json')).decision).toBe('allow');
  });
});

describe('sdlc doctor', () => {
  function doctor(setup: (home: string, root: string) => void) {
    const h = homes();
    const root = tempDir('sdlc-user-doctor-');
    const env = humanEnv(tempDir('sdlc-home-'), h.env);
    delete env.CLAUDE_CONFIG_DIR;
    delete env.OPENCODE_CONFIG;
    expect(runCli(['init', '--tools', 'claude', '--json'], root, env).code).toBe(0);
    setup(h.home, root);
    const r = runCli(['doctor', '--json'], root, env);
    return (r.json().checks as Array<{ status: string; message: string }>)
      .filter((c) => c.status !== 'ok' && /disableAllHooks/.test(c.message));
  }

  it('warns when user or local settings switch the hooks off', () => {
    const user = doctor((home) => write(path.join(home, '.claude/settings.json'), '{"disableAllHooks": true}\n'));
    expect(user).toHaveLength(1);
    expect(user[0].status).toBe('warn');
    const local = doctor((_, root) => write(path.join(root, '.claude/settings.local.json'), '{"disableAllHooks": true}\n'));
    expect(local).toHaveLength(1);
  }, 120000);

  it('negative: no warning when the hooks are on', () => {
    expect(doctor((home) => write(path.join(home, '.claude/settings.json'), '{"disableAllHooks": false}\n'))).toEqual([]);
    expect(doctor(() => undefined)).toEqual([]);
  }, 120000);
});
