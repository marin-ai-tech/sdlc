import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Change close-the-b129-review-gaps-in-hook-messages-signature-checks-and-the-cli-rule (review findings F1-F6 of
 * B129, 0.26.0), the lead's acceptance test, written before the code:
 * - F1: a folder whose name is not a change id only adds restrictions in the hooks, and every approval check reads it.
 * - F2: a configuration that fails to load never reads as "allow" in any host (unless its mode reads `off`).
 * - F3: no hook message and no `--change` error builds a command from a folder name.
 * - F4: the `cli` setting names the program once, last, after a known launcher or alone.
 * - F5: past roles.yaml versions are read as they are; the current file stays strict; refusals carry a fix.
 * - F6: archived folder names reach no suggested command.
 * Every case runs the real CLI in a throwaway git project; hooks go through `sdlc hook`.
 */

type Json = Record<string, any>;
type Agent = 'claude' | 'codex' | 'qwen' | 'gigacode' | 'opencode' | 'cursor';

const AGENTS: Agent[] = ['claude', 'codex', 'qwen', 'gigacode', 'opencode', 'cursor'];
/** The marker each host sets in its hook's environment. */
const AGENT_ENV: Record<Agent, NodeJS.ProcessEnv> = {
  claude: { CLAUDECODE: '1' },
  codex: { CODEX_CI: '1' },
  qwen: { QWEN_CODE: '1' },
  gigacode: { QWEN_CODE: '1' },
  opencode: { OPENCODE: '1' },
  cursor: { CURSOR_AGENT: '1' },
};
const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');
const INJECTED = 'demo;Write-Output INJECTED';
const BACKTICKS = 'x`sdlc waive plan --change victim`';
const MCP_SERVERS = { build: { type: 'stdio', command: ['node', 'build-mcp.js'], stages: ['build'] } };
const RELEASE_COMMAND = 'kubectl apply -f deploy.yaml -n production';
const TIMEOUT = 360000;

