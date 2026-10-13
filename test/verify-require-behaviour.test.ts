import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { FILES, fillBehaviour, writeWork } from './farewell-fixture.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * B110 (0.18.0), part 1: `verify.require_behaviour: true` makes the verify gate require the behavioural table of
 * verification.md — one row per spec scenario — as `sdlc verify --check --strict` checks it. Without the rows the
 * gate is not satisfied (its reason names the uncovered scenarios); with them it passes. Default false: as before.
 */

function project(requireBehaviour?: unknown) {
  const root = tempDir('sdlc-require-behaviour-');
  initGitRepo(root);
  const pkg = { name: 'demo', type: 'module', scripts: { test: 'node --test' } };
  write(path.join(root, 'package.json'), JSON.stringify(pkg));
  write(path.join(root, 'src/greet.js'), 'export function greet(name) {\n  return `Hello, ${name}`;\n}\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  const env = humanEnv(tempDir('sdlc-home-'));
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  if (requireBehaviour !== undefined) {
    const file = path.join(root, 'openspec/sdlc.yaml');
    const config = parse(read(file));
    config.verify.require_behaviour = requireBehaviour;
    write(file, stringify(config));
  }
  return { root, cli };
}

function toVerified(p: ReturnType<typeof project>): void {
  const change = (file: string) => path.join(p.root, 'openspec/changes/add-farewell', file);
  expect(p.cli(['new', 'add-farewell', '--json']).code).toBe(0);
  write(change('intent.md'), FILES['intent.md']);
  expect(p.cli(['approve', 'intent', '--change', 'add-farewell']).code).toBe(0);
  for (const file of ['proposal.md', 'specs/greeting/spec.md', 'design.md']) write(change(file), FILES[file]);
  expect(p.cli(['approve', 'spec', '--change', 'add-farewell']).code).toBe(0);
  for (const file of ['plan.md', 'tasks.md']) write(change(file), FILES[file]);
  expect(p.cli(['approve', 'plan', '--change', 'add-farewell']).code).toBe(0);
  writeWork(p.root, 'add-farewell');
  expect(p.cli(['verify', '--change', 'add-farewell', '--json']).code).toBe(0);
}

const verifyGate = (p: ReturnType<typeof project>) => p.cli(['status', '--change', 'add-farewell', '--json']).json()
  .change.gates.find((gate: { id: string }) => gate.id === 'verify');

describe('B110: verify.require_behaviour', () => {
  it('without the behavioural rows the verify gate is not satisfied, and says which scenario is missing', () => {
    const p = project(true);
    toVerified(p);
    const gate = verifyGate(p);
    expect(gate.satisfied).toBe(false);
    expect(JSON.stringify(gate)).toContain('Named farewell');
    fillBehaviour(p.root, 'add-farewell');
    expect(verifyGate(p).satisfied).toBe(true);
  }, 240000);

  it('negative: by default the verify gate passes without the table, as before', () => {
    const p = project();
    toVerified(p);
    expect(verifyGate(p)).toMatchObject({ status: 'passed', satisfied: true });
  }, 240000);

  it('negative: require_behaviour must be true or false', () => {
    const p = project('yes');
    const r = p.cli(['status', '--json']);
    expect(r.code).not.toBe(0);
    expect(r.json().status[0].code).toBe('invalid_config');
  }, 120000);
});
