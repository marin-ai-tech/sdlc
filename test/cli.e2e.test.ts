import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';
import { PROJECT_URL } from '../src/core/license.js';
import { readLog, type LogEntry } from '../src/core/log.js';
import { harnessVersion } from '../src/core/version.js';

const VERSION = harnessVersion();
const COMMUNITY = 'community (PolyForm-Noncommercial-1.0.0 + scdl-Additional-Permissions-1.0)';

const FILES: Record<string, string> = {
  'intent.md': '# Intent: say goodbye\n\nAuthor: Pat (web). Status: draft. Source: idea\n\n## Problem\nSessions end without a goodbye.\n\n## Proposed outcome\nUsers see a named farewell.\n\n## Affected users and systems\nAll users.\n\n## Constraints\nNone\n\n## Success measures\nShown on sign-out.\n\n## Out of scope\nNone\n\n## Open questions\nNone\n',
  'proposal.md': '# Proposal\n\n## Why\n\nSessions end abruptly because users never see a farewell message that uses their name.\n\n## What Changes\n\n- Add farewell(name).\n\n## Capabilities\n\n### New Capabilities\n- `greeting`: greeting and farewell messages\n\n## Impact\n\nsrc/greet.js\n',
  'specs/greeting/spec.md': '# Spec Delta\n\n## Purpose\n\nProvide friendly, personalized greeting and farewell messages to users.\n\n## ADDED Requirements\n\n### Requirement: Farewell message\nThe system SHALL produce a farewell message that includes the user\'s name.\n\n#### Scenario: Named farewell\n- **WHEN** Ada signs out\n- **THEN** the message is "Goodbye, Ada"\n',
  'design.md': '# Design\n\n## Context\nsrc/greet.js\n\n## Decisions\nAdd farewell next to greet.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n- `test/greet.test.js` (new)\n\n## Order of work\n1. Test. 2. Implement.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n',
  'tasks.md': '# Tasks\n\n## 1. Farewell\n\n- [ ] 1.1 Add test/greet.test.js and verify it fails first\n- [ ] 1.2 Implement farewell and verify npm test passes\n',
};