function project(mode: 'block' | 'warn' = 'block') {
  const root = tempDir('sdlc-b129gaps-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['checkout', '-q', '-b', 'main']);
  write(path.join(root, 'src/app.js'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) =>
    runCli(args, root, { ...env, ...extra }, input);
  const must = (args: string[]) => {
    const r = cli(args);
    expect(r.code, `sdlc ${args.join(' ')}\n${r.stdout}${r.stderr}`).toBe(0);
    return r;
  };
  must(['init', '--tools', 'none', '--mode', mode, '--json']);
  const file = (rel: string) => path.join(root, rel);
  const setConfig = (edit: (config: Json) => void) => {
    const config = parse(read(file('openspec/sdlc.yaml')));
    edit(config);
    write(file('openspec/sdlc.yaml'), stringify(config));
  };
  const newChange = (id: string, extra: string[] = []) => {
    must(['new', id, ...extra, '--json']);
    write(file(`openspec/changes/${id}/intent.md`), INTENT);
  };
  const rename = (from: string, to: string) => {
    // Two steps, so a rename that only changes the case also works on a case-insensitive file system.
    fs.renameSync(file(`openspec/changes/${from}`), file(`openspec/changes/${from}.tmp-rename`));
    fs.renameSync(file(`openspec/changes/${from}.tmp-rename`), file(`openspec/changes/${to}`));
  };
  const commit = (message: string) => {
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', message]);
  };
  return { root, env, cli, must, file, setConfig, newChange, rename, commit };
}

type P = ReturnType<typeof project>;

function failure(r: ReturnType<typeof runCli>): Json {
  expect(r.code, r.stdout + r.stderr).toBe(1);
  return r.json<Json>().status[0];
}

/** Change `id` (lite) with an approved plan; `open` leaves one task unchecked, so the change stays at `build`. */
function withApprovedPlan(p: P, id: string, open = false): void {
  p.must(['new', id, '--track', 'lite', '--json']);
  write(p.file(`openspec/changes/${id}/plan.md`), FILES['plan.md']);
  const tasks = open ? FILES['tasks.md'].replace('- [x] 1.2', '- [ ] 1.2') : FILES['tasks.md'];
  write(p.file(`openspec/changes/${id}/tasks.md`), tasks);
  p.must(['approve', 'plan', '--change', id, '--json']);
}

function roles(names: string[], signing: 'off' | 'warn' = 'off'): string {
  const lines = ['version: 1', `signing: ${signing}`, 'people:',
    '  alice: { name: Alice Ivanova, emails: [pat@example.com] }', 'roles:'];
  return [...lines, ...names.map((name) => `  ${JSON.stringify(name)}: [alice]`), ''].join('\n');
}

/** The code spans of a text: what sits between a pair of backticks, the commands a message suggests. */
function backtickSpans(text: string): string[] {
  return text.split('`').filter((_, index) => index % 2 === 1);
}

/** Every string anywhere in a JSON document. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Json).flatMap(strings);
}

/** Every object anywhere in a JSON document whose `archived` is true. */
function archivedObjects(value: unknown): Json[] {
  if (Array.isArray(value)) return value.flatMap(archivedObjects);
  if (!value || typeof value !== 'object') return [];
  const own = (value as Json).archived === true ? [value as Json] : [];
  return [...own, ...Object.values(value as Json).flatMap(archivedObjects)];
}

/** An agent's edit of `file` in the host's own pre-tool input format. */
function editInput(agent: Agent, root: string, file: string): Json {
  if (agent === 'opencode') {
    return { session_id: `s-${Math.random()}`, cwd: root, tool_name: 'write', tool_input: { filePath: file } };
  }
  if (agent === 'cursor') {
    return { conversation_id: `c-${Math.random()}`, hook_event_name: 'preToolUse', workspace_roots: [root],
      cwd: root, tool_name: 'Write', tool_input: { file_path: file, content: 'x' } };
  }
  return { session_id: `s-${Math.random()}`, cwd: root, hook_event_name: 'PreToolUse', tool_name: 'Write',
    tool_input: { file_path: file, content: 'x' } };
}

/** A tool call in Claude Code's input format (also Codex, Qwen Code and GigaCode). */
function toolInput(root: string, tool: string, input: Json): Json {
  return { session_id: `s-${Math.random()}`, cwd: root, hook_event_name: 'PreToolUse', tool_name: tool,
    tool_input: input };
}

interface Answer { code: number | null; stdout: string; decision: string; reason: string }

/** `sdlc hook pre-tool` for a host: its answer read in that host's format (`none` for an empty answer). */
function preTool(cwd: string, env: NodeJS.ProcessEnv, agent: Agent, input: Json): Answer {
  const r = runCli(['hook', 'pre-tool', '--agent', agent], cwd, { ...env, ...AGENT_ENV[agent] },
    JSON.stringify(input));
  const stdout = r.stdout.trim();
  if (stdout === '') return { code: r.code, stdout, decision: 'none', reason: '' };
  const out = JSON.parse(stdout) as Json;
  if (agent === 'cursor') {
    return { code: r.code, stdout, decision: String(out.permission), reason: String(out.agent_message ?? '') };
  }
  if (agent === 'opencode') {
    return { code: r.code, stdout, decision: String(out.decision), reason: String(out.reason ?? '') };
  }
  const specific = out.hookSpecificOutput ?? {};
  const decision = specific.permissionDecision ?? (specific.additionalContext ? 'warn' : 'none');
  const reason = specific.permissionDecisionReason ?? specific.additionalContext ?? '';
  return { code: r.code, stdout, decision: String(decision), reason: String(reason) };
}

/** An agent's tool call through the Qwen Code hook, as the B129 acceptance test sends it. */
function hook(p: P, tool: string, input: Json): Answer {
  return preTool(p.root, p.env, 'qwen', toolInput(p.root, tool, input));
}

/** `sdlc hook session-start` or `stop` for Claude Code: the parsed answer, or undefined for an empty one. */
function claudeEvent(p: P, event: 'session-start' | 'stop', extra: Json = {}): Json | undefined {
  const name = event === 'stop' ? 'Stop' : 'SessionStart';
  const input = { session_id: `s-${Math.random()}`, cwd: p.root, hook_event_name: name, ...extra };
  const r = p.cli(['hook', event], AGENT_ENV.claude, JSON.stringify(input));
  expect(r.code, r.stderr).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout) as Json : undefined;
}

/** A project whose sdlc.yaml lists the approver `qa lead`, so it fails to load with invalid_config. */
function legacyApprover(): P {
  const p = project();
  p.setConfig((config) => {
    config.gates = config.gates ?? {};
    config.gates.qa = { ...(config.gates.qa ?? {}), approvers: ['qa lead'] };
  });
  expect(failure(p.cli(['report', '--json'])).message).toContain('gates.qa.approvers');
  return p;
}

describe('hook-config-load: a configuration that cannot be loaded is not an allow', () => {
  for (const agent of AGENTS) {
    it(`A legacy approver in each host: ${agent}`, () => {
      const p = legacyApprover();
      const out = preTool(p.root, p.env, agent, editInput(agent, p.root, p.file('src/app.ts')));
      expect(out.code).toBe(0);
      expect(out.decision, out.stdout).toBe('deny');
      expect(out.reason).toContain('config-load');
      expect(out.reason).toContain('invalid_config');
      expect(out.reason).toContain('gates.qa.approvers');
      expect(out.reason).toContain('sdlc doctor');
    }, TIMEOUT);
  }

  it('An agent\'s approval with a legacy cli: a config-load deny naming invalid_config and cli', () => {
    const p = project();
    p.setConfig((config) => { config.cli = 'sdlc.cmd'; });
    expect(failure(p.cli(['report', '--json'])).code).toBe('invalid_config');
    const command = ['sdlc', 'approve', 'plan', '--change', 'a'].join(' ');
    const out = preTool(p.root, p.env, 'claude', toolInput(p.root, 'Bash', { command }));
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('config-load');
    expect(out.reason).toContain('invalid_config');
    expect(out.reason).toContain('cli');
  }, TIMEOUT);

  it('Invalid YAML: a read-only command is denied naming invalid_yaml', () => {
    const p = project();
    write(p.file('openspec/sdlc.yaml'), 'version: 1\nenforcement:\n  mode: block\ngates: [unclosed\n');
    expect(failure(p.cli(['report', '--json'])).code).toBe('invalid_yaml');
    const out = preTool(p.root, p.env, 'claude', toolInput(p.root, 'Bash', { command: 'git status' }));
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('config-load');
    expect(out.reason).toContain('invalid_yaml');
  }, TIMEOUT);

  it('negative: A valid configuration is unchanged (an allowed edit gets an empty answer)', () => {
    const p = project();
    const out = preTool(p.root, p.env, 'claude', editInput('claude', p.root, p.file('docs/notes.md')));
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('');
  }, TIMEOUT);
});

describe('hook-config-load: the enforcement mode is read leniently when the file fails to load', () => {
  it('negative: Enforcement off in a file that fails to load: allowed, and no stop reminder', () => {
    const p = project();
    p.setConfig((config) => {
      config.enforcement.mode = 'off';
      config.cli = 'true sdlc';
    });
    const out = preTool(p.root, p.env, 'claude', editInput('claude', p.root, p.file('src/app.ts')));
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('');
    expect(claudeEvent(p, 'stop')).toBeUndefined();
  }, TIMEOUT);

  it('Warn mode or no mode in a file that fails to load: denied with config-load', () => {
    const p = project();
    p.setConfig((config) => {
      config.enforcement.mode = 'warn';
      config.cli = 'true sdlc';
    });
    const warn = preTool(p.root, p.env, 'claude', editInput('claude', p.root, p.file('src/app.ts')));
    expect(warn.decision, `warn: ${warn.stdout}`).toBe('deny');
    expect(warn.reason).toContain('config-load');
    p.setConfig((config) => { delete config.enforcement.mode; });
    const none = preTool(p.root, p.env, 'claude', editInput('claude', p.root, p.file('src/app.ts')));
    expect(none.decision, `no mode: ${none.stdout}`).toBe('deny');
    expect(none.reason).toContain('config-load');
  }, TIMEOUT);
});

describe('hook-config-load: session start and stop say the configuration failed', () => {
  it('Session start with a refused config: one context line naming the file, the code and sdlc doctor', () => {
    const p = legacyApprover();
    const out = claudeEvent(p, 'session-start');
    const context = String(out?.hookSpecificOutput?.additionalContext ?? '');
    expect(context).toContain('openspec/sdlc.yaml');
    expect(context).toContain('invalid_config');
    expect(context).toContain('sdlc doctor');
    expect(context.split('\n')).toHaveLength(1);
  }, TIMEOUT);

  it('Stop with a refused config: one reminder; nothing once stop_hook_active is set', () => {
    const p = legacyApprover();
    const out = claudeEvent(p, 'stop');
    expect(out?.decision, JSON.stringify(out)).toBe('block');
    expect(String(out?.reason)).toContain('invalid_config');
    expect(String(out?.reason)).toContain('sdlc doctor');
    expect(claudeEvent(p, 'stop', { stop_hook_active: true })).toBeUndefined();
  }, TIMEOUT);
});

describe('hook-config-load: the fail-open cases stay as they are', () => {
  it('negative: A directory without sdlc.yaml: an empty answer, exit 0', () => {
    const dir = tempDir('sdlc-b129gaps-bare-');
    const env = humanEnv(tempDir('sdlc-home-'));
    const out = preTool(dir, env, 'claude', editInput('claude', dir, path.join(dir, 'src/app.ts')));
    expect(out.code).toBe(0);
    expect(out.stdout).toBe('');
  }, TIMEOUT);

  it('negative: Cursor outside a project: Cursor\'s default allow', () => {
    const dir = tempDir('sdlc-b129gaps-bare-');
    const env = humanEnv(tempDir('sdlc-home-'));
    const out = preTool(dir, env, 'cursor', editInput('cursor', dir, path.join(dir, 'src/app.ts')));
    expect(out.code).toBe(0);
    expect(JSON.parse(out.stdout)).toEqual({ permission: 'allow' });
  }, TIMEOUT);
});

describe('suggested-commands: role names are plain tokens', () => {
  it('The refusal says how to fix it: sdlc.yaml and roles.yaml', () => {
    const p = project();
    p.newChange('demo');
    const config = read(p.file('openspec/sdlc.yaml'));
    p.setConfig((c) => { c.gates.qa = { ...(c.gates.qa ?? {}), approvers: ['qa lead'] }; });
    const fromConfig = failure(p.cli(['report', '--json']));
    expect(fromConfig.code).toBe('invalid_config');
    expect(String(fromConfig.fix ?? ''), JSON.stringify(fromConfig)).toMatch(/sdlc\.yaml/);
    expect(String(fromConfig.fix ?? '')).toMatch(/rename/i);
    write(p.file('openspec/sdlc.yaml'), config);
    write(p.file('openspec/roles.yaml'), roles(['QA Lead', 'product-owner', 'engineer']));
    const fromRoles = failure(p.cli(['next', '--me', '--json']));
    expect(fromRoles.code).toBe('invalid_roles');
    expect(String(fromRoles.fix ?? ''), JSON.stringify(fromRoles)).toMatch(/roles\.yaml/);
    expect(String(fromRoles.fix ?? '')).toMatch(/rename/i);
  }, TIMEOUT);

  it('A role renamed in history: approvals verify and the export read past roles.yaml as it is', () => {
    const p = project();
    write(p.file('openspec/roles.yaml'), roles(['QA Lead', 'product-owner', 'engineer', 'maintainer'], 'warn'));
    p.commit('roles with an old role name');
    write(p.file('openspec/roles.yaml'), roles(['qa-lead', 'product-owner', 'engineer', 'maintainer'], 'warn'));
    p.commit('rename the role');
    const verify = p.cli(['approvals', 'verify', '--json']);
    expect(verify.stdout + verify.stderr).not.toContain('invalid_roles');
    expect(verify.code, verify.stdout).toBe(0);
    expect((verify.json<Json>().results as Json[]).length).toBeGreaterThan(0);
    const exported = p.cli(['audit', '--export', tempDir('sdlc-b129gaps-export-'), '--json']);
    expect(exported.stdout + exported.stderr).not.toContain('invalid_roles');
    expect(exported.code, exported.stdout).toBe(0);
  }, TIMEOUT);

  it('negative: The current file stays strict: invalid_roles naming the role', () => {
    const p = project();
    write(p.file('openspec/roles.yaml'), roles(['QA Lead', 'product-owner', 'engineer', 'maintainer'], 'warn'));
    p.commit('roles');
    const diagnostic = failure(p.cli(['approvals', 'verify', '--json']));
    expect(diagnostic.code).toBe('invalid_roles');
    expect(diagnostic.message).toContain('QA Lead');
  }, TIMEOUT);
});

describe('suggested-commands: the cli setting ends with the program', () => {
  it('The program word twice: each value is refused naming cli, with a fix line', () => {
    const p = project();
    p.newChange('demo');
    for (const value of ['sdlc waive intent --note sdlc', 'sdlc --locale en ./sdlc', 'sdlc openspec x sdlc']) {
      p.setConfig((config) => { config.cli = value; });
      const r = p.cli(['next', '--json']);
      expect(r.code, `${value}: ${r.stdout}`).toBe(1);
      const diagnostic = r.json<Json>().status[0];
      expect(diagnostic.code, value).toBe('invalid_config');
      expect(diagnostic.message, value).toContain('cli');
      expect(String(diagnostic.fix ?? ''), value).not.toBe('');
    }
  }, TIMEOUT);

  it('A first word that is not a launcher: refused in sdlc.yaml and by init --cli, which writes no hook', () => {
    const p = project();
    p.newChange('demo');
    for (const value of ['true sdlc', 'zz sdlc', 'npm exec sdlc', 'npx.cmd sdlc']) {
      p.setConfig((config) => { config.cli = value; });
      const r = p.cli(['next', '--json']);
      expect(r.code, `${value}: ${r.stdout}`).toBe(1);
      const diagnostic = r.json<Json>().status[0];
      expect(diagnostic.code, value).toBe('invalid_config');
      expect(diagnostic.message, value).toContain('cli');
    }
    const fresh = tempDir('sdlc-b129gaps-init-');
    initGitRepo(fresh);
    const init = runCli(['init', '--tools', 'claude', '--cli', 'true sdlc', '--json'], fresh, p.env);
    expect(init.code, init.stdout).toBe(1);
    expect(init.json<Json>().status[0].code).toBe('invalid_config');
    const settings = path.join(fresh, '.claude/settings.json');
    expect(fs.existsSync(settings) && read(settings).includes('true sdlc')).toBe(false);
  }, TIMEOUT);

  it('negative: Launchers that stay valid: the suggested approval starts with the value', () => {
    const p = project();
    p.newChange('demo');
    const values = ['sdlc', 'npx --no-install sdlc', 'pnpm exec sdlc', 'yarn sdlc', 'bunx sdlc',
      'node C:/tools/sdlc.js', 'node ./bin/sdlc.js'];
    for (const value of values) {
      p.setConfig((config) => { config.cli = value; });
      const [item] = p.must(['next', '--me', '--json']).json<Json>().items as Json[];
      expect(item.cli.startsWith(`${value} approve intent --change demo`), item.cli).toBe(true);
    }
  }, TIMEOUT);
});

describe('suggested-commands: a folder that is not a change id only adds restrictions', () => {
  it('An approved plan in a renamed folder: the plan gate denies the edit', () => {
    const p = project();
    withApprovedPlan(p, 'b');
    expect(hook(p, 'write_file', { file_path: p.file('src/app.ts'), content: 'x' }).decision).toBe('none');
    p.rename('b', 'b;x');
    const out = hook(p, 'write_file', { file_path: p.file('src/app.ts'), content: 'x' });
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:plan-gate]');
  }, TIMEOUT);

  it('An approved release in a renamed folder: the release gate rule denies the command', () => {
    const p = project();
    withApprovedPlan(p, 'b');
    // A person's decision on the release gate; the release rule counts it as an approved gate (gateOk).
    p.must(['waive', 'release', '--change', 'b', '--note', 'released by hand', '--json']);
    const gates = p.must(['status', '--change', 'b', '--json']).json<Json>().change.gates as Json[];
    expect(['approved', 'waived', 'n/a']).toContain(gates.find((gate) => gate.id === 'release')?.status);
    expect(hook(p, 'run_shell_command', { command: RELEASE_COMMAND }).decision).toBe('none');
    p.rename('b', 'b;x');
    const out = hook(p, 'run_shell_command', { command: RELEASE_COMMAND });
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:release-gate]');
  }, TIMEOUT);

  it('The stage of a renamed folder: the MCP stage rule denies the call', () => {
    const p = project();
    p.setConfig((config) => { config.mcp = { servers: MCP_SERVERS }; });
    withApprovedPlan(p, 'b', true);
    expect(p.must(['status', '--change', 'b', '--json']).json<Json>().change.stage).toBe('build');
    expect(hook(p, 'mcp__build__pipeline_status', {}).decision).toBe('none');
    p.rename('b', 'b;x');
    const out = hook(p, 'mcp__build__pipeline_status', {});
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:mcp-stage]');
  }, TIMEOUT);

  it('negative: A valid folder keeps its permissions, also next to a folder b;x', () => {
    const p = project();
    p.setConfig((config) => { config.mcp = { servers: MCP_SERVERS }; });
    withApprovedPlan(p, 'b', true);
    expect(hook(p, 'write_file', { file_path: p.file('src/app.js'), content: 'x' }).decision).toBe('none');
    expect(hook(p, 'mcp__build__pipeline_status', {}).decision).toBe('none');
    fs.cpSync(p.file('openspec/changes/b'), p.file('openspec/changes/b;x'), { recursive: true });
    expect(hook(p, 'write_file', { file_path: p.file('src/greet.js'), content: 'x' }).decision).toBe('none');
    const unplanned = hook(p, 'write_file', { file_path: p.file('src/app.js'), content: 'x' });
    expect(unplanned.decision, unplanned.stdout).toBe('deny');
    expect(unplanned.reason).toContain('[sdlc:plan-gate]');
  }, TIMEOUT);
});

