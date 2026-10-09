import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.14.0 (docs/ru/32, B82): Codex CLI as a tool. Payloads below are the ones Codex 0.158.0 sent to a hook on this
 * machine (2026-10-09): Claude Code's format, `tool_name: "Bash"` with PowerShell commands for file edits on Windows,
 * and `apply_patch` with the patch text in `tool_input.command`.
 */

const INTENT = [
  '# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '', '## Proposed outcome', 'O.',
  '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '', '## Success measures', 'M.', '',
  '## Out of scope', 'None', '', '## Open questions', 'None', '',
].join('\n');

function project(tools = 'codex') {
  const root = tempDir('sdlc-codex-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const init = cli(['init', '--tools', tools, '--mode', 'block', '--mcp', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const hook = (event: string, input: Record<string, unknown>, agent = 'codex') => {
    const payload = { session_id: 's1', cwd: root, permission_mode: 'bypassPermissions', ...input };
    const r = cli(['hook', event, '--agent', agent], {}, JSON.stringify(payload));
    return r.stdout.trim() ? JSON.parse(r.stdout) : {};
  };
  const decision = (out: { hookSpecificOutput?: { permissionDecision?: string } }) =>
    out.hookSpecificOutput?.permissionDecision ?? 'allow';
  const bash = (command: string, agent = 'codex') =>
    hook('pre-tool', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }, agent);
  const patch = (file: string) => hook('pre-tool', { hook_event_name: 'PreToolUse', tool_name: 'apply_patch',
    tool_input: { command: `*** Begin Patch\n*** Add File: ${file}\n+x\n*** End Patch` } });
  return { root, env, cli, hook, decision, bash, patch, file: (rel: string) => path.join(root, rel) };
}

describe('B82: sdlc init --tools codex', () => {
  it('writes skills, subagents, hooks, rules and the MCP server, all in the manifest', () => {
    const p = project();
    expect(read(p.file('.agents/skills/sdlc-status/SKILL.md'))).toMatch(/^---\nname: sdlc-status\n/);
    const agent = read(p.file('.codex/agents/sdlc-verifier.toml'));
    expect(agent).toMatch(/^name = "sdlc-verifier"$/m);
    expect(agent).toMatch(/^developer_instructions = /m);
    const hooks = JSON.parse(read(p.file('.codex/hooks.json'))).hooks;
    for (const event of ['SessionStart', 'PreToolUse', 'Stop']) {
      expect(JSON.stringify(hooks[event]), event).toContain('--agent codex');
    }
    const rules = read(p.file('.codex/rules/sdlc.rules'));
    expect(rules).toMatch(/prefix_rule\(\s*pattern\s*=\s*\["sdlc",\s*"approve"\][\s\S]*?decision\s*=\s*"forbidden"/);
    expect(read(p.file('.codex/config.toml'))).toMatch(/\[mcp_servers\.sdlc\]/);
    const manifest = Object.keys(JSON.parse(read(p.file('openspec/.sdlc/manifest.json'))).files);
    for (const file of ['.agents/skills/sdlc-status/SKILL.md', '.codex/agents/sdlc-verifier.toml', '.codex/rules/sdlc.rules']) {
      expect(manifest, file).toContain(file);
    }
  }, 180000);

  it('negative: without codex in the tools nothing is written under .codex/ or .agents/', () => {
    const p = project('claude');
    expect(fs.existsSync(p.file('.codex'))).toBe(false);
    expect(fs.existsSync(p.file('.agents'))).toBe(false);
  }, 180000);
});

describe('B82: the hooks answer Codex', () => {
  it('an apply_patch or a PowerShell write to code before the plan is denied; the change folder is allowed', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    expect(p.decision(p.patch('src/app.js'))).toBe('deny');
    expect(p.decision(p.bash("Set-Content -LiteralPath 'src/app.js' -Value 'x'"))).toBe('deny');
    expect(p.decision(p.patch('openspec/changes/demo/intent.md'))).toBe('allow');
    expect(p.decision(p.bash('Get-Content src/app.js'))).toBe('allow');
  }, 180000);

  it('a person decision, a guarded Codex file and clearing the Codex marker are denied', () => {
    const p = project();
    expect(p.decision(p.bash('sdlc approve intent'))).toBe('deny');
    expect(p.decision(p.bash("Set-Content -LiteralPath '.codex/hooks.json' -Value '{}'"))).toBe('deny');
    expect(p.decision(p.patch('.codex/rules/sdlc.rules'))).toBe('deny');
    expect(p.decision(p.bash('Remove-Item Env:CODEX_CI; ./go.ps1'))).toBe('deny');
  }, 180000);

  it('the session start gives Codex additional context', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    const start = p.hook('session-start', { hook_event_name: 'SessionStart', source: 'startup' });
    expect(String(start.hookSpecificOutput?.additionalContext)).toContain('demo');
  }, 180000);
});

describe('B82: shell writes and the plan gate, for every tool', () => {
  it('writing code through the shell before the plan is denied in Claude Code too; reading is not', () => {
    const p = project('claude');
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    for (const command of ['echo x > src/app.js', 'cp a.js src/app.js', "Copy-Item a.js src/app.js",
      "'x' | Out-File src/app.js", 'tee src/app.js']) {
      expect(p.decision(p.bash(command, 'claude')), command).toBe('deny');
    }
    expect(p.decision(p.bash('cat src/app.js > /dev/null', 'claude'))).toBe('allow');
    expect(p.decision(p.bash('echo note > openspec/changes/demo/notes.md', 'claude'))).toBe('allow');
  }, 180000);
});

describe('B82: a Codex agent session', () => {
  it('CODEX_CI=1 or CODEX_SESSION_ID refuse person decisions; doctor reminds to trust the hooks', () => {
    const p = project();
    expect(p.cli(['new', 'demo', '--json']).code).toBe(0);
    write(p.file('openspec/changes/demo/intent.md'), INTENT);
    for (const marker of [{ CODEX_CI: '1' }, { CODEX_SESSION_ID: '01a11f95-cc4d' }]) {
      const refused = p.cli(['approve', 'intent', '--change', 'demo', '--json'], marker);
      expect(refused.json().status[0].code, JSON.stringify(marker)).toBe('agent_cannot_approve');
    }
    const doctor = p.cli(['doctor', '--json']).json();
    const codex = doctor.checks.find((check: { check: string }) => check.check === 'codex');
    expect(codex).toBeDefined();
    expect(String(codex.message)).toMatch(/trust/i);
  }, 180000);

  it('a commit from a Codex agent session carries SDLC-Agent: codex', () => {
    const p = project();
    write(p.file('a.txt'), 'a\n');
    const env = { ...p.env, CODEX_CI: '1' };
    execFileSync('git', ['add', '-A'], { cwd: p.root, env });
    execFileSync('git', ['commit', '-q', '-m', 'add a'], { cwd: p.root, env });
    expect(execFileSync('git', ['log', '-1', '--format=%B'], { cwd: p.root, encoding: 'utf-8' }))
      .toContain('SDLC-Agent: codex');
  }, 180000);
});
