import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.14.1 (B83): Qwen Code and GigaCode as tools, one adapter for the Qwen family. Formats from Qwen Code's
 * documentation and sources (main, 0.25.0) and GigaCode's documentation; no live installation was available.
 * Hooks are Claude Code's format in `<dir>/settings.json`; tools are `run_shell_command`, `write_file`, `edit`;
 * `permissions.deny` holds even in YOLO mode; agent shells carry `QWEN_CODE=1`.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(tools = 'qwen', before?: (root: string) => void) {
  const root = tempDir('sdlc-qwen-');
  const home = tempDir('sdlc-home-');
  const env = humanEnv(home);
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  before?.(root);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const init = cli(['init', '--tools', tools, '--mode', 'block', '--mcp', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const hook = (event: string, input: Record<string, unknown>, agent = 'qwen', extra: NodeJS.ProcessEnv = {}) => {
    const payload = { session_id: 's1', cwd: root, ...input };
    const r = cli(['hook', event, '--agent', agent], extra, JSON.stringify(payload));
    return r.stdout.trim() ? JSON.parse(r.stdout) : {};
  };
  const decision = (out: { hookSpecificOutput?: { permissionDecision?: string } }) =>
    out.hookSpecificOutput?.permissionDecision ?? 'allow';
  const tool = (name: string, input: Record<string, unknown>, agent = 'qwen', extra: NodeJS.ProcessEnv = {}) =>
    decision(hook('pre-tool', { hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }, agent, extra));
  /** The user folders are under a temporary home for these calls only (git keeps the real one). */
  const homeEnv = { HOME: home, USERPROFILE: home };
  return { root, home, homeEnv, env, cli, hook, tool, file: (rel: string) => path.join(root, rel) };
}

const settings = (p: { file: (rel: string) => string }, dir = '.qwen') =>
  JSON.parse(read(p.file(`${dir}/settings.json`)));

describe('B83: sdlc init --tools qwen', () => {
  it('writes skills, commands, subagents, hooks, the deny rules and the MCP server', () => {
    const p = project();
    expect(read(p.file('.qwen/skills/sdlc-status/SKILL.md'))).toMatch(/^---\nname: sdlc-status\n/);
    expect(read(p.file('.qwen/commands/sdlc-status.md'))).toContain('sdlc-status');
    const verifier = read(p.file('.qwen/agents/sdlc-verifier.md'));
    expect(verifier).toMatch(/^name: sdlc-verifier$/m);
    expect(verifier).toMatch(/^disallowedTools:.*write_file/m);
    const s = settings(p);
    for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
      expect(JSON.stringify(s.hooks[event]), event).toContain('hook');
      expect(JSON.stringify(s.hooks[event]), event).toContain('--agent qwen');
    }
    expect(s.permissions.deny).toContain('Bash(sdlc approve *)');
    expect(s.permissions.deny).toContain('Bash(sdlc tests unlock *)');
    expect(s.mcpServers.sdlc.command).toBe('sdlc');
    const manifest = Object.keys(JSON.parse(read(p.file('openspec/.sdlc/manifest.json'))).files);
    for (const file of ['.qwen/skills/sdlc-status/SKILL.md', '.qwen/commands/sdlc-status.md',
      '.qwen/agents/sdlc-verifier.md']) {
      expect(manifest, file).toContain(file);
    }
    expect(manifest).not.toContain('.qwen/settings.json');
  }, 180000);

  it("keeps the person's own settings, and uninstall removes only sdlc's entries", () => {
    const own = { model: { name: 'qwen3-coder' }, permissions: { deny: ['Bash(rm -rf *)'] },
      hooks: { PreToolUse: [{ matcher: 'write_file', hooks: [{ type: 'command', command: 'node mine.js' }] }] },
      mcpServers: { mine: { command: 'mine' } } };
    const p = project('qwen', (root) => write(path.join(root, '.qwen/settings.json'), JSON.stringify(own)));
    const s = settings(p);
    expect(s.model.name).toBe('qwen3-coder');
    expect(s.permissions.deny).toContain('Bash(rm -rf *)');
    expect(JSON.stringify(s.hooks.PreToolUse)).toContain('node mine.js');
    expect(s.mcpServers.mine.command).toBe('mine');
    expect(p.cli(['uninstall', '--json']).code).toBe(0);
    const after = settings(p);
    expect(after.model.name).toBe('qwen3-coder');
    expect(after.permissions.deny).toEqual(['Bash(rm -rf *)']);
    expect(JSON.stringify(after.hooks ?? {})).toContain('node mine.js');
    expect(JSON.stringify(after)).not.toContain('--agent qwen');
    expect(after.mcpServers.sdlc).toBeUndefined();
    expect(fs.existsSync(p.file('.qwen/skills/sdlc-status/SKILL.md'))).toBe(false);
  }, 180000);

  it('negative: without qwen or gigacode in the tools nothing is written under .qwen/ or .gigacode/', () => {
    const p = project('claude');
    expect(fs.existsSync(p.file('.qwen'))).toBe(false);
    expect(fs.existsSync(p.file('.gigacode'))).toBe(false);
  }, 180000);
});

describe('B83: GigaCode, the same adapter in .gigacode/ (experimental)', () => {
  it('writes its files under .gigacode/ and answers its own hooks', () => {
    const p = project('gigacode');
    expect(read(p.file('.gigacode/skills/sdlc-status/SKILL.md'))).toMatch(/^---\nname: sdlc-status\n/);
    expect(fs.existsSync(p.file('.gigacode/commands/sdlc-status.md'))).toBe(true);
    expect(fs.existsSync(p.file('.gigacode/agents/sdlc-verifier.md'))).toBe(true);
    const s = settings(p, '.gigacode');
    expect(JSON.stringify(s.hooks.PreToolUse)).toContain('--agent gigacode');
    expect(s.permissions.deny).toContain('Bash(sdlc approve *)');
    expect(s.mcpServers.sdlc.command).toBe('sdlc');
    expect(fs.existsSync(p.file('.qwen'))).toBe(false);
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    expect(p.tool('write_file', { file_path: 'src/app.js', content: 'x' }, 'gigacode')).toBe('deny');
    const doctor = p.cli(['doctor', '--json']).json();
    const check = doctor.checks.find((c: { check: string }) => c.check === 'gigacode');
    expect(check).toBeDefined();
    expect(String(check.message)).toMatch(/experimental/i);
  }, 180000);
});

describe('B83: the hooks answer Qwen Code', () => {
  it('writing code before the plan is denied (write_file, edit, run_shell_command); the change folder is not', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    expect(p.tool('write_file', { file_path: 'src/app.js', content: 'x' })).toBe('deny');
    expect(p.tool('edit', { file_path: p.file('src/app.js'), old_string: 'a', new_string: 'b' })).toBe('deny');
    expect(p.tool('run_shell_command', { command: 'echo x > src/app.js' })).toBe('deny');
    expect(p.tool('write_file', { file_path: 'openspec/changes/demo/intent.md', content: INTENT })).toBe('allow');
    expect(p.tool('run_shell_command', { command: 'type src\\app.js' })).toBe('allow');
    expect(p.tool('read_file', { absolute_path: p.file('src/app.js') })).toBe('allow');
  }, 180000);

  it("a person's decision, Qwen's settings and clearing the Qwen marker are denied", () => {
    const p = project();
    expect(p.tool('run_shell_command', { command: 'sdlc approve intent' })).toBe('deny');
    expect(p.tool('write_file', { file_path: '.qwen/settings.json', content: '{}' })).toBe('deny');
    expect(p.tool('edit', { file_path: '.qwen/agents/sdlc-verifier.md', old_string: 'a', new_string: 'b' }))
      .toBe('deny');
    expect(p.tool('run_shell_command', { command: 'set QWEN_CODE=&& sdlc status' })).toBe('deny');
    const userFile = (rel: string) => p.tool('write_file', { file_path: path.join(p.home, rel), content: '{}' },
      'qwen', p.homeEnv);
    expect(userFile('.qwen/settings.json')).toBe('deny');
    expect(userFile('.gigacode/settings.json')).toBe('deny');
  }, 180000);

  it('negative: other files under the user folders stay writable', () => {
    const p = project();
    const input = { file_path: path.join(p.home, '.qwen/QWEN.md'), content: 'x' };
    expect(p.tool('write_file', input, 'qwen', p.homeEnv)).toBe('allow');
  }, 180000);

  it('the session start gives Qwen Code additional context', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    const start = p.hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' });
    expect(String(start.hookSpecificOutput?.additionalContext)).toContain('demo');
  }, 180000);
});

