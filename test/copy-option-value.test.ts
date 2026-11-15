import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * OpenSpec change a-copy-option-with-a-value-meets-the-guards (B323; found 2026-11-15 while probing B318). GNU cp, mv,
 * install and ln read `-tDIR` as `-t DIR`, take the value of an option from the next word or the rest of its word,
 * and move options after the operands to the front. The hook must read the destination the same way. The oracle of
 * each form is its spelled-out form, decided in the same test.
 */

interface Situation {
  planRequired?: boolean;
  testsLocked?: boolean;
}

const FILES = ['a', 'b.test.ts', 'src/app.js', 'src/a.test.ts', 'openspec/roles.yaml', 'openspec/sdlc.yaml',
  'src/gen/x.ts'];

function newStand(situation: Situation): string {
  const root = tempDir('sdlc-b323-');
  for (const file of FILES) write(path.join(root, file), 'original\n');
  const demo = path.join(root, 'openspec/changes/demo');
  write(path.join(demo, '.openspec.yaml'), 'schema: sdlc\n');
  writeChangeState(demo, { ...newChangeState(), ...(situation.testsLocked ? { kind: 'bugfix', tests_locked: true } : {}) });
  return root;
}

const stands = new Map<string, string>();
function standFor(situation: Situation): string {
  const key = JSON.stringify(situation);
  if (!stands.has(key)) stands.set(key, newStand(situation));
  return stands.get(key)!;
}

function decide(command: string, situation: Situation = {}) {
  const root = standFor(situation);
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = situation.planRequired === true;
  config.enforcement.protectedPaths = ['src/gen/**'];
  const result = evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
  return { decision: result.decision, rule: result.decision === 'allow' ? undefined : result.rule };
}

/** A folder outside every stand. */
const OUTSIDE = tempDir('sdlc-b323-outside-').replace(/\\/g, '/');
const D = '.claude';

describe('B323.C1 a glued target directory', () => {
  it.each([
    [`cp a -t${D}`, `cp a -t ${D}`],
    [`cp -t${D} a`, `cp -t ${D} a`],
    [`mv a -t${D}`, `mv a -t ${D}`],
    [`install a -t${D}`, `install a -t ${D}`],
    [`install -Dt${D} a`, `install -D -t ${D} a`],
    [`ln -t${D} a`, `ln -t ${D} a`],
    [`cp -rt${D} a`, `cp -r -t ${D} a`],
  ])('%s is decided as %s', (glued, spaced) => {
    expect(decide(spaced), spaced).toEqual({ decision: 'deny', rule: 'guard-config' });
    expect(decide(glued), glued).toEqual({ decision: 'deny', rule: 'guard-config' });
  });
});

describe('B323.C2 a value option after the operands', () => {
  it.each([
    [`install a ${D}/settings.json -m 644`, `install -m 644 a ${D}/settings.json`],
    [`cp a ${D}/settings.json -S bak`, `cp -S bak a ${D}/settings.json`],
    [`ln -s a ${D}/settings.json -S x`, `ln -s -S x a ${D}/settings.json`],
    ['mv a openspec/changes/demo/.sdlc.yaml --suffix=x', 'mv --suffix=x a openspec/changes/demo/.sdlc.yaml'],
    ['install a openspec/roles.yaml -o root', 'install -o root a openspec/roles.yaml'],
  ])('%s is decided as %s', (moved, spelled) => {
    const oracle = decide(spelled);
    expect(oracle.decision, spelled).toBe('deny');
    expect(decide(moved), moved).toEqual(oracle);
  });
});

describe('B323.C3 an abbreviated long option', () => {
  it.each([
    [`cp a --target=${D}`, `cp a --target-directory=${D}`],
    [`cp a --targ ${D}`, `cp a --target-directory ${D}`],
    ['install a --target-dir=src/gen', 'install a --target-directory=src/gen'],
    [`install a ${D}/settings.json --mo 644`, `install --mode 644 a ${D}/settings.json`],
  ])('%s is decided as %s', (short, full) => {
    const oracle = decide(full);
    expect(oracle.decision, full).toBe('deny');
    expect(decide(short), short).toEqual(oracle);
  });
});

describe('B323.C4 the same guards for state, protected paths, locked tests and the plan gate', () => {
  it.each([
    ['cp a -topenspec/changes/demo', 'cp a -t openspec/changes/demo', 'state-integrity', {}],
    ['cp a -tsrc/gen', 'cp a -t src/gen', 'protected-path', {}],
    ['install a src/a.test.ts -m 644', 'install -m 644 a src/a.test.ts', 'tests-locked', { testsLocked: true }],
    ['cp a src/a.test.ts -S bak', 'cp -S bak a src/a.test.ts', 'tests-locked', { testsLocked: true }],
    ['cp a -tsrc', 'cp a -t src', 'plan-gate', { planRequired: true }],
    ['install a src/app.js -m 644', 'install -m 644 a src/app.js', 'plan-gate', { planRequired: true }],
  ] as Array<[string, string, string, Situation]>)('%s is decided as %s', (glued, spaced, rule, s) => {
    expect(decide(spaced, s), spaced).toEqual({ decision: 'deny', rule });
    expect(decide(glued, s), glued).toEqual({ decision: 'deny', rule });
  });
});