describe('suggested-commands: hook messages never build a command from a folder name', () => {
  it('Locked tests in a folder that carries an option: no unlock command, a rename hint', () => {
    const p = project();
    p.newChange('a');
    p.newChange('victim');
    p.must(['tests', 'lock', '--change', 'a']);
    p.rename('a', 'a --change victim');
    const out = hook(p, 'write_file', { file_path: p.file('test/new.test.js'), content: 'x' });
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:tests-locked]');
    expect(out.reason).not.toContain('sdlc tests unlock --change a');
    expect(backtickSpans(out.reason).filter((span) => span.includes('victim'))).toEqual([]);
    expect(out.reason).toMatch(/rename/i);
  }, TIMEOUT);

  it('A takeover in a folder with shell syntax: the edit and the sdlc step are denied without a command', () => {
    const p = project();
    p.newChange('demo');
    p.must(['takeover', '--change', 'demo', '--note', 'mine']);
    p.rename('demo', INJECTED);
    const edit = hook(p, 'write_file', { file_path: p.file(`openspec/changes/${INJECTED}/intent.md`), content: 'x' });
    const step = hook(p, 'run_shell_command', { command: `sdlc verify --change "${INJECTED}"` });
    const answers = [['edit', edit], ['step', step]] as const;
    for (const [name, out] of answers) expect(out.decision, `${name}: ${out.stdout}`).toBe('deny');
    for (const [name, out] of answers) {
      expect(out.reason, name).toContain('[sdlc:takeover]');
      const spans = backtickSpans(out.reason).filter((span) => span.includes('INJECTED') || span.includes('demo'));
      expect(spans, name).toEqual([]);
      expect(out.reason, name).toMatch(/rename/i);
    }
  }, TIMEOUT);

  it('The stop reminder for a folder with upper-case letters: no verify command, a rename hint', () => {
    const p = project();
    p.setConfig((config) => { config.enforcement.verify_before_stop = true; });
    withApprovedPlan(p, 'fix-a');
    const valid = claudeEvent(p, 'stop');
    expect(String(valid?.reason)).toContain('sdlc verify --change fix-a');
    p.rename('fix-a', 'Fix-A');
    const out = claudeEvent(p, 'stop');
    expect(out?.decision, JSON.stringify(out)).toBe('block');
    expect(String(out?.reason)).not.toContain('sdlc verify --change Fix-A');
    expect(String(out?.reason)).toMatch(/rename/i);
  }, TIMEOUT);

  it('A folder name that carries backticks: no backtick command in the plan gate reason holds its text', () => {
    const p = project();
    p.newChange('tmp');
    p.rename('tmp', BACKTICKS);
    const out = hook(p, 'write_file', { file_path: p.file('src/app.js'), content: 'x' });
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:plan-gate]');
    expect(backtickSpans(out.reason).filter((span) => span.includes('victim'))).toEqual([]);
  }, TIMEOUT);

  it('negative: A valid folder keeps its commands: the unlock command for fix-a', () => {
    const p = project();
    p.newChange('fix-a');
    p.must(['tests', 'lock', '--change', 'fix-a']);
    const out = hook(p, 'write_file', { file_path: p.file('test/new.test.js'), content: 'x' });
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('sdlc tests unlock --change fix-a');
  }, TIMEOUT);
});

