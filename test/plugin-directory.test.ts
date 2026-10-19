import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderClaudePlugin } from '../src/integrations/plugin.js';
import { humanEnv, REPO_ROOT, runCli, tempDir } from './helpers.js';

/**
 * The Claude plugin directory refuses a hook whose command the shell computes (a command substitution, a variable
 * other than ${CLAUDE_PLUGIN_ROOT}, an inline program): each command must run a file inside the plugin, spelled
 * as ${CLAUDE_PLUGIN_ROOT}/<file>. It follows plain shell scripts. The listing icon is a square PNG at
 * .claude-plugin/icon.png, 512 to 2048 px, under 2 MB, and can be set only once.
 */

const ROOT_REF = '${CLAUDE_PLUGIN_ROOT}';
const files = renderClaudePlugin('sdlc');

function file(rel: string) {
  return files.find((f) => f.path === rel);
}

function hookCommands(): { event: string; command: string }[] {
  const hooks = JSON.parse(String(file('hooks/hooks.json')!.content)).hooks as Record<string, { hooks: { command: string }[] }[]>;
  return Object.entries(hooks).flatMap(([event, groups]) =>
    groups.flatMap((group) => group.hooks.map((handler) => ({ event, command: handler.command }))));
}

/** The plugin files a hook command names through ${CLAUDE_PLUGIN_ROOT}. */
function namedFiles(command: string): string[] {
  return [...command.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"'\s]+)/g)].map((m) => m[1]!);
}

/** The words a shell would expand: $( ... ), backticks and every $NAME or ${NAME} except ${CLAUDE_PLUGIN_ROOT}. */
function computed(text: string): string[] {
  const rest = text.split(ROOT_REF).join('');
  return [...rest.matchAll(/\$\(|`|\$\{?[A-Za-z_][A-Za-z0-9_]*/g)].map((m) => m[0]);
}

function pngSize(png: Buffer): { width: number; height: number } {
  expect(png.subarray(0, 8).toString('hex'), 'PNG signature').toBe('89504e470d0a1a0a');
  expect(png.subarray(12, 16).toString('latin1'), 'first chunk').toBe('IHDR');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

describe('the plugin passes the Claude plugin directory checks', () => {
  it('the PreToolUse hook runs a script inside the plugin', () => {
    const pre = hookCommands().filter((h) => h.event === 'PreToolUse');
    expect(pre.map((h) => h.command)).toEqual([`"${ROOT_REF}/hooks/pre-tool.sh"`]);
  });

  it('negative: no hook command is computed by the shell or carries an inline program', () => {
    for (const { event, command } of hookCommands()) {
      expect(computed(command), `${event}: ${command}`).toEqual([]);
      expect(command, event).not.toMatch(/\b(sh|bash|node|python3?|perl)\s+-[ce]\b/);
    }
    const raw = String(file('hooks/hooks.json')!.content);
    expect(raw).not.toContain('in=$(cat)');
    expect(raw).not.toContain('$(');
  });

  it('every file a hook names is in the plugin, executable, and a plain shell script without computed commands', () => {
    const named = hookCommands().flatMap((h) => namedFiles(h.command));
    expect(named).toContain('hooks/pre-tool.sh');
    for (const rel of named) {
      const script = file(rel);
      expect(script, rel).toBeDefined();
      expect(script!.executable, `${rel} executable`).toBe(true);
      const text = String(script!.content);
      expect(text.startsWith('#!/bin/sh\n'), rel).toBe(true);
      expect(text, rel).not.toContain('$(');
      expect(text, rel).not.toContain('`');
    }
  });

  it('negative: only scripts are executable, and only files a hook names', () => {
    const named = new Set(hookCommands().flatMap((h) => namedFiles(h.command)));
    const executable = files.filter((f) => f.executable).map((f) => f.path);
    expect(executable.sort()).toEqual([...named].sort());
  });

  it('carries the listing icon: a square PNG of 512 to 2048 px under 2 MB, the one in assets/plugin', () => {
    const icon = file('.claude-plugin/icon.png');
    expect(icon, 'icon').toBeDefined();
    expect(Buffer.isBuffer(icon!.content)).toBe(true);
    const png = icon!.content as Buffer;
    const { width, height } = pngSize(png);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(512);
    expect(width).toBeLessThanOrEqual(2048);
    expect(png.length).toBeLessThan(2 * 1024 * 1024);
    expect(png.equals(fs.readFileSync(path.join(REPO_ROOT, 'assets', 'plugin', 'icon.png')))).toBe(true);
  });

  it('plugin build writes the icon byte for byte and the hook script as an executable file', () => {
    const home = tempDir('sdlc-plugin-home-');
    const out = path.join(tempDir('sdlc-plugin-out-'), 'plugin');
    const result = runCli(['plugin', 'build', out, '--json'], home, humanEnv(home));
    expect(result.code, result.stderr).toBe(0);
    const icon = fs.readFileSync(path.join(out, '.claude-plugin', 'icon.png'));
    expect(icon.equals(fs.readFileSync(path.join(REPO_ROOT, 'assets', 'plugin', 'icon.png')))).toBe(true);
    const script = path.join(out, 'hooks', 'pre-tool.sh');
    expect(fs.readFileSync(script, 'utf-8')).toBe(String(file('hooks/pre-tool.sh')!.content));
    if (process.platform !== 'win32') expect(fs.statSync(script).mode & 0o111).toBe(0o111);
  });

  it('negative: plugin build keeps the icon and the script when it rebuilds over its own output', () => {
    const home = tempDir('sdlc-plugin-home-');
    const out = path.join(tempDir('sdlc-plugin-out-'), 'plugin');
    expect(runCli(['plugin', 'build', out], home, humanEnv(home)).code).toBe(0);
    const again = runCli(['plugin', 'build', out], home, humanEnv(home));
    expect(again.code, again.stderr).toBe(0);
    expect(fs.existsSync(path.join(out, '.claude-plugin', 'icon.png'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'hooks', 'pre-tool.sh'))).toBe(true);
  });

  it('negative: a tracked hook script in plugin/ is not committed without its executable bit', () => {
    const listed = spawnSync('git', ['ls-files', '-s', '--', 'plugin'], { cwd: REPO_ROOT, encoding: 'utf-8' });
    expect(listed.status).toBe(0);
    const scripts = listed.stdout.split('\n').filter((line) => line.endsWith('.sh'));
    for (const line of scripts) expect(line.slice(0, 6), line).toBe('100755');
  });
});
