import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Findings of the E9 team run (one team, different agent tools, 2026-10-18), decided by the owner for 0.23.6.
 *
 * finding 1: running `sdlc init --tools …` again rewrote untouched lines of openspec/sdlc.yaml (`[a]` became `[ a ]`).
 * finding 2: on Windows Claude Code did not find Git Bash (Git installed for the user), so sdlc's hooks failed and blocked
 * every call, while `sdlc doctor` said the Claude hooks were fine. doctor checks where Claude Code will find bash.
 * finding 3: one tool had two names: hook decisions said `claude`, commit trailers and log events `claude-code`.
 * finding 4: accepting the reviewer role replaced the built-in sdlc-reviewer subagent and lost the finding format that the
 * parsing of review.md needs.
 * finding 5: doctor and the docs spoke only of trusting the hooks in `/hooks`, while a headless `codex exec` ran no project
 * hooks after that trust.
 * finding 6: a denial of a shell write recorded `tests-locked: Bash` without the file.
 */

function project(tools = 'claude,qwen', extra: NodeJS.ProcessEnv = {}) {
  const root = tempDir('sdlc-0236-');
  const env = humanEnv(tempDir('sdlc-home-'), extra);
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'test/x.test.js'), 'export {};\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[], more: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...more }, input);
  expect(cli(['init', '--tools', tools, '--mode', 'block', '--json']).code).toBe(0);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'sdlc']);
  const file = (rel: string) => path.join(root, rel);
  const queue = () => (fs.existsSync(file('openspec/.sdlc/hook-log.jsonl'))
    ? read(file('openspec/.sdlc/hook-log.jsonl')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const hook = (agent: string, payload: Record<string, unknown>, more: NodeJS.ProcessEnv = {}) =>
    cli(['hook', 'pre-tool', '--agent', agent], more,
      JSON.stringify({ session_id: 's', cwd: root, hook_event_name: 'PreToolUse', ...payload }));
  return { root, cli, file, queue, hook };
}

describe('finding 1: init keeps the lines it does not change', () => {
  it('flow collections and their spacing survive a second init with another tool list', () => {
    const p = project('qwen');
    const configFile = p.file('openspec/sdlc.yaml');
    const lines = [
      'mcp:', '  servers:', '    kb: { type: stdio, command: [node, kb.mjs], stages: [design, build] }',
      'events:', '  - server: kb', '    tool: send', '    on: ["gate.*", "summary.daily"]', '',
    ];
    write(configFile, `${read(configFile).replace(/\s*$/, '\n')}${lines.join('\n')}`);
    git(p.root, ['add', '-A']);
    git(p.root, ['commit', '-q', '-m', 'servers']);
    expect(p.cli(['init', '--tools', 'claude,qwen', '--json']).code).toBe(0);
    const after = read(configFile);
    for (const line of lines.filter(Boolean)) expect(after, line).toContain(line);
    expect(parse(after).tools).toEqual(['claude', 'qwen']);
  }, 240000);
});

describe.runIf(process.platform === 'win32')('finding 2: doctor checks where Claude Code finds Git Bash', () => {
  it('a CLAUDE_CODE_GIT_BASH_PATH that does not exist, or no bash where Claude Code looks, is a warning', () => {
    const missing = project('claude', { CLAUDE_CODE_GIT_BASH_PATH: 'C:\\nowhere\\bash.exe' });
    const r = missing.cli(['doctor']);
    expect(r.stdout + r.stderr).toMatch(/CLAUDE_CODE_GIT_BASH_PATH/);
    const empty = tempDir('sdlc-0236-programs-');
    const unset = project('claude', { CLAUDE_CODE_GIT_BASH_PATH: '', ProgramFiles: empty, ProgramW6432: empty });
    expect(unset.cli(['doctor']).stdout).toMatch(/CLAUDE_CODE_GIT_BASH_PATH/);
  }, 240000);

  it('negative: an existing bash.exe in CLAUDE_CODE_GIT_BASH_PATH gives no such warning', () => {
    const bash = path.join(tempDir('sdlc-0236-git-'), 'bash.exe');
    write(bash, '');
    const p = project('claude', { CLAUDE_CODE_GIT_BASH_PATH: bash });
    expect(p.cli(['doctor']).stdout).not.toMatch(/CLAUDE_CODE_GIT_BASH_PATH/);
  }, 240000);
});

describe('finding 3 and finding 6: what a hook decision records', () => {
  it('a Claude Code denial is recorded as claude-code, like its commits', () => {
    const p = project('claude');
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    p.hook('claude', { tool_name: 'Write', tool_input: { file_path: p.file('src/app.js'), content: 'x' } },
      { CLAUDECODE: '1' });
    const denied = p.queue().filter((e) => e.event === 'hook.denied');
    expect(denied.length).toBeGreaterThan(0);
    for (const entry of denied) expect(entry.agent).toBe('claude-code');
  }, 240000);

  it('a denied shell write names the file it writes', () => {
    const p = project('codex');
    expect(p.cli(['new', 'add-x', '--json']).code).toBe(0);
    expect(p.cli(['tests', 'lock', '--change', 'add-x']).code).toBe(0);
    p.hook('codex', { tool_name: 'Bash', tool_input: { command: "Add-Content -Path test/x.test.js -Value '// y'" } },
      { CODEX_CI: '1' });
    const denied = p.queue().filter((e) => e.event === 'hook.denied');
    expect(denied.length).toBeGreaterThan(0);
    expect(denied.at(-1).detail).toMatch(/test\/x\.test\.js/);
  }, 240000);
});

describe('finding 4: the reviewer role keeps the finding format', () => {
  it('after team accept reviewer, the sdlc-reviewer subagent still prescribes the review.md finding format', () => {
    const p = project('claude,qwen');
    expect(p.cli(['team', 'sync']).code).toBe(0);
    const r = p.cli(['team', 'accept', 'reviewer']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    for (const rel of ['.claude/agents/sdlc-reviewer.md', '.qwen/agents/sdlc-reviewer.md']) {
      const text = read(p.file(rel));
      expect(text, rel).toMatch(/### F<n> \[important\|nit\|pre-existing\]/);
      expect(text, rel).toMatch(/none found — checked/);
    }
  }, 240000);
});

describe('finding 5: doctor and the docs on headless Codex runs', () => {
  it('doctor names codex exec when Codex is a tool', () => {
    const p = project('codex');
    expect(p.cli(['doctor']).stdout).toMatch(/codex exec/);
  }, 240000);
});