describe('suggested-commands: a skipped folder named in --change is reported as skipped', () => {
  it('A folder with upper-case letters: change_not_found, skipped, rename, no sdlc new', () => {
    const p = project();
    p.newChange('fix-a');
    p.rename('fix-a', 'Fix-A');
    const diagnostic = failure(p.cli(['status', '--change', 'Fix-A', '--json']));
    expect(diagnostic.code).toBe('change_not_found');
    expect(diagnostic.message).toContain('Fix-A');
    expect(diagnostic.message).toMatch(/skip/i);
    expect(String(diagnostic.fix ?? '')).toMatch(/rename/i);
    expect(`${diagnostic.message} ${diagnostic.fix ?? ''}`).not.toContain('sdlc new');
  }, TIMEOUT);

  it('negative: A name with no folder: change_not_found with today\'s fix', () => {
    const p = project();
    p.newChange('fix-a');
    p.rename('fix-a', 'Fix-A');
    const diagnostic = failure(p.cli(['status', '--change', 'missing', '--json']));
    expect(diagnostic.code).toBe('change_not_found');
    expect(String(diagnostic.fix ?? '')).toContain('sdlc new');
  }, TIMEOUT);
});

/**
 * Signing `warn` (roles.yaml committed), change `b` with an unsigned approval of its intent, committed; with
 * `renamed`, the folder is then renamed to `B;x` and committed again.
 */
