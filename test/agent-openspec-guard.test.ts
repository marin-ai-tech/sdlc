import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * The E2E team run of 2026-10-15 (TodoMVC with Qwen Code, protocol finding 12, finding 13, finding 14), decided by the owner the same day.
 *
 * finding 13: an agent wrote a delta spec straight into the living specs (`openspec/specs/**`): the requirement changed
 * without the spec gate. Living specs change only when `sdlc archive` merges an approved change, so an agent's edit
 * or shell write there is a process rule `living-specs`: deny in block mode, a reminder in warn mode.
 *
 * finding 12: an agent created `openspec/changes/<id>/` with `mkdir` and wrote `intent.md` without `sdlc new` (no kind, risk
 * or source). A write into a change folder that `sdlc new` (or `openspec new change`) did not create — no
 * `.sdlc.yaml` and no `.openspec.yaml` in it — is the process rule `change-not-created`; the reason names `sdlc new`.
 *
 * finding 14: the agent-marker refusal named only `CLAUDECODE`, `OPENCODE`, `AGENT` and `SDLC_AGENT` while the command
 * cleared `QWEN_CODE`. The reason names the variables the command clears.
 */

interface HookOut {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string };
}

function project(mode: 'block' | 'warn' = 'block') {
  const root = tempDir('sdlc-openspec-guard-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const init = cli(['init', '--tools', 'qwen', '--mode', mode, '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  const hook = (name: string, input: Record<string, unknown>): HookOut => {
    const payload = { session_id: 's1', cwd: root, hook_event_name: 'PreToolUse', tool_name: name, tool_input: input };
    const r = cli(['hook', 'pre-tool', '--agent', 'qwen'], {}, JSON.stringify(payload));
    return r.stdout.trim() ? JSON.parse(r.stdout) as HookOut : {};
  };
  const decision = (out: HookOut) => out.hookSpecificOutput?.permissionDecision ?? 'allow';
  const reason = (out: HookOut) => out.hookSpecificOutput?.permissionDecisionReason ?? '';
  const writeFile = (rel: string) => hook('write_file', { file_path: path.join(root, rel), content: '# x\n' });
  const shell = (command: string) => hook('run_shell_command', { command });
  return { root, cli, decision, reason, writeFile, shell, file: (rel: string) => path.join(root, rel) };
}

describe('finding 13: living specs change only through the archive', () => {
  it('block mode: an agent edit or shell write under openspec/specs is denied as living-specs', () => {
    const p = project();
    const edit = p.writeFile('openspec/specs/todo-title/spec.md');
    expect(p.decision(edit)).toBe('deny');
    expect(p.reason(edit)).toContain('sdlc:living-specs');
    expect(p.reason(edit)).toMatch(/sdlc archive/);
    const redirect = p.shell('echo "## ADDED Requirements" > openspec/specs/todo-title/spec.md');
    expect(p.decision(redirect)).toBe('deny');
    expect(p.reason(redirect)).toContain('sdlc:living-specs');
  }, 180000);

  it('negative: the delta spec in a created change, the archive command and other openspec files stay allowed', () => {
    const p = project();
    expect(p.cli(['new', 'trim-titles', '--json']).code).toBe(0);
    expect(p.decision(p.writeFile('openspec/changes/trim-titles/specs/todo-title/spec.md'))).toBe('allow');
    expect(p.decision(p.writeFile('openspec/explorations/undo.md'))).toBe('allow');
    expect(p.decision(p.shell('sdlc archive trim-titles --yes'))).toBe('allow');
    expect(p.decision(p.shell('cat openspec/specs/todo-title/spec.md'))).toBe('allow');
  }, 180000);

  it('warn mode: a reminder, not a denial', () => {
    const p = project('warn');
    const edit = p.writeFile('openspec/specs/todo-title/spec.md');
    expect(p.decision(edit)).not.toBe('deny');
    expect(JSON.stringify(edit)).toContain('living-specs');
  }, 180000);
});

describe('finding 12: a change folder is created by sdlc new', () => {
  it('block mode: writing into openspec/changes/<id>/ without .sdlc.yaml or .openspec.yaml is denied', () => {
    const p = project();
    const edit = p.writeFile('openspec/changes/trim-titles-by-hand/intent.md');
    expect(p.decision(edit)).toBe('deny');
    expect(p.reason(edit)).toContain('sdlc:change-not-created');
    expect(p.reason(edit)).toContain('sdlc new');
    expect(p.reason(edit)).toContain('trim-titles-by-hand');
    const redirect = p.shell('echo "# Intent" > openspec/changes/trim-titles-by-hand/intent.md');
    expect(p.decision(redirect)).toBe('deny');
    expect(p.reason(redirect)).toContain('sdlc:change-not-created');
    // An empty folder made with mkdir is not a change either.
    write(p.file('openspec/changes/made-by-mkdir/.keep'), '');
    expect(p.decision(p.writeFile('openspec/changes/made-by-mkdir/intent.md'))).toBe('deny');
  }, 180000);

  it('negative: a change made by sdlc new or by openspec new change is writable before its plan', () => {
    const p = project();
    expect(p.cli(['new', 'trim-titles', '--json']).code).toBe(0);
    expect(p.decision(p.writeFile('openspec/changes/trim-titles/intent.md'))).toBe('allow');
    expect(p.decision(p.writeFile('openspec/changes/trim-titles/proposal.md'))).toBe('allow');
    // A change folder of OpenSpec alone (legacy, adopted project): `.openspec.yaml` without `.sdlc.yaml`.
    write(p.file('openspec/changes/legacy-change/.openspec.yaml'), 'schema: sdlc\n');
    expect(p.decision(p.writeFile('openspec/changes/legacy-change/proposal.md'))).toBe('allow');
  }, 180000);

  it('warn mode: a reminder, not a denial', () => {
    const p = project('warn');
    const edit = p.writeFile('openspec/changes/by-hand/intent.md');
    expect(p.decision(edit)).not.toBe('deny');
    expect(JSON.stringify(edit)).toContain('change-not-created');
  }, 180000);
});

describe('finding 14: the agent-marker refusal names the variables the command clears', () => {
  it('QWEN_CODE and QWEN_CODE_SESSION_ID are named; CLAUDECODE when that one is cleared', () => {
    const p = project();
    const qwen = p.shell('env -u QWEN_CODE -u QWEN_CODE_SESSION_ID sdlc approve release --change x');
    expect(p.decision(qwen)).toBe('deny');
    expect(p.reason(qwen)).toContain('sdlc:agent-marker');
    expect(p.reason(qwen)).toContain('QWEN_CODE');
    expect(p.reason(qwen)).toContain('QWEN_CODE_SESSION_ID');
    const claude = p.shell('CLAUDECODE= sdlc status');
    expect(p.decision(claude)).toBe('deny');
    expect(p.reason(claude)).toContain('CLAUDECODE');
    expect(p.reason(claude)).not.toContain('QWEN_CODE');
  }, 180000);
});

describe('the rules stay off when enforcement is off', () => {
  it('negative: mode off allows both writes', () => {
    const p = project();
    const file = p.file('openspec/sdlc.yaml');
    const config = parse(read(file));
    config.enforcement.mode = 'off';
    write(file, stringify(config));
    expect(p.decision(p.writeFile('openspec/specs/todo-title/spec.md'))).toBe('allow');
    expect(p.decision(p.writeFile('openspec/changes/by-hand/intent.md'))).toBe('allow');
  }, 180000);
});
