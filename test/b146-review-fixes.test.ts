import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadConfig } from '../src/core/config.js';
import { SdlcError } from '../src/core/errors.js';
import { stopCheck } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * Change close-the-b129-review-gaps-in-hook-messages-signature-checks-and-the-cli-rule, review round 1: the lead's
 * red baseline for the findings of review.md, written before the fixes.
 * - F1: the cli rule allows only known launcher options, so a value that runs no program (`node --version sdlc`) is
 *   refused and never becomes a hook command.
 * - F2: session start names a config that fails to load even when its raw mode is `off`.
 * - F3: an sdlc.yaml that exists but cannot be read denies like one that fails to parse.
 * - F4: an unterminated quoted `--change` on a held change is denied (cmd.exe passes it to the CLI).
 * - F6: the quoted and `=` forms of `--change`, a planned-file takeover in a folder with shell syntax, and validate
 *   on a skipped folder whose other checks would pass.
 * - F8: the validate text names the folder, not `{id}`. F9: the MCP-stage reason with no valid stage reads.
 * - F10: the stop message for a valid change that cannot be evaluated keeps its quoted name.
 * Each block names its negatives; hooks run through the real CLI in throwaway git projects.
 */

type Json = Record<string, any>;

const QWEN = { QWEN_CODE: '1' };
const CLAUDE = { CLAUDECODE: '1' };
const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');
const INJECTED = 'demo;Write-Output INJECTED';
const MCP_SERVERS = { build: { type: 'stdio', command: ['node', 'build-mcp.js'], stages: ['build'] } };
const TIMEOUT = 360000;

const failures = vi.hoisted(() => new Map<string, unknown>());

vi.mock('../src/core/lifecycle.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/core/lifecycle.js')>();
  return {
    ...real,
    evaluateChange: (...args: Parameters<typeof real.evaluateChange>) => {
      const failure = failures.get(args[1].id);
      if (failure !== undefined) throw failure;
      return real.evaluateChange(...args);
    },
  };
});

function project(mode: 'block' | 'warn' = 'block') {
  const root = tempDir('sdlc-b146review-');
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
    fs.renameSync(file(`openspec/changes/${from}`), file(`openspec/changes/${from}.tmp-rename`));
    fs.renameSync(file(`openspec/changes/${from}.tmp-rename`), file(`openspec/changes/${to}`));
  };
  return { root, env, cli, must, file, setConfig, newChange, rename };
}

type P = ReturnType<typeof project>;

interface Answer { stdout: string; decision: string; reason: string }

/** An agent's tool call through the Qwen Code hook (Claude Code's input format). */
function hook(p: P, tool: string, input: Json): Answer {
  const payload = { session_id: `s-${Math.random()}`, cwd: p.root, hook_event_name: 'PreToolUse', tool_name: tool,
    tool_input: input };
  const r = p.cli(['hook', 'pre-tool', '--agent', 'qwen'], QWEN, JSON.stringify(payload));
  expect(r.code, r.stderr).toBe(0);
  const stdout = r.stdout.trim();
  if (stdout === '') return { stdout, decision: 'none', reason: '' };
  const specific = (JSON.parse(stdout) as Json).hookSpecificOutput ?? {};
  const decision = specific.permissionDecision ?? (specific.additionalContext ? 'warn' : 'none');
  return { stdout, decision: String(decision), reason: String(specific.permissionDecisionReason ?? '') };
}

/** `sdlc hook session-start` for Claude Code: the parsed answer, or undefined for an empty one. */
function sessionStart(p: P): Json | undefined {
  const input = { session_id: `s-${Math.random()}`, cwd: p.root, hook_event_name: 'SessionStart' };
  const r = p.cli(['hook', 'session-start'], CLAUDE, JSON.stringify(input));
  expect(r.code, r.stderr).toBe(0);
  return r.stdout.trim() ? JSON.parse(r.stdout) as Json : undefined;
}

function shell(p: P, command: string): Answer {
  return hook(p, 'run_shell_command', { command });
}

function backtickSpans(text: string): string[] {
  return text.split('`').filter((_, index) => index % 2 === 1);
}

/** A held valid change `demo` (a person's takeover) next to a free change `demo2`. */
function heldDemo(): P {
  const p = project();
  p.newChange('demo');
  p.newChange('demo2');
  p.must(['takeover', '--change', 'demo', '--note', 'mine', '--json']);
  return p;
}

function denyRead(file: string): void {
  if (process.platform === 'win32') {
    const r = spawnSync('icacls', [file, '/deny', '*S-1-1-0:(R)'], { encoding: 'utf-8', timeout: 30000 });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  } else {
    fs.chmodSync(file, 0o000);
  }
  expect(() => fs.readFileSync(file), 'the fixture file is still readable').toThrow();
}

function allowRead(file: string): void {
  if (process.platform === 'win32') {
    spawnSync('icacls', [file, '/remove:d', '*S-1-1-0'], { encoding: 'utf-8', timeout: 30000 });
  } else {
    fs.chmodSync(file, 0o644);
  }
}