function unsignedApproval(renamed: boolean): P {
  const p = project();
  write(p.file('openspec/roles.yaml'), roles(['product-owner', 'engineer', 'code-owner', 'maintainer'], 'warn'));
  p.commit('roles');
  p.newChange('b');
  p.must(['approve', 'intent', '--change', 'b', '--json']);
  p.commit('the intent of b');
  if (renamed) {
    p.rename('b', 'B;x');
    p.commit('rename b');
  }
  return p;
}

function approvalRows(p: P): { ok: boolean; rows: Json[] } {
  const r = p.cli(['approvals', 'verify', '--json']);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const out = r.json<Json>();
  return { ok: out.ok, rows: (out.results as Json[]).filter((row) => row.gate) };
}

/** The changes each evidence read lists: approvals verify, the project audit, the export and validate --all. */
function evidenceChanges(p: P): Record<string, string[]> {
  const verify = approvalRows(p).rows.map((row) => row.change);
  const audit = (p.must(['audit', '--json']).json<Json>().changes as Json[]).map((row) => row.change);
  const dir = tempDir('sdlc-b129gaps-export-');
  p.must(['audit', '--export', dir, '--json']);
  const index = JSON.parse(read(path.join(dir, 'index.json'))) as Json;
  const exported = index.changes as string[];
  const exportedApprovals = (index.approvals as Json[]).map((approval) => approval.change);
  const validate = (p.cli(['validate', '--all', '--json']).json<Json>().items as Json[]).map((item) => item.change);
  return { verify, audit, exported, exportedApprovals, validate };
}

