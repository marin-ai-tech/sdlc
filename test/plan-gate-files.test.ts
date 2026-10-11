import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig, type SdlcConfig } from '../src/core/config.js';
import { newChangeState, readChangeState, writeChangeState } from '../src/core/change-state.js';
import { evaluateChange } from '../src/core/lifecycle.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

/**
 * 0.14.6 (decided by the product owner): the plan gate by the files of the plan. With one active change the gate
 * is as before: once its plan is approved, the agent may edit code. With several active changes, an edit (or a
 * shell write) of code is allowed only in a file that an approved plan lists under "## Files that change";
 * anything else is the plan gate (deny in block mode, a reminder in warn mode). Before this, one approved plan
 * opened the whole project, also for another change that had no plan.
 */

const BASE: Record<string, string> = {
  'intent.md': '# Intent\n\n## Problem\nUsers cannot export data.\n',
  'proposal.md': '# Proposal\n\n## Why\nUsers need to take their data out of the product in a portable format.\n\n'
    + '## What Changes\n- export\n',
  'specs/export/spec.md': '## Purpose\nLets users export their data in a portable, documented format.\n\n'
    + '## ADDED Requirements\n### Requirement: Export\nThe system SHALL export CSV.\n\n#### Scenario: Export works\n'
    + '- **WHEN** asked\n- **THEN** CSV\n',
  'design.md': '# Design\n\n## Decisions\nCSV.\n',
  'tasks.md': '# Tasks\n\n## 1. Export\n- [ ] 1.1 Implement export and verify the test passes\n',
};

type Ref = { id: string; dir: string; archived: boolean };

function project(mode: 'block' | 'warn' = 'block') {
  const root = tempDir('sdlc-plan-gate-files-');
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: sdlc\n');
  write(path.join(root, 'openspec/sdlc.yaml'), 'version: 1\n');
  write(path.join(root, 'src/app.ts'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const config: SdlcConfig = defaultConfig();
  config.enforcement.mode = mode;
  const ctx = { paths: projectPaths(root), config };
  const edit = (file: string) =>
    evaluateToolCall(normalizeToolCall('Write', { file_path: path.join(root, file) }, root), ctx);
  const shell = (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
  return { root, config, edit, shell };
}

function change(root: string, id: string, planFiles?: string) {
  const dir = path.join(root, 'openspec/changes', id);
  write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
  for (const [file, text] of Object.entries(BASE)) write(path.join(dir, file), text);
  if (planFiles !== undefined) write(path.join(dir, 'plan.md'), `# Plan\n\n## Files that change\n${planFiles}\n`);
  writeChangeState(dir, newChangeState());
  return { id, dir, archived: false };
}

function approve(root: string, ref: Ref, config: SdlcConfig, gate: 'intent' | 'spec' | 'plan', role: string) {
  const g = evaluateChange(root, ref, config).gates.find((x) => x.id === gate)!;
  if (!g.digest) throw new Error(`${gate} not approvable: ${g.status} ${g.reason}`);
  const state = readChangeState(ref.dir);
  const approval = { role, by: 'Pat <pat@example.com>', at: new Date().toISOString(), digest: g.digest };
  state.gates[gate] = { approvals: [approval] };
  writeChangeState(ref.dir, state);
}

function approveAll(root: string, ref: Ref, config: SdlcConfig) {
  approve(root, ref, config, 'intent', 'product-owner');
  approve(root, ref, config, 'spec', 'product-owner');
  approve(root, ref, config, 'plan', 'engineer');
}

describe('the plan gate by the files of the plan', () => {
  it('one active change with an approved plan: code edits are allowed as before, also outside the plan', () => {
    const p = project();
    approveAll(p.root, change(p.root, 'add-export', '- `src/export.ts`'), p.config);
    expect(p.edit('src/export.ts').decision).toBe('allow');
    expect(p.edit('src/other.ts').decision).toBe('allow');
  });

  it('several active changes: only the files of an approved plan are open; the rest is the plan gate', () => {
    const p = project();
    approveAll(p.root, change(p.root, 'add-export', '- `src/export.ts`\n- src/csv.ts (new)'), p.config);
    change(p.root, 'add-import');
    expect(p.edit('src/export.ts').decision).toBe('allow');
    expect(p.edit('src/csv.ts').decision).toBe('allow');
    expect(p.edit('src/import.ts')).toMatchObject({ decision: 'deny', rule: 'plan-gate' });
    expect(p.shell('echo x > src/import.ts')).toMatchObject({ decision: 'deny', rule: 'plan-gate' });
    expect(p.edit('openspec/changes/add-import/plan.md').decision).toBe('allow');
  });

  it('two approved plans: the files of either are open, other code is not', () => {
    const p = project();
    approveAll(p.root, change(p.root, 'add-export', '- `src/export.ts`'), p.config);
    approveAll(p.root, change(p.root, 'add-import', '- `src/import.ts`'), p.config);
    expect(p.edit('src/export.ts').decision).toBe('allow');
    expect(p.edit('src/import.ts').decision).toBe('allow');
    expect(p.edit('src/other.ts')).toMatchObject({ decision: 'deny', rule: 'plan-gate' });
  });

  it('a glob in an approved plan opens the files it matches', () => {
    const p = project();
    approveAll(p.root, change(p.root, 'add-export', '- `src/export/**`'), p.config);
    change(p.root, 'add-import');
    expect(p.edit('src/export/csv.ts').decision).toBe('allow');
    expect(p.edit('src/import.ts')).toMatchObject({ decision: 'deny', rule: 'plan-gate' });
  });

  it('an approved plan that lists no file opens nothing when another change is active', () => {
    const p = project();
    approveAll(p.root, change(p.root, 'add-export', 'The export module.'), p.config);
    change(p.root, 'add-import');
    expect(p.edit('src/export.ts')).toMatchObject({ decision: 'deny', rule: 'plan-gate' });
  });

  it('negative: warn mode reminds instead of denying', () => {
    const p = project('warn');
    approveAll(p.root, change(p.root, 'add-export', '- `src/export.ts`'), p.config);
    change(p.root, 'add-import');
    expect(p.edit('src/import.ts')).toMatchObject({ decision: 'warn', rule: 'plan-gate' });
  });
});