describe('F1: the cli rule allows only known launcher options', () => {
  it('Launcher options that run no program: each value is refused naming cli, with a fix line', () => {
    const p = project();
    const values = ['node --version sdlc', 'node -v sdlc', 'node -e 0 sdlc', 'npx --version sdlc',
      'yarn --version sdlc', 'pnpm dlx sdlc'];
    const loaded: string[] = [];
    for (const value of values) {
      p.setConfig((config) => { config.cli = value; });
      const r = p.cli(['report', '--json']);
      if (r.code === 0) {
        loaded.push(value);
        continue;
      }
      const diagnostic = r.json<Json>().status[0] as Json;
      expect(diagnostic.code, value).toBe('invalid_config');
      expect(String(diagnostic.message), value).toContain('cli');
      expect(String(diagnostic.fix ?? ''), value).toContain('sdlc update');
    }
    // One assertion over the whole list, so a failure names every value the rule still loads.
    expect(loaded).toEqual([]);
  }, TIMEOUT);

  it('init --cli "node --version sdlc" is refused and writes no hook command', () => {
    const root = tempDir('sdlc-b146review-init-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    const r = runCli(['init', '--tools', 'claude', '--cli', 'node --version sdlc', '--json'], root, env);
    expect(r.code, r.stdout + r.stderr).not.toBe(0);
    const settings = path.join(root, '.claude', 'settings.json');
    const written = fs.existsSync(settings) ? read(settings) : '';
    expect(written).not.toContain('node --version sdlc');
  }, TIMEOUT);

  it('negative: The launcher options of the allow-list still load', () => {
    const p = project();
    const values = ['sdlc', 'npx --no-install sdlc', 'npx -y sdlc', 'npx --yes sdlc', 'npx --offline sdlc',
      'pnpm exec sdlc', 'yarn sdlc', 'yarn exec sdlc', 'bunx sdlc', 'node ./bin/sdlc.js', 'node C:/tools/sdlc.js'];
    const refused: string[] = [];
    for (const value of values) {
      p.setConfig((config) => { config.cli = value; });
      if (p.cli(['report', '--json']).code !== 0) refused.push(value);
    }
    expect(refused).toEqual([]);
  }, TIMEOUT);

  it('negative: A package option before the program stays refused', () => {
    const p = project();
    p.setConfig((config) => { config.cli = 'npx -p @marin-ai/sdlc sdlc'; });
    const r = p.cli(['report', '--json']);
    expect(r.code).toBe(1);
    expect(r.json<Json>().status[0].code).toBe('invalid_config');
  }, TIMEOUT);
});

describe('F2: session start names a config that fails to load, in every mode', () => {
  it('Enforcement off in a file that fails to load: one session line naming the code and sdlc doctor', () => {
    const p = project();
    p.setConfig((config) => {
      config.enforcement.mode = 'off';
      config.gates.qa = { ...(config.gates.qa ?? {}), approvers: ['qa lead'] };
    });
    expect(p.cli(['report', '--json']).code).toBe(1);
    const answer = sessionStart(p);
    const context = String(answer?.hookSpecificOutput?.additionalContext ?? '');
    expect(context, JSON.stringify(answer)).toContain('invalid_config');
    expect(context).toContain('sdlc doctor');
  }, TIMEOUT);

  it('negative: Enforcement off in a file that fails to load still allows a tool call', () => {
    const p = project();
    p.setConfig((config) => {
      config.enforcement.mode = 'off';
      config.gates.qa = { ...(config.gates.qa ?? {}), approvers: ['qa lead'] };
    });
    expect(hook(p, 'read_file', { absolute_path: p.file('src/app.js') }).decision).toBe('none');
  }, TIMEOUT);
});

describe('F3: an sdlc.yaml that cannot be read denies', () => {
  it('An unreadable sdlc.yaml in a block project: a read is denied with config-load', () => {
    const p = project();
    const config = p.file('openspec/sdlc.yaml');
    denyRead(config);
    try {
      const out = hook(p, 'read_file', { absolute_path: p.file('src/app.js') });
      expect(out.decision, out.stdout).toBe('deny');
      expect(out.reason).toContain('[sdlc:config-load]');
      expect(out.reason).toContain('sdlc doctor');
    } finally {
      allowRead(config);
    }
  }, TIMEOUT);

  it('negative: The same project with a readable sdlc.yaml allows the read', () => {
    const p = project();
    expect(hook(p, 'read_file', { absolute_path: p.file('src/app.js') }).decision).toBe('none');
  }, TIMEOUT);
});

describe('F4 and F6: the takeover step rule reads every quoted form of --change', () => {
  it('An unterminated quoted --change on a held change is denied', () => {
    const p = heldDemo();
    const out = shell(p, 'sdlc verify --change "demo');
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:takeover]');
  }, TIMEOUT);

  it('Single-quoted, double-quoted and = forms on a held change are denied', () => {
    const p = heldDemo();
    const commands = ["sdlc verify --change 'demo'", 'sdlc verify --change "demo"', 'sdlc verify --change=demo',
      "sdlc verify --change='demo'", 'sdlc verify --change="demo"'];
    const allowed = commands.filter((command) => shell(p, command).decision !== 'deny');
    expect(allowed).toEqual([]);
  }, TIMEOUT);

  it('negative: Another change and a read-only step stay allowed', () => {
    const p = heldDemo();
    for (const command of ["sdlc verify --change 'demo2'", "sdlc status --change 'demo'",
      'sdlc status --change "demo']) {
      expect(shell(p, command).decision, command).toBe('none');
    }
  }, TIMEOUT);

  it('A planned-file takeover in a folder with shell syntax: denied without a command', () => {
    const p = project();
    p.newChange('demo');
    write(p.file('openspec/changes/demo/plan.md'), FILES['plan.md']);
    p.must(['takeover', '--change', 'demo', '--note', 'mine', '--json']);
    p.rename('demo', INJECTED);
    const out = hook(p, 'write_file', { file_path: p.file('src/greet.js'), content: 'x' });
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:takeover]');
    expect(backtickSpans(out.reason).filter((span) => span.includes('INJECTED') || span.includes('demo'))).toEqual([]);
    expect(out.reason).toMatch(/rename/i);
  }, TIMEOUT);
});

