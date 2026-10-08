import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.13.0 (docs/ru/28, B80): Cursor IDE as a tool. `sdlc init --tools cursor` writes skills, thin commands, subagents,
 * a rule, the MCP server and Cursor's own `.cursor/hooks.json`; the hook dispatcher reads Cursor's input and answers
 * in Cursor's format; `CURSOR_AGENT=1` is an agent session; the Cursor files are guarded like the other tools' files.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(tools = 'cursor') {
  const root = tempDir('sdlc-cursor-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const init = cli(['init', '--tools', tools, '--mode', 'block', '--mcp', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const hook = (event: string, input: Record<string, unknown>) => {
    const r = cli(['hook', event, '--agent', 'cursor'], {}, JSON.stringify({ cwd: root, workspace_roots: [root], ...input }));
    return r.stdout.trim() ? JSON.parse(r.stdout) : {};
  };
  return { root, env, cli, hook, file: (rel: string) => path.join(root, rel) };
}

describe('B80: sdlc init --tools cursor', () => {
  it('writes the Cursor files and records them in the manifest', () => {
    const p = project();
    const hooks = JSON.parse(read(p.file('.cursor/hooks.json')));
    expect(hooks.version).toBe(1);
    for (const event of ['sessionStart', 'preToolUse', 'beforeShellExecution', 'stop']) {
      expect(JSON.stringify(hooks.hooks[event]), event).toContain('--agent cursor');
    }
    expect(hooks.hooks.preToolUse.some((entry: { failClosed?: boolean }) => entry.failClosed === true)).toBe(true);
    expect(read(p.file('.cursor/skills/sdlc-status/SKILL.md'))).toMatch(/^---\nname: sdlc-status\n/);
    expect(fs.existsSync(p.file('.cursor/commands/sdlc-status.md'))).toBe(true);
    expect(read(p.file('.cursor/agents/sdlc-verifier.md'))).toMatch(/readonly: true/);
    expect(read(p.file('.cursor/rules/sdlc.mdc'))).toMatch(/alwaysApply: true/);
    expect(JSON.parse(read(p.file('.cursor/mcp.json'))).mcpServers.sdlc).toBeDefined();
    const manifest = JSON.parse(read(p.file('openspec/.sdlc/manifest.json')));
    expect(Object.keys(manifest.files)).toContain('.cursor/skills/sdlc-status/SKILL.md');
    expect(Object.keys(manifest.files)).toContain('.cursor/rules/sdlc.mdc');
  }, 180000);

  it('negative: without cursor in the tools nothing is written under .cursor/', () => {
    const p = project('claude');
    expect(fs.existsSync(p.file('.cursor'))).toBe(false);
  }, 180000);
});

describe('B80: the hooks answer Cursor', () => {
  it('a code edit before the plan is approved is denied; an edit of the change folder is allowed', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    const denied = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Write',
      tool_input: { file_path: p.file('src/app.js'), content: 'x' } });
    expect(denied.permission).toBe('deny');
    expect(String(denied.agent_message)).toContain('sdlc:plan-gate');
    const allowed = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Write',
      tool_input: { file_path: p.file('openspec/changes/demo/intent.md'), content: INTENT } });
    expect(allowed.permission).toBe('allow');
  }, 180000);

  it('a shell command that takes a person decision is denied; a guarded Cursor file cannot be edited', () => {
    const p = project();
    const shell = p.hook('pre-tool', { hook_event_name: 'beforeShellExecution', command: 'sdlc approve intent' });
    expect(shell.permission).toBe('deny');
    const guarded = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Write',
      tool_input: { file_path: p.file('.cursor/hooks.json'), content: '{}' } });
    expect(guarded.permission).toBe('deny');
    expect(String(guarded.agent_message)).toContain('sdlc:guard-config');
  }, 180000);

  it('the session start gives Cursor additional context', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    const start = p.hook('session-start', { hook_event_name: 'sessionStart' });
    expect(String(start.additional_context)).toContain('demo');
  }, 180000);
});

