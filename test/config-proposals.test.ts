import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Config proposals (0.23.0), asked by the owner on 2026-10-16: an agent cannot edit the protected
 * `openspec/sdlc.yaml` and `openspec/roles.yaml`, so it could only describe a settings change in words and a person
 * typed it by hand, unchecked. Now:
 *
 * 1. `sdlc config propose --set <key>=<yaml> … --reason <text>` (or `--file <yaml>`; `--target roles` for roles.yaml)
 *    validates the result and stores a proposal; anyone may run it, agents too; the files themselves do not change.
 * 2. `sdlc config show [id]` lists the proposals, or shows one: the diff, the validation and warnings, a weakening of
 *    the process first (a lower enforcement mode, a gate no longer required, removed verify commands or protected
 *    paths, `auto_waive` on lite).
 * 3. `sdlc config apply <id>` (a person only; the maintainer role with roles.yaml) writes the file, keeps its header,
 *    logs `config.applied`; a proposal made against a file that changed since is stale and refused; a weakening needs
 *    `--yes`. `sdlc config dismiss <id> --note` closes a proposal (a person only).
 */

interface HookOut {
  hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string };
}

const AGENT = { QWEN_CODE: '1' };

function project(roles?: string) {
  const root = tempDir('sdlc-config-proposals-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const init = cli(['init', '--tools', 'qwen', '--mode', 'block', '--json']);
  expect(init.code, init.stdout + init.stderr).toBe(0);
  if (roles) write(path.join(root, 'openspec/roles.yaml'), roles);
  const file = path.join(root, 'openspec/sdlc.yaml');
  const config = () => parse(read(file));
  const log = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));
  const hook = (name: string, input: Record<string, unknown>): HookOut => {
    const payload = { session_id: 's1', cwd: root, hook_event_name: 'PreToolUse', tool_name: name, tool_input: input };
    const r = cli(['hook', 'pre-tool', '--agent', 'qwen'], AGENT, JSON.stringify(payload));
    return r.stdout.trim() ? JSON.parse(r.stdout) as HookOut : {};
  };
  const decision = (out: HookOut) => out.hookSpecificOutput?.permissionDecision ?? 'allow';
  const setIdentity = (name: string, email: string) => {
    git(root, ['config', 'user.name', name]);
    git(root, ['config', 'user.email', email]);
  };
  return { root, cli, file, config, log, hook, decision, setIdentity };
}

type P = ReturnType<typeof project>;

function propose(p: P, args: string[], extra: NodeJS.ProcessEnv = AGENT): string {
  const r = p.cli(['config', 'propose', ...args, '--json'], extra);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return r.json<{ id: string }>().id;
}

