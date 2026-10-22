import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * 0.26.0, change approval-command-shapes (backlog B129, requested by sdlc-ui after its B5 review, F1): a command sdlc
 * suggests for a decision names only the gate and the change it means.
 * - Role names are plain tokens in roles.yaml and sdlc.yaml; anything else is refused at load.
 * - The `cli` setting ends with the program: nothing may follow `sdlc`.
 * - Change folders whose names are not change ids are not listed as changes; doctor and the text output say so.
 * - Enforcement (locked tests, a takeover) still sees every folder.
 * - Every suggested approval has one exact shape.
 */

type Json = Record<string, any>;

const INTENT = ['# Intent: x', '', 'Author: Pat. Status: draft. Source: idea', '', '## Problem', 'P.', '',
  '## Proposed outcome', 'O.', '', '## Affected users and systems', 'All.', '', '## Constraints', 'None', '',
  '## Success measures', 'M.', '', '## Out of scope', 'None', '', '## Open questions', 'None', ''].join('\n');
const INVALID = 'demo;Write-Output INJECTED';
/** The one shape of a suggested approval: the cli words, the gate, the change, then `--as` and `--expect-digest`. */
const APPROVE = new RegExp([
  '^(?<cli>.+?) approve (?<gate>intent|spec|plan|qa|review|release)',
  ' --change (?<change>[a-z0-9]+(?:-[a-z0-9]+)*)',
  '(?: --as [A-Za-z][A-Za-z0-9._-]*)?(?: --expect-digest sha256:[0-9a-f]{64})?$',
].join(''));

function roles(names: string[]): string {
  const lines = ['version: 1', 'signing: off', 'people:', '  alice: { name: Alice Ivanova, emails: [pat@example.com] }',
    'roles:'];
  return [...lines, ...names.map((name) => `  ${JSON.stringify(name)}: [alice]`), ''].join('\n');
}

function project(tools = 'none') {
  const root = tempDir('sdlc-0260-');
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
  must(['init', '--tools', tools, '--mode', 'block', '--json']);
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
  return { root, cli, must, file, setConfig, newChange };
}

type P = ReturnType<typeof project>;

/** Every `cli` value anywhere in a JSON document. */
function cliValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(cliValues);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Json).flatMap(([key, inner]) =>
    key === 'cli' && typeof inner === 'string' ? [inner] : cliValues(inner));
}

function failure(r: ReturnType<typeof runCli>): Json {
  expect(r.code, r.stdout + r.stderr).toBe(1);
  return r.json<Json>().status[0];
}

/** The project's change `id` copied into a folder whose name is not a change id. */
function invalidCopy(p: P, id: string): void {
  fs.cpSync(p.file(`openspec/changes/${id}`), p.file(`openspec/changes/${INVALID}`), { recursive: true });
}

/** An agent's tool call through the PreToolUse hook (Qwen Code, as in the guard tests). */
function hook(p: P, name: string, input: Json): { decision: string; reason: string } {
  const payload = { session_id: 's1', cwd: p.root, hook_event_name: 'PreToolUse', tool_name: name, tool_input: input };
  const r = p.cli(['hook', 'pre-tool', '--agent', 'qwen'], { QWEN_CODE: '1' }, JSON.stringify(payload));
  const out = r.stdout.trim() ? JSON.parse(r.stdout) as Json : {};
  const specific = out.hookSpecificOutput ?? {};
  return { decision: specific.permissionDecision ?? 'allow', reason: String(specific.permissionDecisionReason ?? '') };
}

