import * as fs from 'node:fs';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { git, humanEnv, initGitRepo, read, REPO_ROOT, runCli, tempDir, write } from './helpers.js';

/**
 * One project, the whole 0.3.0 path, with the bundled OpenSpec CLI:
 * layout adapt → explore → change from the exploration (agent asks for lite,
 * a person decides) → intent/spec/plan approvals → verify → review with lenses,
 * coverage and a deferred finding → archive → report/dashboard → BMAD import.
 */
const FILES: Record<string, string> = {
  'intent.md': '# Intent: say goodbye\n\nAuthor: Pat (web). Status: draft. Source: exploration openspec/explorations/farewell.md\n\n## Problem\nSessions end without a goodbye.\n\n## Proposed outcome\nUsers see a named farewell.\n\n## Affected users and systems\nAll users.\n\n## Constraints\nNone\n\n## Success measures\nShown on sign-out.\n\n## Out of scope\nLocalization.\n\n## Open questions\nNone\n',
  'proposal.md': '# Proposal\n\n## Why\n\nSessions end abruptly because users never see a farewell message that uses their name.\n\n## What Changes\n\n- Add farewell(name).\n\n## Capabilities\n\n### New Capabilities\n- `greeting`: greeting and farewell messages\n\n## Impact\n\nsrc/greet.js\n',
  'specs/greeting/spec.md': '# Spec Delta\n\n## Purpose\n\nProvide friendly, personalized greeting and farewell messages to users.\n\n## ADDED Requirements\n\n### Requirement: Farewell message\nThe system SHALL produce a farewell message that includes the user\'s name.\n\n#### Scenario: Named farewell\n- **WHEN** Ada signs out\n- **THEN** the message is "Goodbye, Ada"\n',
  'design.md': '# Design\n\n## Context\nsrc/greet.js\n\n## Decisions\nAdd farewell next to greet.\n\n## Policy compliance\nNone apply.\n\n## Areas of concern\nNone identified\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/greet.js` (modified)\n- `test/greet.test.js` (new)\n\n## Order of work\n1. Test. 2. Implement.\n\n## Proof\n`npm test`\n\n## Rollback\nRevert.\n',
  'tasks.md': '# Tasks\n\n## 1. Farewell\n\n- [ ] 1.1 Add test/greet.test.js and verify it fails first\n- [ ] 1.2 Implement farewell and verify npm test passes\n',
};

const COVERAGE = (compliance: string) => [
  '## Coverage',
  '- bugs: 1 finding',
  '- security: none found — checked: no input reaches a shell, a query or a log',
  `- compliance: ${compliance}`,
  '- adversarial: none found — checked: very long names, markup in names',
  '- edge-cases: none found — checked: undefined and empty names',
  '- verification-gaps: none found — checked: the scenario test asserts the exact message',
].join('\n');

