import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * OpenSpec change a-copy-to-an-exact-variable-meets-the-guards (B318; field run on OpenCode 2026-11-13: the release
 * rehearsal `BASE=...; cp ... "$BASE/..."` into a scratch folder outside the project was refused). A copy whose every
 * variable has an exact value (one plain assignment of a literal at the top level, before every use, never changed)
 * is judged as the same copy with the value written out. The oracle is that plain form, decided in the same test.
 * Any other form keeps the refusal of 0.32.0.
 */

interface Situation {
  planRequired?: boolean;
  testsLocked?: boolean;
}

const FILES = ['a', 'index.html', 'styles.css', 'src/app.js', 'src/a.test.ts', 'openspec/roles.yaml',
  'openspec/sdlc.yaml', 'src/gen/x.ts'];

function newStand(situation: Situation): string {
  const root = tempDir('sdlc-b318-');
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

/** A scratch folder outside every stand, as the release rehearsal used. */
const OUTSIDE = tempDir('sdlc-b318-outside-').replace(/\\/g, '/');

describe('B318.C1 the field rehearsal', () => {
  it('a copy into a scratch folder outside the project through an exact variable is allowed', () => {
    const base = `${OUTSIDE}/rehearsal`;
    const command = [`BASE="${base}"`, 'rm -rf "$BASE"', 'mkdir -p "$BASE/tablet/school-calc"',
      'cp index.html styles.css "$BASE/tablet/school-calc/"', 'cp -r src "$BASE/tablet/school-calc/"'].join('; ');
    const plain = command.split('$BASE').join(base).replace(`BASE="${base}"; `, '');
    expect(decide(plain), plain).toEqual({ decision: 'allow', rule: undefined });
    expect(decide(command), command).toEqual({ decision: 'allow', rule: undefined });
  });
});

describe('B318.C2 the same shape aimed inside the project', () => {
  it.each([
    ['openspec/changes/demo', 'cp -r src "$BASE/"', 'state-integrity', {}],
    ['.claude', 'cp a "$BASE/settings.json"', 'guard-config', {}],
    ['src/gen', 'cp a "$BASE/x.ts"', 'protected-path', {}],
    ['src', 'cp a "$BASE/a.test.ts"', 'tests-locked', { testsLocked: true }],
    ['src', 'cp a "$BASE/b.js"', 'plan-gate', { planRequired: true }],
  ] as Array<[string, string, string, Situation]>)('BASE=%s: %s is refused as its plain form', (base, copy, rule, s) => {
    const command = `BASE="${base}"; ${copy}`;
    const plain = copy.split('$BASE').join(base);
    expect(decide(plain, s), plain).toEqual({ decision: 'deny', rule });
    expect(decide(command, s), command).toEqual({ decision: 'deny', rule });
  });
});

describe('B318.C3 a state source stays refused', () => {
  it('copying a change folder out through an exact variable', () => {
    const command = `BASE="${OUTSIDE}/x"; cp -r openspec/changes/demo "$BASE"`;
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('B318.C4 values that are not exact keep the refusal', () => {
  const T = `${OUTSIDE}/t`;
  it.each([
    `BASE="${T}" && cp a "$BASE/"`,
    `false || BASE="${T}"; cp a "$BASE/"`,
    `BASE="${T}" | cat; cp a "$BASE/"`,
    `BASE="${T}" & cp a "$BASE/"`,
    `if true; then BASE="${T}"; fi; cp a "$BASE/"`,
    `case x in x) BASE="${T}";; esac; cp a "$BASE/"`,
    `for i in 1; do BASE="${T}"; done; cp a "$BASE/"`,
    `( BASE="${T}" ); cp a "$BASE/"`,
    `{ BASE="${T}"; }; cp a "$BASE/"`,
    `f() { BASE="${T}"; }; f; cp a "$BASE/"`,
    `BASE="${T}" cp a "$BASE/"`,
    `cp a "$BASE/"; BASE="${T}"`,
    `BASE="${T}"; BASE="openspec/changes/demo"; cp a "$BASE/"`,
    `BASE="${T}"; unset BASE; cp a "$BASE/"`,
    'BASE=$(mktemp -d); cp a "$BASE/"',
    'BASE=`mktemp -d`; cp a "$BASE/"',
    `BASE="${T}"; cp a "\${BASE:-openspec/changes/demo}/"`,
    `BASE="${T}"; read BASE; cp a "$BASE/"`,
    `BASE="${T}"; cp a "$BASE/" "$OTHER/"`,
  ])('%s', (command) => {
    const result = decide(command);
    expect(result.decision, command).toBe('deny');
    expect(['state-integrity', 'shell-parse'], command).toContain(result.rule);
  });
});

describe('B318.C5 a link or junction back into the project', () => {
  it('a destination outside the project that resolves into it is refused', () => {
    const root = standFor({});
    const link = `${tempDir('sdlc-b318-link-').replace(/\\/g, '/')}/link`;
    fs.symlinkSync(path.join(root, 'openspec/changes/demo'), link, 'junction');
    expect(decide(`BASE="${link}"; cp a "$BASE/"`).decision).toBe('deny');
  });

  it('a link made earlier in the same command is refused too', () => {
    const root = standFor({}).replace(/\\/g, '/');
    const link = `${tempDir('sdlc-b318-later-').replace(/\\/g, '/')}/link`;
    const command = `BASE="${link}"; ln -s "${root}/openspec/changes/demo" "$BASE"; cp a "$BASE/"`;
    expect(decide(command).decision).toBe('deny');
  });
});

describe('B318.C6 negative: reads and other writers are unchanged', () => {
  it('a read through an exact variable is allowed and a write refused, as in 0.32.0', () => {
    expect(decide('BASE=openspec/roles.yaml; cat "$BASE"')).toEqual({ decision: 'allow', rule: undefined });
    expect(decide('BASE=openspec/roles.yaml; echo x > "$BASE"')).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('B318 review: every check reads the spelling the copy check let through', () => {
  it('commandSpellings holds the exact spelling, so the later checks do not depend on the literal values', async () => {
    const { commandSpellings } = await import('../src/core/policy-spellings.js');
    const { exactValues } = await import('../src/core/shell-exact-values.js');
    for (const command of ['BASE=.claude; cp a "$BASE/settings.json"', 'A=src; B=gen; cp a "$A/$B/x.ts"']) {
      const exact = exactValues(command);
      expect(exact, command).toBeDefined();
      expect(commandSpellings(command).writeSpellings, command).toContain(exact!.spelling);
    }
  });
});

describe('B318.C4 review round 2: an unquoted use is split and globbed by bash', () => {
  // Independent review lead (2026-11-15): with IFS=@ bash splits an unquoted $BASE into two words, so
  // `cp a $BASE` with BASE=<out>@--target-directory=.claude copies into .claude, while the written-out spelling
  // names one path outside the project. Git Bash split it as [cp][a][/tmp/out][--target-directory=.claude].
  // The values are quoted, so the only thing that is not exact is the unquoted use: an unquoted value is not exact
  // by itself when the temporary folder holds a `~`, as `C:/Users/RUNNER~1/...` does on GitHub's Windows runners.
  const T = `${OUTSIDE}/t`;
  it.each([
    `IFS=@; BASE="${T}@--target-directory=.claude"; cp a $BASE`,
    `IFS=@; BASE="${T}@.claude/settings.json"; cp a $BASE`,
    `IFS=/; BASE="${T}/x"; cp a $BASE`,
    `BASE="${T}"; cp a $BASE/x`,
    `BASE="${T}"; cp a "$BASE"/x $BASE`,
  ])('%s', (command) => {
    const result = decide(command);
    expect(result.decision, command).toBe('deny');
    expect(['state-integrity', 'shell-parse'], command).toContain(result.rule);
  });

  it('the same values used inside double quotes stay exact', async () => {
    const { exactValues } = await import('../src/core/shell-exact-values.js');
    expect(exactValues(`IFS=@; BASE="${T}@x"; cp a "$BASE"`)?.values.BASE).toBe(`${T}@x`);
    expect(exactValues(`BASE="${T}"; cp a $BASE/x`)).toBeUndefined();
  });
});

describe('B318.C7 an exact value', () => {
  it('one plain top-level assignment before every use gives the exact value and the spelling', async () => {
    const { exactValues } = await import('../src/core/shell-exact-values.js');
    expect(exactValues(`BASE="${OUTSIDE}/x"; cp a "$BASE/"`)).toEqual({
      values: { BASE: `${OUTSIDE}/x` },
      spelling: `BASE="${OUTSIDE}/x"; cp a "${OUTSIDE}/x/"`,
    });
    expect(exactValues(`BASE="${OUTSIDE}/x" && cp a "$BASE/"`)).toBeUndefined();
  });
});