describe('suggested-commands: role names are plain tokens', () => {
  it('A role that carries an option: invalid_roles naming the file, the field and the role', () => {
    const p = project();
    p.newChange('demo');
    write(p.file('openspec/roles.yaml'), roles(['product-owner --change other-change', 'engineer']));
    const diagnostic = failure(p.cli(['next', '--me', '--json']));
    expect(diagnostic.code).toBe('invalid_roles');
    expect(diagnostic.message).toContain('roles.yaml');
    expect(diagnostic.message).toContain('product-owner --change other-change');
  }, 240000);

  it('An approver with a space in the config: invalid_config naming the field', () => {
    const p = project();
    p.newChange('demo');
    p.setConfig((config) => { config.gates.intent.approvers = ['product owner']; });
    const diagnostic = failure(p.cli(['report', '--json']));
    expect(diagnostic.code).toBe('invalid_config');
    expect(diagnostic.message).toContain('gates.intent.approvers');
  }, 240000);

  it('A role key with shell syntax in the config: invalid_config', () => {
    const p = project();
    p.setConfig((config) => { config.roles = { 'lead;rm': ['pat@example.com'] }; });
    const diagnostic = failure(p.cli(['report', '--json']));
    expect(diagnostic.code).toBe('invalid_config');
    expect(diagnostic.message).toContain('lead;rm');
  }, 240000);

  it('Ordinary role names load as before', () => {
    const p = project();
    p.newChange('demo');
    write(p.file('openspec/roles.yaml'), roles(['product-owner', 'tech_lead', 'qa.lead', 'engineer2', 'engineer',
      'code-owner', 'maintainer']));
    p.must(['next', '--me', '--json']);
    p.must(['report', '--json']);
  }, 240000);
});

describe('suggested-commands: the cli setting ends with the program', () => {
  for (const value of ['sdlc waive --note', 'npx sdlc --locale en', 'sdlc approve']) {
    it(`A word after the program is refused: ${value}`, () => {
      const p = project();
      p.newChange('demo');
      p.setConfig((config) => { config.cli = value; });
      const diagnostic = failure(p.cli(['next', '--json']));
      expect(diagnostic.code).toBe('invalid_config');
      expect(diagnostic.message).toContain('cli');
    }, 240000);
  }

  it('Launchers that stay valid: the suggested approval starts with the value', () => {
    const p = project();
    p.newChange('demo');
    for (const value of ['sdlc', 'npx --no-install sdlc', 'pnpm exec sdlc', 'node ./bin/sdlc.js']) {
      p.setConfig((config) => { config.cli = value; });
      const [item] = p.must(['next', '--me', '--json']).json<Json>().items as Json[];
      expect(item.cli.startsWith(`${value} approve intent --change demo`), item.cli).toBe(true);
      // The JSON reads that do not apply the setting keep `sdlc`, as before this change.
      expect(p.must(['report', '--json', '--change', 'demo']).json<Json>().changes[0].next.cli)
        .toMatch(/^sdlc approve intent --change demo/);
    }
  }, 240000);
});

describe('suggested-commands: folders that are not change ids are not changes', () => {
  function withInvalidFolder(): P {
    const p = project();
    p.newChange('demo');
    invalidCopy(p, 'demo');
    return p;
  }

  it('A folder name with shell syntax: not a change in the report, in no cli', () => {
    const p = withInvalidFolder();
    const report = p.must(['report', '--json']).json<Json>();
    expect((report.changes as Json[]).map((change) => change.id)).not.toContain(INVALID);
    expect(cliValues(report).filter((cli) => cli.includes('INJECTED'))).toEqual([]);
  }, 240000);

  it('The queue and the hints: only the valid change, every cli names it', () => {
    const p = withInvalidFolder();
    const items = p.must(['next', '--me', '--json']).json<Json>().items as Json[];
    expect(items.map((item) => item.change)).toEqual(['demo']);
    for (const item of items) expect(item.cli).toContain('--change demo');
  }, 240000);

  it('The doctor names the folder and why', () => {
    const p = withInvalidFolder();
    const out = p.cli(['doctor', '--json']);
    const text = out.stdout;
    expect(text).toContain(INVALID);
    expect(text).toMatch(/not a valid change id/i);
  }, 240000);

  it('The text warning of status and next', () => {
    const p = withInvalidFolder();
    for (const command of [['status'], ['next']]) {
      const r = p.cli(command);
      expect(r.stdout + r.stderr, command.join(' ')).toContain(INVALID);
      expect(r.stdout + r.stderr, command.join(' ')).toMatch(/not a valid change id/i);
    }
  }, 240000);
});