describe('F6 and F8: validate reports a skipped folder by its name', () => {
  /** A lite change with no other validation issue, renamed to a name that is not a change id. */
  function skippedLite(): P {
    const p = project();
    p.newChange('bx', ['--track', 'lite']);
    const valid = p.cli(['validate', '--change', 'bx', '--json']).json<Json>();
    expect(valid.items?.[0]?.valid ?? valid.valid, JSON.stringify(valid)).toBe(true);
    p.rename('bx', 'B;x');
    return p;
  }

  it('validate --all --json: invalid by the folder rule alone, and OpenSpec never sees the name', () => {
    const p = skippedLite();
    const items = p.cli(['validate', '--all', '--json']).json<Json>().items as Json[];
    const item = items.find((candidate) => candidate.change === 'B;x');
    expect(item?.valid, JSON.stringify(items)).toBe(false);
    const issues = item?.issues as Json[];
    const folderRule = issues.filter((issue) => issue.source === 'sdlc' && /not a valid change id/.test(issue.message));
    expect(folderRule.map((issue) => issue.message), JSON.stringify(issues)).toEqual(['Folder B;x is not a valid change '
      + 'id; rename it to a lowercase change id.']);
    expect(issues.filter((issue) => issue.source === 'openspec')).toEqual([]);
  }, TIMEOUT);

  it('validate --all text: the message names the folder, never {id}', () => {
    const p = skippedLite();
    const r = p.cli(['validate', '--all']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('B;x');
    expect(r.stdout).not.toContain('{id}');
  }, TIMEOUT);
});

describe('F9: the MCP-stage reason with no valid stage reads', () => {
  it('The only folder is b;x: the reason does not end the stage list empty', () => {
    const p = project();
    p.setConfig((config) => { config.mcp = { servers: MCP_SERVERS }; });
    p.newChange('b');
    p.rename('b', 'b;x');
    const out = hook(p, 'mcp__build__pipeline_status', {});
    expect(out.decision, out.stdout).toBe('deny');
    expect(out.reason).toContain('[sdlc:mcp-stage]');
    expect(out.reason).not.toMatch(/stages:\s*[.,;]/);
  }, TIMEOUT);

  it('negative: With a valid change at build, the call is allowed next to b;x', () => {
    const p = project();
    p.setConfig((config) => { config.mcp = { servers: MCP_SERVERS }; });
    p.must(['new', 'b', '--track', 'lite', '--json']);
    write(p.file('openspec/changes/b/plan.md'), FILES['plan.md']);
    write(p.file('openspec/changes/b/tasks.md'), FILES['tasks.md'].replace('- [x] 1.2', '- [ ] 1.2'));
    p.must(['approve', 'plan', '--change', 'b', '--json']);
    fs.cpSync(p.file('openspec/changes/b'), p.file('openspec/changes/b;x'), { recursive: true });
    expect(hook(p, 'mcp__build__pipeline_status', {}).decision).toBe('none');
  }, TIMEOUT);
});

describe('F10: the stop message for a valid change that cannot be evaluated keeps its quoted name', () => {
  it('A valid change whose evaluation throws: the message quotes "broken"', () => {
    const p = project();
    p.setConfig((config) => { config.enforcement.verify_before_stop = true; });
    p.newChange('broken');
    failures.set('broken', new SdlcError('unsafe_path',
      { key: 'error.digestArtifactUnsafe', params: { file: 'intent.md' } }));
    try {
      const paths = projectPaths(p.root);
      const message = stopCheck({ paths, config: loadConfig(paths.sdlcConfig) });
      expect(message).toContain('"broken"');
      expect(message).toContain('unsafe_path');
      expect(message).not.toContain('--change');
    } finally {
      failures.clear();
    }
  }, TIMEOUT);
});
