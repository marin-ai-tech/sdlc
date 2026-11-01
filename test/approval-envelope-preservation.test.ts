import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readChangeState, writeChangeState } from '../src/core/change-state.js';
import { decisionProject } from './e20-decision-fixture.js';
import { read, tempDir, write } from './helpers.js';

const SUBTREES = [
  '  intent: "not a gate" # retain this spelling\n',
  '  intent: # retained envelope\n    approvals: { odd: \'shape\' } # retained container\n',
  '  intent: # retained envelope\n    approvals: null # explicit null is malformed\n',
];

function seed(dir: string, subtree: string): string {
  const file = path.join(dir, '.sdlc.yaml');
  const text = `version: 1\nkind: feature\nrisk: high\ntrack: full\ncreated: now\ngates:\n${subtree}history: []\n`;
  write(file, text);
  return file;
}

describe('Opaque malformed decisions', () => {
  it.each(SUBTREES)('retains exact raw subtree bytes through an unrelated state write: %s', (subtree) => {
    const dir = tempDir('sdlc-opaque-');
    const file = seed(dir, subtree);
    const state = readChangeState(dir);
    expect(state.gates.intent?.approvals ?? []).toEqual([]);
    state.tests_locked = true;
    writeChangeState(dir, state);
    expect(read(file)).toContain(subtree);
  });

  it.each(['drop', 'archive'])('retains the opaque subtree through %s', (command) => {
    const p = decisionProject();
    seed(p.dir, SUBTREES[1]);
    const args = command === 'drop' ? ['drop', 'demo', '--note', 'retire']
      : ['archive', 'demo', '--yes', '--skip-specs', '--force', '--note', 'retire'];
    const result = p.cli([...args, '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const archive = path.join(p.root, 'openspec/changes/archive');
    const folder = fs.readdirSync(archive).find((name) => name.endsWith('-demo'))!;
    expect(read(path.join(archive, folder, '.sdlc.yaml'))).toContain(SUBTREES[1]);
  }, 120000);

  it.each(['approve', 'waive', 'reject'])('%s refuses before state/log/checkpoint writes', (command) => {
    const p = decisionProject();
    seed(p.dir, SUBTREES[1]);
    const state = read(p.stateFile);
    const logFile = path.join(p.root, 'openspec/.sdlc/log.jsonl');
    const log = read(logFile);
    const refs = () => spawnSync('git', ['for-each-ref', 'refs/sdlc'],
      { cwd: p.root, encoding: 'utf8', timeout: 30000 }).stdout;
    const beforeRefs = refs();
    const result = p.cli([command, 'intent', '--change', 'demo', '--note', 'inspect', '--json']);
    expect(result.code, result.stdout + result.stderr).toBe(1);
    expect(result.json().status[0].code).toBe('malformed_gate');
    expect(JSON.stringify(result.json())).toMatch(/doctor|inspect|recover/i);
    expect(read(p.stateFile)).toBe(state);
    expect(read(logFile)).toBe(log);
    expect(refs()).toBe(beforeRefs);
  }, 120000);

  it('doctor names the malformed gate shape without treating it as authority', () => {
    const p = decisionProject();
    seed(p.dir, SUBTREES[1]);
    expect(p.gate().approvals).toEqual([]);
    const result = p.cli(['doctor', '--json']);
    expect(JSON.stringify(result.json())).toMatch(/demo.*intent|intent.*demo/);
    expect(JSON.stringify(result.json())).toMatch(/approvals.*(?:container|list|array)|malformed/i);
    expect(parse(read(p.stateFile)).gates.intent.approvals).toEqual({ odd: 'shape' });
  }, 120000);

  it('preserves cross-subtree anchors or refuses before any rewrite', () => {
    const dir = tempDir('sdlc-opaque-anchor-');
    const subtree = '  intent: &opaque { approvals: "broken" } # keep anchor\n  spec: *opaque\n';
    const file = seed(dir, subtree);
    const before = read(file);
    const state = readChangeState(dir);
    state.tests_locked = true;
    try {
      writeChangeState(dir, state);
      expect(read(file)).toContain(subtree);
      expect(() => parse(read(file))).not.toThrow();
    } catch {
      expect(read(file)).toBe(before);
    }
  });
});