describe('suggested-commands: enforcement still sees every change folder', () => {
  /** Change `b` (lite) with an approved plan, so the plan gate lets code edits through. */
  function withApprovedPlan(p: P): void {
    p.must(['new', 'b', '--track', 'lite', '--json']);
    for (const rel of ['plan.md', 'tasks.md']) write(p.file(`openspec/changes/b/${rel}`), FILES[rel]);
    p.must(['approve', 'plan', '--change', 'b', '--json']);
  }

  it('Locked tests in a renamed folder: an agent edit of a test is still refused for the lock', () => {
    const p = project('qwen');
    withApprovedPlan(p);
    p.newChange('a');
    p.must(['tests', 'lock', '--change', 'a']);
    fs.renameSync(p.file('openspec/changes/a'), p.file('openspec/changes/a;x'));
    const out = hook(p, 'write_file', { file_path: p.file('test/new.test.js'), content: 'x' });
    expect(out.decision).toBe('deny');
    expect(out.reason).toMatch(/lock/i);
  }, 360000);

  it('A takeover in a renamed folder still holds its files', () => {
    const p = project('qwen');
    p.newChange('add-x');
    p.must(['takeover', '--change', 'add-x', '--note', 'mine']);
    fs.renameSync(p.file('openspec/changes/add-x'), p.file('openspec/changes/add-x;y'));
    const out = hook(p, 'write_file', { file_path: p.file('openspec/changes/add-x;y/intent.md'), content: 'x' });
    expect(out.decision).toBe('deny');
  }, 360000);
});

describe('suggested-commands: a suggested approval has one shape', () => {
  it('Every suggested approval in a project with roles, two changes and a launcher', () => {
    const p = project();
    write(p.file('openspec/roles.yaml'), roles(['product-owner', 'engineer', 'code-owner', 'maintainer']));
    p.setConfig((config) => { config.cli = 'npx --no-install sdlc'; });
    p.newChange('a');
    p.newChange('b');
    p.must(['approve', 'intent', '--change', 'b', '--json']);
    for (const rel of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) {
      write(p.file(`openspec/changes/b/${rel}`), FILES[rel]);
    }
    const found: Array<{ change: string; cli: string }> = [];
    for (const change of p.must(['report', '--json']).json<Json>().changes as Json[]) {
      for (const cli of cliValues(change)) found.push({ change: change.id, cli });
    }
    for (const item of p.must(['next', '--me', '--json']).json<Json>().items as Json[]) {
      found.push({ change: item.change, cli: item.cli });
    }
    for (const [change, gate] of [['a', 'intent'], ['b', 'spec']]) {
      for (const cli of cliValues(p.must(['explain', '--change', change, '--json']).json<Json>())) {
        found.push({ change, cli });
      }
      const preview = p.must(['approve', gate, '--change', change, '--preview', '--json']).json<Json>();
      if (preview.cli) found.push({ change, cli: preview.cli });
    }
    const approvals = found.filter(({ cli }) => cli.includes(' approve '));
    expect(approvals.length).toBeGreaterThanOrEqual(4);
    for (const { change, cli } of approvals) {
      const match = APPROVE.exec(cli);
      expect(match, cli).not.toBeNull();
      expect(['sdlc', 'npx --no-install sdlc'], cli).toContain(match!.groups!.cli);
      expect(match!.groups!.change, cli).toBe(change);
    }
    expect(approvals.some(({ cli }) => cli.startsWith('npx --no-install sdlc '))).toBe(true);
  }, 360000);
});