describe('suggested-commands: every approval check covers every change folder', () => {
  it('An unsigned approval in a renamed folder: approvals verify fails on a row for B;x', () => {
    const p = unsignedApproval(true);
    const { ok, rows } = approvalRows(p);
    const row = rows.find((candidate) => candidate.change === 'B;x');
    expect(row, JSON.stringify(rows)).toBeDefined();
    expect(['valid', 'pre-signing', 'bootstrap', 'merge']).not.toContain(row?.status);
    expect(ok).toBe(false);
  }, TIMEOUT);

  it('Audit, export and validate see the folder B;x', () => {
    const p = unsignedApproval(true);
    const seen = evidenceChanges(p);
    expect(seen.audit).toContain('B;x');
    expect(seen.exported).toContain('B;x');
    expect(seen.exportedApprovals).toContain('B;x');
    expect(seen.validate).toContain('B;x');
    const items = p.cli(['validate', '--all', '--json']).json<Json>().items as Json[];
    expect(items.find((item) => item.change === 'B;x')?.valid).toBe(false);
  }, TIMEOUT);

  it('No folder hides behind an empty answer: not ok with no approval rows', () => {
    const p = unsignedApproval(true);
    const { ok, rows } = approvalRows(p);
    expect({ ok, approvals: rows.length }).not.toEqual({ ok: true, approvals: 0 });
  }, TIMEOUT);

  it('negative: A project without invalid folders: every read lists the same change b', () => {
    const p = unsignedApproval(false);
    expect(evidenceChanges(p)).toEqual({
      verify: ['b'], audit: ['b'], exported: ['b'], exportedApprovals: ['b'], validate: ['b'],
    });
  }, TIMEOUT);
});