describe('full lifecycle e2e (0.3.0)', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;
  const cli = (args: string[], extra: NodeJS.ProcessEnv = {}, input?: string) => runCli(args, root, { ...env, ...extra }, input);
  const AGENT = { CLAUDECODE: '1' };
  const change = (id: string) => path.join(root, 'openspec/changes', id);
  const events = () => read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l));

  beforeAll(() => {
    root = tempDir('sdlc-full-');
    env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    write(path.join(root, 'package.json'), JSON.stringify({ name: 'demo-shop', type: 'module', scripts: { test: 'node --test' } }));
    write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
    write(path.join(root, 'ARCHITECTURE.md'), '# Architecture\n\nOne module: src/greet.js.\n');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'init']);
  });

  it('1. init installs every workflow, including explore, for both tools', () => {
    const r = cli(['init', '--tools', 'claude,opencode', '--json']);
    expect(r.code, r.stderr).toBe(0);
    for (const f of ['.claude/skills/sdlc-explore/SKILL.md', '.claude/commands/sdlc/explore.md', '.opencode/commands/sdlc-explore.md', 'REVIEW.md']) {
      expect(fs.existsSync(path.join(root, f)), f).toBe(true);
    }
    expect(read(path.join(root, 'REVIEW.md'))).toMatch(/^## Lenses/m);
    expect(parse(read(path.join(root, 'openspec/sdlc.yaml'))).review.require_lens_coverage).toBe(true);
  });

  it('2. layout adapt makes the project AI-ready without moving anything', () => {
    expect(cli(['layout', 'check', '--json']).json().ready).toBe(false);
    const adapt = cli(['layout', 'adapt', '--json']);
    expect(adapt.code, adapt.stderr).toBe(0);
    expect(adapt.json().mapping).toEqual({ architecture: 'ARCHITECTURE.md' });
    expect(cli(['layout', 'check', '--json']).json().ready).toBe(true);
    expect(read(path.join(root, 'AGENTS.md'))).toContain('](ARCHITECTURE.md)');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'sdlc init + layout adapt']);
  });

  it('3. an agent explores the idea before any change exists', () => {
    const r = cli(['explore', 'farewell', '--json'], AGENT);
    expect(r.code, r.stderr).toBe(0);
    const note = path.join(root, r.json().path);
    fs.appendFileSync(note, '\nProceed: users asked for it in support tickets.\n');
    expect(fs.existsSync(path.join(root, 'openspec/changes'))).toBe(true);
    expect(fs.readdirSync(path.join(root, 'openspec/changes')).filter((d) => d !== 'archive')).toEqual([]);
  });

  it('4. the agent asks for lite; the change starts full; the hook and the CLI keep the decision with a person', () => {
    const r = cli(['new', 'add-farewell', '--kind', 'feature', '--risk', 'low', '--track', 'lite',
      '--source-type', 'exploration', '--source-ref', 'openspec/explorations/farewell.md', '--json'], AGENT);
    expect(r.code, r.stderr).toBe(0);
    expect(r.json().change).toMatchObject({ track: 'full', trackSuggestion: { track: 'lite' }, source: { type: 'exploration' } });
    expect(cli(['track', 'set', 'lite', '--change', 'add-farewell', '--json'], AGENT).json().status[0].code).toBe('agent_cannot_set_track');
    const denied = cli(['hook', 'pre-tool'], {}, JSON.stringify({ cwd: root, tool_name: 'Bash', tool_input: { command: 'sdlc track set lite --change add-farewell' } }));
    expect(JSON.parse(denied.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    // The person decides a new feature keeps the full track (this also clears the suggestion).
    expect(cli(['track', 'set', 'full', '--change', 'add-farewell', '--note', 'new behavior needs a spec', '--json']).code).toBe(0);
    expect(cli(['status', '--change', 'add-farewell', '--json']).json().change.warnings.join('\n')).not.toMatch(/track set/);
  });

  it('5. intent → spec → plan with human approvals', () => {
    write(path.join(change('add-farewell'), 'intent.md'), FILES['intent.md']);
    expect(cli(['approve', 'intent', '--change', 'add-farewell']).code).toBe(0);
    for (const f of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(path.join(change('add-farewell'), f), FILES[f]);
    expect(cli(['validate', '--change', 'add-farewell', '--json']).code).toBe(0);
    expect(cli(['approve', 'spec', '--change', 'add-farewell']).code).toBe(0);
    for (const f of ['plan.md', 'tasks.md']) write(path.join(change('add-farewell'), f), FILES[f]);
    expect(cli(['approve', 'plan', '--change', 'add-farewell']).code).toBe(0);
    expect(cli(['track', 'set', 'lite', '--change', 'add-farewell', '--json']).json().status[0].code).toBe('plan_already_approved');
  });

  it('6. build and verify with recorded evidence', () => {
    write(path.join(root, 'test/greet.test.js'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { farewell } from '../src/greet.js';\ntest('Named farewell', () => assert.equal(farewell('Ada'), 'Goodbye, Ada'));\n");
    fs.appendFileSync(path.join(root, 'src/greet.js'), '\nexport function farewell(name = "friend") {\n  return `Goodbye, ${name}`;\n}\n');
    write(path.join(change('add-farewell'), 'tasks.md'), FILES['tasks.md'].replace(/- \[ \]/g, '- [x]'));
    const v = cli(['verify', '--change', 'add-farewell', '--json']);
    expect(v.code, v.stdout + v.stderr).toBe(0);
    const evidence = read(path.join(change('add-farewell'), 'verification.md'));
    fs.writeFileSync(path.join(change('add-farewell'), 'verification.md'), evidence.replace(/(## Behavioral verification[\s\S]*?\|---\|---\|---\|---\|\n)/, '$1| Named farewell | node --test | Goodbye, Ada | PASS |\n'));
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'farewell']);
    expect(cli(['status', '--change', 'add-farewell', '--json']).json().change.gates.find((g: { id: string }) => g.id === 'verify').status).toBe('passed');
  });

  it('7. review: lenses in the context, missing coverage blocks, a deferred finding needs a registry item', () => {
    const ctx = cli(['review', 'context', '--change', 'add-farewell', '--json']).json();
    expect(ctx.lenses).toEqual(['adversarial', 'edge-cases', 'verification-gaps']);
    const findings = '## Findings\n\n### F1 [important][bugs] Empty name gives "Goodbye, "\n- **Where**: src/greet.js:5\n- **Status**: fixed (default name)\n\n### F2 [nit][compliance] Farewell is not localized\n- **Where**: src/greet.js:5\n- **Status**: deferred (D1)\n';
    const reviewFile = path.join(change('add-farewell'), 'review.md');
    write(reviewFile, `# Review: add-farewell\n\n${findings}`);
    expect(cli(['review', 'check', '--change', 'add-farewell']).code).toBe(1);
    expect(cli(['approve', 'review', '--change', 'add-farewell', '--json']).json().status[0].code).toBe('gate_blocked');

    write(reviewFile, `# Review: add-farewell\n\n${findings}\n${COVERAGE('1 finding')}\n`);
    const unlinked = cli(['review', 'check', '--change', 'add-farewell', '--json']);
    expect(unlinked.code).toBe(1);
    expect(unlinked.json().deferred.missing).toEqual([expect.objectContaining({ id: 'D1' })]);

    const d = cli(['defer', 'add', 'Localize the farewell', '--why', 'English-only pilot', '--change', 'add-farewell', '--finding', 'F2', '--revisit', 'before the EU launch', '--json'], AGENT);
    expect(d.json().item.id).toBe('D1');
    expect(cli(['review', 'check', '--change', 'add-farewell']).code).toBe(0);
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'review']);
    const approve = cli(['approve', 'review', '--change', 'add-farewell']);
    expect(approve.code, approve.stdout + approve.stderr).toBe(0);
  });

  it('8. archive merges the delta; the deferred item outlives the change', () => {
    const r = cli(['archive', 'add-farewell', '--yes', '--json']);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(read(path.join(root, 'openspec/specs/greeting/spec.md'))).toMatch(/### Requirement: Farewell message/);
    expect(cli(['defer', 'list', '--open', '--json']).json().items.map((i: { id: string }) => i.id)).toEqual(['D1']);
  });

  it('9. BMAD planning comes in as a draft change that passes validation, with its deferred items', () => {
    for (const f of fs.readdirSync(path.join(REPO_ROOT, 'test/fixtures/bmad/claims'))) {
      write(path.join(root, '_bmad-output/claims', f), fs.readFileSync(path.join(REPO_ROOT, 'test/fixtures/bmad/claims', f), 'utf-8'));
    }
    const r = cli(['import', 'bmad', '_bmad-output/claims', '--change', 'claims-status', '--json'], AGENT);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(cli(['validate', '--change', 'claims-status', '--json']).code).toBe(0);
    const gates = cli(['status', '--change', 'claims-status', '--json']).json().change.gates;
    expect(gates.some((g: { status: string }) => g.status === 'approved')).toBe(false);
    expect(cli(['defer', 'list', '--open', '--json']).json().items.map((i: { id: string }) => i.id)).toEqual(['D1', 'D2', 'D3']);
  });

  it('10. report and dashboard show the whole picture; every step is in the log', () => {
    const model = cli(['report', '--json']).json();
    expect(model.summary).toMatchObject({ active: 1, archived: 1 });
    expect(model.deferred.open).toBe(3);
    expect(model.layout.ready).toBe(true);
    const html = cli(['dashboard']).stdout;
    expect(html).toContain('Localize the farewell');
    expect(html).toContain('claims-status');
    const names = events().map((e) => e.event);
    for (const e of ['harness.initialized', 'layout.adapted', 'exploration.created', 'change.created', 'track.set', 'gate.intent.approved',
      'gate.spec.approved', 'gate.plan.approved', 'gate.review.approved', 'deferred.added', 'change.archived', 'change.imported']) {
      expect(names, e).toContain(e);
    }
    expect(cli(['doctor', '--json']).json().healthy).toBe(true);
  });
});