// Review of 0.13.0: bypasses found by the independent review, each must now be denied.
describe('B80: Cursor payloads that tried to slip through', () => {
  it('clearing CURSOR_AGENT is the agent-marker rule; a cwd outside the project still finds it', () => {
    const p = project();
    const unset = p.hook('pre-tool', { hook_event_name: 'beforeShellExecution', command: 'unset CURSOR_AGENT; ./go.sh' });
    expect(unset.permission).toBe('deny');
    expect(String(unset.agent_message)).toContain('sdlc:agent-marker');
    const outside = tempDir('sdlc-cursor-elsewhere-');
    const approve = p.hook('pre-tool', { hook_event_name: 'beforeShellExecution', command: 'sdlc approve intent',
      cwd: outside, workspace_roots: [p.root] });
    expect(approve.permission).toBe('deny');
    const config = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Write', cwd: outside,
      workspace_roots: [p.root], tool_input: { file_path: p.file('openspec/sdlc.yaml'), content: 'x' } });
    expect(config.permission).toBe('deny');
  }, 180000);

  it('a Write or Delete with an unusual path key, or a Delete of a folder, is still checked', () => {
    const p = project();
    const uri = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Write',
      tool_input: { uri: `file:///${p.file('openspec/sdlc.yaml').replace(/\\/g, '/')}`, content: 'x' } });
    expect(uri.permission).toBe('deny');
    const filepath = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Delete',
      tool_input: { filepath: p.file('.cursor/hooks.json') } });
    expect(filepath.permission).toBe('deny');
    const folder = p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Delete',
      tool_input: { path: 'openspec' } });
    expect(folder.permission).toBe('deny');
  }, 180000);

  it('every tool goes through the hook, and a denied shell command is logged once', () => {
    const p = project();
    const hooks = JSON.parse(read(p.file('.cursor/hooks.json')));
    expect(hooks.hooks.preToolUse.every((entry: { matcher?: string }) => entry.matcher === undefined)).toBe(true);
    const log = p.file('openspec/.sdlc/log.jsonl');
    const before = read(log).split('\n').filter((l) => l.includes('hook.denied')).length;
    p.hook('pre-tool', { hook_event_name: 'preToolUse', tool_name: 'Shell', tool_input: { command: 'sdlc approve intent' } });
    p.hook('pre-tool', { hook_event_name: 'beforeShellExecution', command: 'sdlc approve intent' });
    const after = read(log).split('\n').filter((l) => l.includes('hook.denied')).length;
    expect(after - before).toBe(1);
  }, 180000);
});

describe('B80: a Cursor agent session', () => {
  it('CURSOR_AGENT=1 refuses person decisions; doctor says the separation rests on it', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    write(p.file('openspec/changes/demo/intent.md'), INTENT);
    const refused = p.cli(['approve', 'intent', '--change', 'demo', '--json'], { CURSOR_AGENT: '1' });
    expect(refused.code).toBe(1);
    expect(refused.json().status[0].code).toBe('agent_cannot_approve');
    const doctor = p.cli(['doctor', '--json']).json();
    const cursor = doctor.checks.find((check: { check: string }) => check.check === 'cursor');
    expect(cursor).toBeDefined();
    expect(String(cursor.message)).toContain('CURSOR_AGENT');
  }, 180000);

  it('a commit from a Cursor agent session carries SDLC-Agent: cursor', () => {
    const p = project();
    write(p.file('a.txt'), 'a\n');
    const env = { ...p.env, CURSOR_AGENT: '1' };
    execFileSync('git', ['add', '-A'], { cwd: p.root, env });
    execFileSync('git', ['commit', '-q', '-m', 'add a'], { cwd: p.root, env });
    expect(execFileSync('git', ['log', '-1', '--format=%B'], { cwd: p.root, encoding: 'utf-8' }))
      .toContain('SDLC-Agent: cursor');
  }, 180000);
});