describe('suggested-commands: archived folder names reach no suggested command', () => {
  it('An archived folder that carries an option: no suggested command names it', () => {
    const p = project();
    p.newChange('x', ['--kind', 'docs', '--risk', 'low']);
    p.newChange('victim');
    const warnings = p.must(['status', '--change', 'x', '--json']).json<Json>().change.warnings as string[];
    expect(warnings.some((warning) => warning.includes('track set lite --change x'))).toBe(true);
    fs.mkdirSync(p.file('openspec/changes/archive'), { recursive: true });
    fs.renameSync(p.file('openspec/changes/x'), p.file('openspec/changes/archive/2026-01-01-x --change victim'));
    const outputs = {
      report: p.must(['report', '--json']).json<Json>(),
      status: p.must(['status', '--archived', '--json']).json<Json>(),
    };
    const offenders: Record<string, string[]> = {};
    for (const [name, output] of Object.entries(outputs)) {
      expect(archivedObjects(output).length, name).toBeGreaterThan(0);
      const commands = strings(output).filter((text) => text.includes('sdlc '));
      const named = commands.filter((text) => /--change x\b/.test(text) || text.includes('x --change victim'));
      const archived = strings(archivedObjects(output)).filter((text) => text.includes('sdlc '));
      const victim = archived.filter((text) => text.includes('--change victim'));
      offenders[name] = [...new Set([...named, ...victim])];
    }
    // The whole sweep in one assertion, so a failure lists every builder that names the archived folder.
    expect(offenders).toEqual({ report: [], status: [] });
  }, TIMEOUT);

  it('negative: An active change keeps its track suggestion', () => {
    const p = project();
    p.newChange('docs-fix', ['--kind', 'docs', '--risk', 'low']);
    const status = p.must(['status', '--json']).json<Json>();
    expect(strings(status).some((text) => text.includes('sdlc track set lite --change docs-fix'))).toBe(true);
  }, TIMEOUT);
});