describe('sdlc CLI end to end (with the bundled OpenSpec)', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) => runCli(args, root, { ...env, ...extra }, input);
  const changeDir = () => path.join(root, 'openspec/changes/add-farewell');
  const logEntries = (): LogEntry[] => readLog(root);

  beforeAll(() => {
    root = tempDir('sdlc-e2e-');
    env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', type: 'module', scripts: { test: 'node --test' } }));
    write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
  });

  it('init creates the OpenSpec root, schema, config and both integrations', () => {
    const r = cli(['init', '--tools', 'claude,opencode', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const out = r.json();
    expect(out.openspec).toMatchObject({ created: true, defaultSchema: 'sdlc' });
    expect(out.config.verifyCommands).toEqual(['npm test']);
    expect(out.claudeHooks).toBe('installed');
    expect(read(path.join(root, 'openspec/config.yaml'))).toMatch(/^schema: sdlc/m);
    for (const f of ['.claude/skills/sdlc-intent/SKILL.md', '.claude/commands/sdlc/next.md', '.claude/agents/sdlc-verifier.md',
      '.opencode/commands/sdlc-next.md', '.opencode/agents/sdlc-reviewer.md', '.opencode/plugins/sdlc.js', 'REVIEW.md']) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
    expect(cli(['openspec', 'schema', 'validate', 'sdlc']).code).toBe(0);
    expect(out.harness).toMatchObject({ tool: 'scdl', version: VERSION, license: COMMUNITY });
    expect(logEntries()[0]).toMatchObject({ event: 'harness.initialized', by: 'Pat Owner <pat@example.com>', scdl: VERSION, license: COMMUNITY });
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'sdlc init']);
  });

  it('update is idempotent', () => {
    const r = cli(['update', '--json']).json();
    expect(r.files.created).toEqual([]);
    expect(r.files.updated).toEqual([]);
  });

  it('new creates an OpenSpec change with an SDLC record', () => {
    const r = cli(['new', 'add-farewell', '--kind', 'feature', '--risk', 'low', '--source-type', 'ticket', '--source-ref', 'WEB-42', '--json']);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().next).toMatchObject({ actor: 'agent', artifact: 'intent' });
    expect(read(path.join(changeDir(), '.openspec.yaml'))).toMatch(/schema: sdlc/);
    expect(read(path.join(changeDir(), '.sdlc.yaml'))).toMatch(/ref: WEB-42/);
  });

  it('serves OpenSpec instructions enriched with the lifecycle view', () => {
    const r = cli(['instructions', 'intent', '--change', 'add-farewell', '--json']);
    expect(r.code, r.stderr).toBe(0);
    const out = r.json();
    expect(out.artifactId).toBe('intent');
    expect(out.template).toMatch(/## Proposed outcome/);
    expect(out.sdlc).toMatchObject({ stage: 'plan', gate: 'intent' });
    const rec = cli(['instructions', 'review', '--change', 'add-farewell', '--json']).json();
    expect(rec).toMatchObject({ artifactId: 'review', source: 'sdlc' });
  });

  it('refuses approvals from an agent session', () => {
    write(path.join(changeDir(), 'intent.md'), FILES['intent.md']);
    const r = cli(['approve', 'intent', '--change', 'add-farewell', '--json'], { CLAUDECODE: '1' });
    expect(r.code).toBe(1);
    expect(r.json().status[0].code).toBe('agent_cannot_approve');
  });

  it('walks intent -> spec -> plan with human approvals', () => {
    expect(cli(['approve', 'intent', '--change', 'add-farewell']).code).toBe(0);
    for (const f of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(path.join(changeDir(), f), FILES[f]);
    const v = cli(['validate', '--change', 'add-farewell', '--json']);
    expect(v.code, v.stdout).toBe(0);
    expect(cli(['approve', 'spec', '--change', 'add-farewell']).code).toBe(0);
    for (const f of ['plan.md', 'tasks.md']) write(path.join(changeDir(), f), FILES[f]);
    const blocked = cli(['approve', 'review', '--change', 'add-farewell', '--json']);
    expect(blocked.json().status[0].code).toBe('gate_blocked');
    expect(cli(['approve', 'plan', '--change', 'add-farewell']).code).toBe(0);
    expect(cli(['next', '--json']).json().next).toMatchObject({ actor: 'agent', action: 'implement' });
  });

  it('stamps approved artifacts and records the scdl version and license with every approval', () => {
    const provenance = `<!-- sdlc-provenance: scdl ${VERSION} | license: ${COMMUNITY} | ${PROJECT_URL} -->`;
    for (const f of ['intent.md', 'proposal.md', 'design.md', 'plan.md', 'tasks.md']) {
      expect(read(path.join(changeDir(), f)).trimEnd().endsWith(provenance), f).toBe(true);
    }
    expect(read(path.join(changeDir(), 'specs/greeting/spec.md'))).not.toContain('sdlc-provenance');
    const state = parse(read(path.join(changeDir(), '.sdlc.yaml')));
    expect(state.harness).toEqual({ scdl: VERSION, license: COMMUNITY });
    expect(state.gates.plan.approvals[0]).toMatchObject({ role: 'engineer', scdl: VERSION, license: COMMUNITY });
    expect(state.history.every((h: { scdl?: string; license?: string }) => h.scdl === VERSION && h.license === COMMUNITY)).toBe(true);
    // Stamping is not content: every planning gate is still approved.
    const gates = cli(['status', '--change', 'add-farewell', '--json']).json().change.gates;
    expect(gates.filter((g: { id: string }) => ['intent', 'spec', 'plan'].includes(g.id)).map((g: { status: string }) => g.status))
      .toEqual(['approved', 'approved', 'approved']);
    expect(logEntries().filter((e) => e.change === 'add-farewell').map((e) => e.event))
      .toEqual(['change.created', 'gate.intent.approved', 'gate.spec.approved', 'gate.plan.approved']);
  });

  it('hooks answer Claude Code in its own JSON format', () => {
    const allowed = cli(['hook', 'pre-tool'], {}, JSON.stringify({ session_id: 'e2e', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'src/greet.js') } }));
    expect(allowed.stdout.trim()).toBe('');
    const denied = cli(['hook', 'pre-tool'], {}, JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command: 'sdlc approve review' } }));
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    const session = cli(['hook', 'session-start'], {}, JSON.stringify({ cwd: root, source: 'startup' }));
    expect(JSON.parse(session.stdout).hookSpecificOutput.additionalContext).toMatch(/add-farewell/);
    expect(JSON.parse(session.stdout).hookSpecificOutput.additionalContext).toContain(`scdl ${VERSION}, license: community`);
  });

  it('logs hook denials with the rule and tool, never the command text', () => {
    cli(['hook', 'pre-tool'], {}, JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command: 'sdlc approve plan --token s3cr3t' } }));
    const denial = logEntries().filter((e) => e.event === 'hook.denied').at(-1)!;
    expect(denial).toMatchObject({ agent: 'claude', detail: 'separation-of-duties: Bash', scdl: VERSION, license: COMMUNITY });
    expect(read(path.join(root, 'openspec/.sdlc/log.jsonl'))).not.toContain('s3cr3t');
  });

  it('records verification evidence and checks scenario coverage', () => {
    write(path.join(root, 'test/greet.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { farewell } from '../src/greet.js';\ntest('Named farewell', () => assert.equal(farewell('Ada'), 'Goodbye, Ada'));\n");
    fs.appendFileSync(path.join(root, 'src/greet.js'), '\nexport function farewell(name = "friend") {\n  return `Goodbye, ${name}`;\n}\n');
    write(path.join(changeDir(), 'tasks.md'), FILES['tasks.md'].replace(/- \[ \]/g, '- [x]'));
    const v = cli(['verify', '--change', 'add-farewell', '--json']);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    expect(v.json().status).toBe('passed');
    const evidence = read(path.join(changeDir(), 'verification.md'));
    expect(evidence).toMatch(/sdlc:evidence:start[\s\S]*npm test[\s\S]*sdlc:evidence:end/);
    expect(evidence).toContain(`- **Harness**: scdl ${VERSION}, license: ${COMMUNITY}`);
    expect(evidence.trimEnd()).toMatch(/<!-- sdlc-provenance: scdl [^\n]+ -->$/);
    expect(parse(read(path.join(changeDir(), '.sdlc.yaml'))).verify).toMatchObject({ status: 'passed', scdl: VERSION, license: COMMUNITY });
    expect(cli(['verify', '--check', '--strict', '--change', 'add-farewell']).code).toBe(1);
    fs.writeFileSync(path.join(changeDir(), 'verification.md'), evidence.replace(/(## Behavioral verification[\s\S]*?\|---\|---\|---\|---\|\n)/, '$1| Named farewell | node --test | Goodbye, Ada | PASS |\n'));
    expect(cli(['verify', '--check', '--strict', '--change', 'add-farewell']).code).toBe(0);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'farewell']);
    expect(cli(['status', '--change', 'add-farewell', '--json']).json().change.gates.find((g: { id: string }) => g.id === 'verify').status).toBe('passed');
  });

  it('blocks the review gate on open important findings, then approves after the fix', () => {
    const ctx = cli(['review', 'context', '--change', 'add-farewell', '--json']).json();
    expect(ctx.planDrift.unplanned).toEqual([]);
    write(path.join(changeDir(), 'review.md'), '# Review\n\n## Findings\n\n### F1 [important][bugs] empty names\n- **Where**: src/greet.js:5\n- **Status**: open\n');
    expect(cli(['review', 'check', '--change', 'add-farewell']).code).toBe(1);
    expect(cli(['approve', 'review', '--change', 'add-farewell', '--json']).json().status[0].code).toBe('gate_blocked');
    write(path.join(changeDir(), 'review.md'), read(path.join(changeDir(), 'review.md')).replace('Status**: open', 'Status**: fixed (default name)'));
    expect(cli(['review', 'check', '--change', 'add-farewell']).code).toBe(0);
    expect(cli(['approve', 'review', '--change', 'add-farewell']).code).toBe(0);
    expect(cli(['status', '--change', 'add-farewell', '--markdown']).stdout).toMatch(/\| review \| approved \|/);
  });

  it('archives through OpenSpec, merging the delta into the living spec', () => {
    const r = cli(['archive', 'add-farewell', '--yes', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json().archive.totals).toMatchObject({ added: 1 });
    expect(read(path.join(root, 'openspec/specs/greeting/spec.md'))).toMatch(/### Requirement: Farewell message/);
    const archived = fs.readdirSync(path.join(root, 'openspec/changes/archive')).find((d) => d.endsWith('-add-farewell'))!;
    const history = read(path.join(root, 'openspec/changes/archive', archived, '.sdlc.yaml'));
    expect(history).toMatch(/event: change.archived/);
    for (const f of ['intent.md', 'proposal.md', 'design.md', 'plan.md', 'tasks.md', 'verification.md', 'review.md']) {
      expect(read(path.join(root, 'openspec/changes/archive', archived, f)), f).toContain(`sdlc-provenance: scdl ${VERSION}`);
    }
    expect(read(path.join(root, 'openspec/specs/greeting/spec.md'))).not.toContain('sdlc-provenance');
    expect(logEntries().at(-1)).toMatchObject({ event: 'change.archived', change: 'add-farewell', scdl: VERSION, license: COMMUNITY });
    expect(cli(['openspec', 'list', '--specs', '--json']).json().specs).toEqual([{ id: 'greeting', requirementCount: 1 }]);
    const audit = cli(['audit', '--change', 'add-farewell', '--json']).json();
    expect(audit.metrics.verifyFirstPass).toBe(true);
  });

  it('refuses to archive past open gates unless a person forces it with a reason', () => {
    expect(cli(['new', 'half-done', '--json']).code).toBe(0);
    const r = cli(['archive', 'half-done', '--yes', '--json']);
    expect(r.json().status[0].code).toBe('gates_not_satisfied');
    expect(cli(['archive', 'half-done', '--yes', '--force', '--json']).json().status[0].code).toBe('note_required');
    expect(cli(['archive', 'half-done', '--yes', '--force', '--note', 'abandoned', '--json'], { CLAUDECODE: '1' }).json().status[0].code).toBe('agent_cannot_force');
  });

  it('records a commercial license only from a person, and refreshes the notices', () => {
    expect(cli(['license', 'set', 'commercial', '--agreement', 'ACME-7', '--json'], { CLAUDECODE: '1' }).json().status[0].code)
      .toBe('agent_cannot_approve');
    expect(cli(['license', 'set', 'commercial', '--json']).json().status[0].code).toBe('agreement_required');
    const set = cli(['license', 'set', 'commercial', '--agreement', 'ACME-7', '--licensee', 'Acme Corp', '--json']);
    expect(set.code, set.stdout).toBe(0);
    const commercial = 'commercial (scdl-Commercial, agreement ACME-7, licensee Acme Corp)';
    expect(set.json().harness.license).toBe(commercial);
    expect(set.json().files.updated).toContain('.claude/agents/sdlc-verifier.md');
    expect(read(path.join(root, '.claude/agents/sdlc-verifier.md'))).toContain(`used under the ${commercial} license`);
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).license).toEqual({ type: 'commercial', agreement: 'ACME-7', licensee: 'Acme Corp' });
    expect(logEntries().at(-1)).toMatchObject({ event: 'license.set', detail: commercial, license: commercial });
    expect(cli(['license', '--json']).json().license).toMatchObject({ type: 'commercial', agreement: 'ACME-7' });
    expect(cli(['license', 'set', 'community', '--json']).json().harness.license).toBe(COMMUNITY);
  });

  it('doctor reports a healthy installation', () => {
    const r = cli(['doctor', '--json']);
    expect(r.json().healthy, r.stdout).toBe(true);
  });
});

describe('existing OpenSpec projects', () => {
  it('adds the harness without changing the default schema, and reads spec-driven changes', () => {
    const root = tempDir('sdlc-compat-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    expect(runCli(['openspec', 'init', '--tools', 'none'], root, env).code).toBe(0);
    expect(runCli(['openspec', 'new', 'change', 'legacy-change'], root, env).code).toBe(0);
    write(path.join(root, 'openspec/changes/legacy-change/tasks.md'), '# Tasks\n- [ ] 1.1 thing\n');
    const init = runCli(['init', '--tools', 'opencode', '--no-hooks', '--json'], root, env).json();
    expect(init.openspec.created).toBe(false);
    expect(read(path.join(root, 'openspec/config.yaml'))).toMatch(/^schema: spec-driven/m);
    expect(fs.existsSync(path.join(root, '.opencode/skills/sdlc-intent/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
    const view = runCli(['status', '--change', 'legacy-change', '--json'], root, env).json().change;
    expect(view.schema).toBe('spec-driven');
    expect(view.gates.find((g: { id: string }) => g.id === 'intent').status).toBe('n/a');
    expect(view.gates.find((g: { id: string }) => g.id === 'plan').artifacts).toEqual(['tasks']);
    expect(view.next).toMatchObject({ actor: 'agent', artifact: 'proposal' });
  });

  it('--opsx also installs OpenSpec workflows side by side', () => {
    const root = tempDir('sdlc-opsx-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    expect(runCli(['init', '--tools', 'claude', '--opsx', '--json'], root, env).json().opsx).toBe('installed');
    expect(fs.existsSync(path.join(root, '.claude/skills/openspec-propose/SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.claude/skills/sdlc-intent/SKILL.md'))).toBe(true);
  });
});
