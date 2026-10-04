import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, type SdlcConfig } from '../src/core/config.js';
import { newChangeState, readChangeState, writeChangeState, type ChangeState } from '../src/core/change-state.js';
import { evaluateChange } from '../src/core/lifecycle.js';
import { worktreeFingerprint } from '../src/core/git.js';
import { evaluateToolCall, normalizeToolCall, sessionSummary } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

const ARTIFACTS: Record<string, string> = {
  'intent.md': '# Intent\n\n## Problem\nUsers cannot export data.\n',
  'proposal.md': '# Proposal\n\n## Why\nUsers need to take their data out of the product in a portable format.\n\n## What Changes\n- export\n',
  'specs/export/spec.md': '## Purpose\nLets users export their data in a portable, documented format.\n\n## ADDED Requirements\n### Requirement: Export\nThe system SHALL export CSV.\n\n#### Scenario: Export works\n- **WHEN** asked\n- **THEN** CSV\n',
  'design.md': '# Design\n\n## Decisions\nCSV.\n',
  'plan.md': '# Plan\n\n## Files that change\n- `src/export.ts`\n',
  'tasks.md': '# Tasks\n\n## 1. Export\n- [ ] 1.1 Implement export and verify the test passes\n',
};

function project(config: SdlcConfig = defaultConfig()) {
  const root = tempDir();
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: sdlc\n');
  write(path.join(root, 'openspec/sdlc.yaml'), 'version: 1\n');
  write(path.join(root, 'src/app.ts'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  return { root, paths: projectPaths(root), config };
}

function change(root: string, id: string, files: string[], state?: Partial<ChangeState>) {
  const dir = path.join(root, 'openspec/changes', id);
  write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
  for (const f of files) write(path.join(dir, f), ARTIFACTS[f]);
  writeChangeState(dir, { ...newChangeState(), ...state });
  return { id, dir, archived: false };
}

/** Records an approval exactly as `sdlc approve` would (bound to the current digest). */
function approve(root: string, ref: { id: string; dir: string; archived: boolean }, config: SdlcConfig, gate: 'intent' | 'spec' | 'plan' | 'review', role: string) {
  const view = evaluateChange(root, ref, config);
  const g = view.gates.find((x) => x.id === gate)!;
  if (!g.digest) throw new Error(`${gate} not approvable: ${g.status} ${g.reason}`);
  const state = readChangeState(ref.dir);
  state.gates[gate] = { approvals: [{ role, by: 'Pat <pat@example.com>', at: new Date().toISOString(), digest: g.digest }] };
  writeChangeState(ref.dir, state);
}

const all = Object.keys(ARTIFACTS);

describe('lifecycle stages and gates', () => {
  it('starts in Plan and asks the agent for the intent', () => {
    const { root, config } = project();
    const ref = change(root, 'add-export', []);
    const view = evaluateChange(root, ref, config);
    expect(view.stage).toBe('plan');
    expect(view.next).toMatchObject({ actor: 'agent', action: 'write-artifact', artifact: 'intent', workflow: 'intent' });
  });

  it('walks the gates in order and hands decisions to people', () => {
    const { root, config } = project();
    const ref = change(root, 'add-export', all);
    let view = evaluateChange(root, ref, config);
    expect(view.next).toMatchObject({ actor: 'human', action: 'approve-gate', gate: 'intent' });
    approve(root, ref, config, 'intent', 'product-owner');
    expect(evaluateChange(root, ref, config).stage).toBe('design');
    approve(root, ref, config, 'spec', 'product-owner');
    approve(root, ref, config, 'plan', 'engineer');
    view = evaluateChange(root, ref, config);
    expect(view.stage).toBe('build');
    expect(view.next).toMatchObject({ actor: 'agent', action: 'implement' });
  });

  it('makes an approval stale when the approved content changes, but not when tasks are ticked', () => {
    const { root, config } = project();
    const ref = change(root, 'add-export', all);
    approve(root, ref, config, 'intent', 'product-owner');
    approve(root, ref, config, 'spec', 'product-owner');
    approve(root, ref, config, 'plan', 'engineer');
    fs.writeFileSync(path.join(ref.dir, 'tasks.md'), ARTIFACTS['tasks.md'].replace('- [ ]', '- [x]'));
    expect(evaluateChange(root, ref, config).gates.find((g) => g.id === 'plan')!.status).toBe('approved');
    fs.appendFileSync(path.join(ref.dir, 'plan.md'), '\n- `src/other.ts`\n');
    const view = evaluateChange(root, ref, config);
    expect(view.gates.find((g) => g.id === 'plan')!.status).toBe('stale');
    expect(view.next).toMatchObject({ actor: 'human', gate: 'plan' });
  });

  it('requires a tech lead in addition for high-risk changes', () => {
    const { root, config } = project();
    const ref = change(root, 'add-export', all, { risk: 'high' });
    approve(root, ref, config, 'intent', 'product-owner');
    approve(root, ref, config, 'spec', 'product-owner');
    const spec = evaluateChange(root, ref, config).gates.find((g) => g.id === 'spec')!;
    expect(spec.status).toBe('pending');
    expect(spec.missingRoles).toEqual(['tech-lead']);
  });

  it('lite track starts at the plan', () => {
    const { root, config } = project();
    const ref = change(root, 'fix-typo', ['plan.md', 'tasks.md'], { track: 'lite', kind: 'bugfix' });
    const view = evaluateChange(root, ref, config);
    expect(view.gates.find((g) => g.id === 'intent')!.satisfied).toBe(true);
    expect(view.gates.find((g) => g.id === 'spec')!.satisfied).toBe(true);
    expect(view.next).toMatchObject({ actor: 'human', gate: 'plan' });
  });

  it('keeps verification valid across a commit but not across a content change', () => {
    const { root, config } = project();
    const ref = change(root, 'add-export', all);
    for (const [gate, role] of [['intent', 'product-owner'], ['spec', 'product-owner'], ['plan', 'engineer']] as const) approve(root, ref, config, gate, role);
    fs.writeFileSync(path.join(ref.dir, 'tasks.md'), ARTIFACTS['tasks.md'].replace('- [ ]', '- [x]'));
    write(path.join(root, 'src/export.ts'), 'export const csv = () => "a,b";\n');
    const fp = evaluateChange(root, ref, config); // warm
    expect(fp.gates.find((g) => g.id === 'verify')!.status).toBe('pending');
    const state = readChangeState(ref.dir);
    state.verify = { status: 'passed', at: new Date().toISOString(), fingerprint: worktreeFingerprint(root, ['openspec/']), results: [] };
    writeChangeState(ref.dir, state);
    expect(evaluateChange(root, ref, config).gates.find((g) => g.id === 'verify')!.status).toBe('passed');
    git(root, ['add', '-A']);
    git(root, ['commit', '-qm', 'export']);
    expect(evaluateChange(root, ref, config).gates.find((g) => g.id === 'verify')!.status).toBe('passed');
    fs.appendFileSync(path.join(root, 'src/export.ts'), '// change\n');
    expect(evaluateChange(root, ref, config).gates.find((g) => g.id === 'verify')!.status).toBe('stale');
  });
});

describe('policy engine', () => {
  const call = (root: string, tool: string, input: Record<string, unknown>) => normalizeToolCall(tool, input, root);

  it('reminds in warn mode and denies in block mode when no plan is approved', () => {
    const { root, paths, config } = project();
    change(root, 'add-export', all);
    const warn = evaluateToolCall(call(root, 'Edit', { file_path: path.join(root, 'src/app.ts') }), { paths, config });
    expect(warn).toMatchObject({ decision: 'warn', rule: 'plan-gate' });
    config.enforcement.mode = 'block';
    expect(evaluateToolCall(call(root, 'edit', { filePath: 'src/app.ts' }), { paths, config })).toMatchObject({ decision: 'deny' });
    config.enforcement.mode = 'off';
    expect(evaluateToolCall(call(root, 'Edit', { file_path: 'src/app.ts' }), { paths, config }).decision).toBe('allow');
  });

  it('always allows planning artifacts and markdown', () => {
    const { root, paths, config } = project();
    config.enforcement.mode = 'block';
    expect(evaluateToolCall(call(root, 'Write', { file_path: 'openspec/changes/x/plan.md' }), { paths, config }).decision).toBe('allow');
    expect(evaluateToolCall(call(root, 'Write', { file_path: 'docs/guide.md' }), { paths, config }).decision).toBe('allow');
  });

  it('allows code edits once a plan is approved', () => {
    const { root, paths, config } = project();
    config.enforcement.mode = 'block';
    const ref = change(root, 'add-export', all);
    for (const [gate, role] of [['intent', 'product-owner'], ['spec', 'product-owner'], ['plan', 'engineer']] as const) approve(root, ref, config, gate, role);
    expect(evaluateToolCall(call(root, 'Edit', { file_path: 'src/app.ts' }), { paths, config }).decision).toBe('allow');
  });

  it('enforces hard rules even in warn mode', () => {
    const { root, paths, config } = project();
    config.enforcement.protectedPaths = ['src/generated/**'];
    change(root, 'fix-bug', all, { kind: 'bugfix', tests_locked: true });
    const ctx = { paths, config };
    expect(evaluateToolCall(call(root, 'Edit', { file_path: 'src/generated/api.ts' }), ctx)).toMatchObject({ decision: 'deny', rule: 'protected-path' });
    expect(evaluateToolCall(call(root, 'Edit', { file_path: 'src/app.test.ts' }), ctx)).toMatchObject({ decision: 'deny', rule: 'tests-locked' });
    expect(evaluateToolCall(call(root, 'Bash', { command: 'sdlc approve plan --change fix-bug' }), ctx)).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    expect(evaluateToolCall(call(root, 'Bash', { command: "sed -i 's/pending/approved/' openspec/changes/fix-bug/.sdlc.yaml" }), ctx)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(evaluateToolCall(call(root, 'Bash', { command: 'cat openspec/changes/fix-bug/.sdlc.yaml' }), ctx).decision).toBe('allow');
    expect(evaluateToolCall(call(root, 'Write', { file_path: 'openspec/changes/fix-bug/.sdlc.yaml' }), ctx)).toMatchObject({ decision: 'deny' });
    expect(evaluateToolCall(call(root, 'Edit', { file_path: 'openspec/.sdlc/log.jsonl' }), ctx)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(evaluateToolCall(call(root, 'Bash', { command: 'echo {} >> openspec/.sdlc/log.jsonl' }), ctx)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(evaluateToolCall(call(root, 'Bash', { command: 'tail openspec/.sdlc/log.jsonl' }), ctx).decision).toBe('allow');
    expect(evaluateToolCall(call(root, 'Bash', { command: 'make deploy ENV=production' }), ctx)).toMatchObject({ decision: 'deny', rule: 'release-gate' });
    expect(evaluateToolCall(call(root, 'Bash', { command: 'make deploy ENV=production' }), { ...ctx, env: { SDLC_RELEASE_APPROVAL: 'CHG-1' } }).decision).toBe('allow');
    expect(evaluateToolCall(call(root, 'Bash', { command: 'npm test' }), ctx).decision).toBe('allow');
  });

  it('reads files touched by an OpenCode apply_patch', () => {
    const c = normalizeToolCall('apply_patch', { patchText: '*** Begin Patch\n*** Update File: src/a.ts\n@@\n*** Add File: src/b.ts\n*** End Patch' }, '/r');
    expect(c).toMatchObject({ kind: 'edit', files: ['src/a.ts', 'src/b.ts'] });
  });

  it('summarizes active changes for session context', () => {
    const { root, paths, config } = project();
    change(root, 'add-export', ['intent.md']);
    expect(sessionSummary({ paths, config })).toMatch(/add-export: stage plan/);
    expect(sessionSummary({ paths, config })).toMatch(/^SDLC harness \(sdlc \d+\.\d+\.\d+, license: community /);
  });
});