describe('B323.C6 forms that write more than the last operand (independent review)', () => {
  it.each([
    [`install -d ${D}/settings.json`, `cp a ${D}/settings.json`],
    ['install -d src/gen/y', 'cp a src/gen/y'],
    [`install -d ${OUTSIDE}/q ${D}/settings.json`, `cp a ${D}/settings.json`],
    ['install --directory openspec/.sdlc/log.jsonl', 'cp a openspec/.sdlc/log.jsonl'],
    [`install -Dd ${D}/settings.json`, `cp a ${D}/settings.json`],
    [`ln -s ${OUTSIDE}/${D}`, `ln -s ${OUTSIDE}/${D} ${D}`],
    [`ln ${OUTSIDE}/${D}/`, `ln ${OUTSIDE}/${D} ${D}`],
  ])('%s is decided as %s', (command, oracleCommand) => {
    const oracle = decide(oracleCommand);
    expect(oracle.decision, oracleCommand).toBe('deny');
    expect(decide(command), command).toEqual(oracle);
  });

  it('negative: one ln operand outside a guarded name, and install -d outside, stay allowed', () => {
    expect(decide(`ln -s ${OUTSIDE}/notes.txt`)).toEqual({ decision: 'allow', rule: undefined });
    expect(decide(`install -d ${OUTSIDE}/a ${OUTSIDE}/b`)).toEqual({ decision: 'allow', rule: undefined });
  });
});

describe('B323 the GNU reading of the arguments', () => {
  it('reads clusters, prefixes, --, - and options after the operands', async () => {
    const { gnuCopyArgs, gnuCopyWrites } = await import('../src/core/gnu-copy-args.js');
    expect(gnuCopyWrites('cp', ['-rt.x', 'a'], false)).toEqual(['.x']);
    expect(gnuCopyWrites('cp', ['-r', '-t', '.x', 'a'], false)).toEqual(['.x']);
    expect(gnuCopyWrites('install', ['a', 'dest', '-m', '644'], false)).toEqual(['dest']);
    expect(gnuCopyWrites('install', ['-m644', 'a', 'dest'], false)).toEqual(['dest']);
    expect(gnuCopyWrites('install', ['--strip', 'a', 'dest'], false)).toEqual(['dest']);
    expect(gnuCopyWrites('cp', ['--targ=.x', 'a'], false)).toEqual(['.x']);
    expect(gnuCopyWrites('cp', ['--', '-t.x', 'dest'], false)).toEqual(['dest']);
    expect(gnuCopyWrites('cp', ['-', 'dest'], false)).toEqual(['dest']);
    expect(gnuCopyWrites('mv', ['a', 'b', 'dest'], true)).toEqual(['a', 'b', 'dest']);
    expect(gnuCopyWrites('mv', ['-tdest', 'a'], true)).toEqual(['dest', 'a']);
    expect(gnuCopyArgs('cp', ['a', 'b'])?.uncertain).toBe(false);
    expect(gnuCopyArgs('rsync', ['a', 'b'])).toBeUndefined();
  });

  it('negative: doubt makes every word a possible destination, never a guess', async () => {
    const { gnuCopyArgs, gnuCopyWrites } = await import('../src/core/gnu-copy-args.js');
    expect(gnuCopyArgs('cp', ['--s', 'a', 'b'])?.uncertain).toBe(true);
    expect(gnuCopyArgs('cp', ['--frobnicate', 'a', 'b'])?.uncertain).toBe(true);
    expect(gnuCopyArgs('cp', ['a', '-t'])?.uncertain).toBe(true);
    expect(gnuCopyWrites('cp', ['-tout', '-t.x', 'a'], false)).toEqual(expect.arrayContaining(['out', '.x', 'a']));
    expect(gnuCopyWrites('cp', ['--s', '.x', 'a', 'out'], false)).toEqual(expect.arrayContaining(['.x', 'a', 'out']));
  });
});

describe('B323.C5 negative: copies out of the project and option values stay as they are', () => {
  it.each([
    `cp -t${OUTSIDE} a`,
    `cp a -t${OUTSIDE}`,
    `install -m 644 a ${OUTSIDE}/x`,
    `install a ${OUTSIDE}/x -m 644`,
    `cp -S .bak a ${OUTSIDE}/x`,
    `cp a ${OUTSIDE}/x --suffix=.bak`,
    `cp -- -t${D} ${OUTSIDE}/x`,
    `install -m 644 -o root -g root a ${OUTSIDE}/x`,
  ])('%s is allowed', (command) => {
    expect(decide(command), command).toEqual({ decision: 'allow', rule: undefined });
  });
});
