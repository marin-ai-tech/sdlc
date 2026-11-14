import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { git, initGitRepo, tempDir, write } from './helpers.js';

// OpenSpec change inline-node-literals-are-not-targets (E2E OpenCode 2026-11-14: P5).
// A project with an active change whose plan is not approved: a write into the project is a plan-gate denial.

function project() {
  const root = tempDir('inline-node-');
  initGitRepo(root);
  write(path.join(root, 'openspec/config.yaml'), 'schema: sdlc\n');
  write(path.join(root, 'openspec/sdlc.yaml'), 'version: 1\n');
  write(path.join(root, 'src/app.ts'), 'export const x = 1;\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'init']);
  const dir = path.join(root, 'openspec/changes/add-export');
  write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
  writeChangeState(dir, newChangeState());
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  const ctx = { paths: projectPaths(root), config };
  return (command: string) => evaluateToolCall(normalizeToolCall('Bash', { command }, root), ctx);
}

describe('inline node literals in data positions are not write targets (P5)', () => {
  it('P5.C1 a read-only stdin pipeline before the plan gate is allowed', () => {
    const code = [
      "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{",
      'const j=JSON.parse(d);',
      "console.log(j.change.gates.find(g=>g.id==='plan'))})",
    ].join('');
    const result = project()(`sdlc status --json | node -e "${code}"`);
    expect(result.decision).toBe('allow');
    expect(result.reason ?? '').not.toMatch(/\bdata\b|\bend\b/);
  });

  it('P5.C2 compared values and object keys are not targets', () => {
    const result = project()(`node -e "const o={plan:1,'build':2};if(o.x!=='spec')console.log(o)"`);
    expect(result.decision).toBe('allow');
  });

  it('P5.C3 negative: a literal given to a write call stays a target', () => {
    const code = "process.stdin.on('end',()=>require('fs').writeFileSync('src/a.ts','x'))";
    const result = project()(`node -e "${code}"`);
    // Refused either as the plan-gate write it is or as code the hook cannot read: never allowed.
    expect(result.decision).toBe('deny');
  });
});

describe('P5.C5 a data literal turned into a path is still refused (lead review)', () => {
  it.each([
    `node -e "const k=Object.keys({'src/evil.js':0})[0];require('fs').writeFileSync(k,'x')"`,
    `node -e "const t={'src/evil.js':1};for(const k in t)require('fs').writeFileSync(k,'x')"`,
    `node -e "const E=require('events');const e=new E();e.on('src/evil.js',()=>{});`
      + `require('fs').writeFileSync(e.eventNames()[0],'x')"`,
  ])('%s', (command) => {
    expect(project()(command).decision).toBe('deny');
  });
});

describe('the conservative state reading holds (P5.C4, B245.C2)', () => {
  it('a glob-like literal in opaque code is still refused near a change state file', () => {
    const root = tempDir('inline-node-state-');
    write(path.join(root, 'openspec/changes/demo/.sdlc.yaml'), 'version: 1\n');
    const config = defaultConfig();
    config.enforcement.mode = 'block';
    config.enforcement.requireApprovedPlan = false;
    const call = normalizeToolCall('Bash', { command: `node -e 'const op="*";console.log(op)'` }, root);
    const result = evaluateToolCall(call, { paths: projectPaths(root), config });
    expect(result).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});