describe('B83: a Qwen Code agent session', () => {
  it('QWEN_CODE=1 refuses person decisions; doctor says to trust the folder', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    write(p.file('openspec/changes/demo/intent.md'), INTENT);
    const refused = p.cli(['approve', 'intent', '--change', 'demo', '--json'], { QWEN_CODE: '1' });
    expect(refused.json().status[0].code).toBe('agent_cannot_approve');
    const doctor = p.cli(['doctor', '--json']).json();
    const check = doctor.checks.find((c: { check: string }) => c.check === 'qwen');
    expect(check).toBeDefined();
    expect(String(check.message)).toMatch(/trust/i);
  }, 180000);

  it('a commit from a Qwen Code agent session carries SDLC-Agent: qwen', () => {
    const p = project();
    write(p.file('a.txt'), 'a\n');
    const env = { ...p.env, QWEN_CODE: '1' };
    execFileSync('git', ['add', '-A'], { cwd: p.root, env });
    execFileSync('git', ['commit', '-q', '-m', 'add a'], { cwd: p.root, env });
    expect(execFileSync('git', ['log', '-1', '--format=%B'], { cwd: p.root, encoding: 'utf-8' }))
      .toContain('SDLC-Agent: qwen');
  }, 180000);
});

describe('B83 follow-up: sdlc recognizes its deny entries whatever the cli', () => {
  for (const cli of ['node C:/tools/sdlc/bin/sdlc.js', 'sdlc.cmd', 'npx --no-install sdlc']) {
    it(`uninstall leaves no deny entry of cli "${cli}"`, () => {
      const p = project('qwen', (root) => write(path.join(root, '.qwen/settings.json'), '{"model": {"name": "m"}}'));
      const config = read(p.file('openspec/sdlc.yaml')).replace(/^cli: .*$/m, `cli: ${cli}`);
      write(p.file('openspec/sdlc.yaml'), config);
      expect(p.cli(['update', '--json']).code).toBe(0);
      expect(settings(p).permissions.deny).toContain(`Bash(${cli} approve *)`);
      expect(p.cli(['uninstall', '--json']).code).toBe(0);
      const after = settings(p);
      expect(after.permissions).toBeUndefined();
      expect(after.model.name).toBe('m');
    }, 180000);
  }

  it("negative: the person's own deny entries that mention sdlc stay", () => {
    const deny = ['Bash(sdlc archive *)', 'Bash(rm -rf openspec)', 'Bash(approve-all *)'];
    const own = { permissions: { deny } };
    const p = project('qwen', (root) => write(path.join(root, '.qwen/settings.json'), JSON.stringify(own)));
    expect(p.cli(['uninstall', '--json']).code).toBe(0);
    expect(settings(p).permissions.deny).toEqual(deny);
  }, 180000);
});