describe('1. propose', () => {
  it('an agent proposes; the file does not change; the proposal is logged with the agent', () => {
    const p = project();
    const before = read(p.file);
    const id = propose(p, ['--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'Docs need no plan']);
    expect(id).toMatch(/^C\d+$/);
    expect(read(p.file)).toBe(before);
    const entry = p.log().find((e) => e.event === 'config.proposed');
    expect(entry).toMatchObject({ agent: 'qwen' });
    expect(entry.detail).toContain(id);
  }, 240000);

  it('negative: a proposal that does not validate is refused and nothing is stored', () => {
    const p = project();
    const r = p.cli(['config', 'propose', '--set', 'gates.plan.required=maybe', '--reason', 'x', '--json'], AGENT);
    expect(r.code).not.toBe(0);
    expect(r.json<{ status: { code: string }[] }>().status[0].code).toBe('invalid_config');
    const list = p.cli(['config', 'show', '--json']).json<{ proposals: unknown[] }>();
    expect(list.proposals).toEqual([]);
  }, 240000);

  it('negative: an agent cannot write a proposal or the config files directly', () => {
    const p = project();
    const write = (rel: string) => p.hook('write_file', { file_path: path.join(p.root, rel), content: 'x: 1\n' });
    expect(p.decision(write('openspec/.sdlc/config-proposals/C9.yaml'))).toBe('deny');
    expect(p.decision(write('openspec/sdlc.yaml'))).toBe('deny');
  }, 240000);
});

describe('2. show', () => {
  it('lists proposals and shows the diff, the validation and no warning for a harmless change', () => {
    const p = project();
    const id = propose(p, ['--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'Docs need no plan']);
    const list = p.cli(['config', 'show', '--json']).json<{ proposals: Array<{ id: string; status: string }> }>();
    expect(list.proposals).toEqual([expect.objectContaining({ id, status: 'open' })]);
    const one = p.cli(['config', 'show', id]);
    expect(one.code).toBe(0);
    expect(one.stdout).toMatch(/^\+.*auto_waive/m);
    expect(one.stdout).toContain('Docs need no plan');
    const json = p.cli(['config', 'show', id, '--json']).json<{ warnings: string[]; weakens: boolean }>();
    expect(json.weakens).toBe(false);
  }, 240000);

  it('a weakening is shown as such: a lower mode, a gate no longer required, lite in auto_waive', () => {
    const p = project();
    const id = propose(p, ['--set', 'enforcement.mode=warn', '--set', 'gates.review.required=false',
      '--set', 'gates.plan.auto_waive.tracks=[lite]', '--reason', 'Faster']);
    const json = p.cli(['config', 'show', id, '--json']).json<{ warnings: string[]; weakens: boolean }>();
    expect(json.weakens).toBe(true);
    const text = json.warnings.join('\n');
    expect(text).toMatch(/enforcement/);
    expect(text).toMatch(/review/);
    expect(text).toMatch(/lite/);
  }, 240000);
});

describe('3. apply', () => {
  it('a person applies: the file changes, the header stays, the log says who; a second apply is refused', () => {
    const p = project();
    const id = propose(p, ['--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'Docs need no plan']);
    const r = p.cli(['config', 'apply', id]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(p.config().gates.plan.auto_waive).toEqual({ kinds: ['docs'] });
    expect(read(p.file)).toMatch(/^# SDLC harness configuration/);
    const entry = p.log().find((e) => e.event === 'config.applied');
    expect(entry.detail).toContain(id);
    expect(entry.by).toBeTruthy();
    expect(entry.agent).toBeUndefined();
    expect(p.cli(['config', 'apply', id]).code).not.toBe(0);
    const list = p.cli(['config', 'show', '--json']).json<{ proposals: Array<{ id: string; status: string }> }>();
    expect(list.proposals[0].status).toBe('applied');
  }, 240000);

  it('negative: an agent cannot apply or dismiss, by the CLI or through the hook', () => {
    const p = project();
    const id = propose(p, ['--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'x']);
    const before = read(p.file);
    expect(p.cli(['config', 'apply', id], AGENT).code).not.toBe(0);
    expect(p.cli(['config', 'dismiss', id, '--note', 'x'], AGENT).code).not.toBe(0);
    const shell = (command: string) => p.decision(p.hook('run_shell_command', { command }));
    expect(shell(`sdlc config apply ${id}`)).toBe('deny');
    expect(shell(`sdlc config dismiss ${id} --note x`)).toBe('deny');
    expect(shell(`sdlc config propose --set gates.plan.required=true --reason x`)).toBe('allow');
    expect(read(p.file)).toBe(before);
  }, 240000);

  it('negative: a proposal made before the file changed is stale and refused; nothing is written', () => {
    const p = project();
    const id = propose(p, ['--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'x']);
    write(p.file, read(p.file).replace('mode: block', 'mode: block\n  # edited by a person'));
    const edited = read(p.file);
    const r = p.cli(['config', 'apply', id, '--json']);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/stale|changed since/i);
    expect(read(p.file)).toBe(edited);
  }, 240000);

  it('a weakening needs --yes', () => {
    const p = project();
    const id = propose(p, ['--set', 'enforcement.mode=warn', '--reason', 'Trial week']);
    const without = p.cli(['config', 'apply', id]);
    expect(without.code).not.toBe(0);
    expect(p.config().enforcement.mode).toBe('block');
    expect(p.cli(['config', 'apply', id, '--yes']).code).toBe(0);
    expect(p.config().enforcement.mode).toBe('warn');
  }, 240000);

  it('with roles.yaml only a maintainer applies; roles.yaml itself is a target', () => {
    const roles = ['version: 1', 'signing: off', 'people:',
      '  lida: { name: Lida, emails: [lida@team.example] }', '  petr: { name: Petr, emails: [petr@team.example] }',
      'roles:', '  maintainer: [lida]', '  product-owner: [petr]', '  tech-lead: [lida]', '  engineer: [lida]',
      '  code-owner: [lida]', ''].join('\n');
    const p = project(roles);
    const id = propose(p, ['--target', 'roles', '--set', 'signing=warn', '--reason', 'Sign approvals']);
    p.setIdentity('Petr', 'petr@team.example');
    expect(p.cli(['config', 'apply', id]).code).not.toBe(0);
    expect(parse(read(path.join(p.root, 'openspec/roles.yaml'))).signing).toBe('off');
    p.setIdentity('Lida', 'lida@team.example');
    const ok = p.cli(['config', 'apply', id]);
    expect(ok.code, ok.stdout + ok.stderr).toBe(0);
    expect(parse(read(path.join(p.root, 'openspec/roles.yaml'))).signing).toBe('warn');
  }, 240000);

  it('dismiss closes a proposal with a note; it cannot be applied after', () => {
    const p = project();
    const id = propose(p, ['--set', 'gates.plan.auto_waive.kinds=[docs]', '--reason', 'x']);
    expect(p.cli(['config', 'dismiss', id, '--note', 'Not now']).code).toBe(0);
    expect(p.cli(['config', 'apply', id]).code).not.toBe(0);
    expect(p.log().some((e) => e.event === 'config.dismissed')).toBe(true);
  }, 240000);
});

describe('the workflow', () => {
  it('the generated sdlc-config skill proposes, shows and leaves apply to the person', () => {
    const p = project();
    const skill = read(path.join(p.root, '.qwen/skills/sdlc-config/SKILL.md'));
    expect(skill).toContain('sdlc config propose');
    expect(skill).toContain('sdlc config show');
    expect(skill).toMatch(/sdlc config apply[^\n]*person|person[^\n]*sdlc config apply/i);
    for (const name of ['sdlc-health', 'sdlc-adopt']) {
      const other = read(path.join(p.root, `.qwen/skills/${name}/SKILL.md`));
      expect(other, name).toContain('sdlc config propose');
    }
    expect(fs.existsSync(path.join(p.root, '.qwen/commands/sdlc-config.md'))).toBe(true);
  }, 240000);
});
