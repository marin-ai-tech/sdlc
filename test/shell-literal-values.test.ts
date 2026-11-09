import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * B248, following a literal assignment within one command. The oracle is the plain form: a command with its path in a
 * variable must get the decision and the rule of the same command with the path written out, in the same test. The
 * POSIX forms are also run in a real bash, which shows whether the form truly reaches the file.
 */

const STATE = 'openspec/roles.yaml';
const GUARD = 'opencode.json';
const PROTECTED = 'src/gen/x.ts';
const TEST_FILE = 'src/a.test.ts';
const SOURCE = 'src/a.ts';
const FILES = [STATE, GUARD, PROTECTED, TEST_FILE, SOURCE, 'a', 'openspec/sdlc.yaml', 'openspec/backlog.md'];

interface Situation {
  planRequired?: boolean;
  testsLocked?: boolean;
}

function newStand(situation: Situation): string {
  const root = tempDir('sdlc-b248-values-');
  for (const file of FILES) write(path.join(root, file), 'original\n');
  if (situation.testsLocked) {
    const dir = path.join(root, 'openspec/changes/fix');
    write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
    writeChangeState(dir, { ...newChangeState(), kind: 'bugfix', tests_locked: true });
  }
  return root;
}

const stands = new Map<string, string>();

function standFor(situation: Situation): string {
  const key = JSON.stringify(situation);
  const known = stands.get(key);
  if (known) return known;
  const root = newStand(situation);
  stands.set(key, root);
  return root;
}

function decide(command: string, situation: Situation = {}) {
  const root = standFor(situation);
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = situation.planRequired === true;
  config.enforcement.protectedPaths = ['src/gen/**'];
  const call = normalizeToolCall('Bash', { command }, root);
  const result = evaluateToolCall(call, { paths: projectPaths(root), config });
  return { decision: result.decision, rule: result.decision === 'allow' ? undefined : result.rule };
}

function reasonOf(command: string, situation: Situation = {}): string {
  const root = standFor(situation);
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  const call = normalizeToolCall('Bash', { command }, root);
  return evaluateToolCall(call, { paths: projectPaths(root), config }).reason ?? '';
}

/** The disguised form gets what the plain form gets, and the plain form is refused with the expected rule. */
function expectSameAsPlain(disguised: string, plain: string, rule: string, situation: Situation = {}) {
  const expected = decide(plain, situation);
  expect(expected, `plain form: ${plain}`).toEqual({ decision: 'deny', rule });
  expect(decide(disguised, situation), disguised).toEqual(expected);
}

function expectAllowed(command: string, situation: Situation = {}) {
  expect(decide(command, situation), command).toEqual({ decision: 'allow', rule: undefined });
}

const WRITERS: Array<[string, (target: string) => string]> = [
  ['a redirect', (target) => `echo x > ${target}`],
  ['an append', (target) => `echo x >> ${target}`],
  ['tee', (target) => `echo x | tee ${target}`],
  ['an in-place edit', (target) => `sed -i s/a/b/ ${target}`],
  ['a move', (target) => `mv a ${target}`],
];
const DELETE: [string, (target: string) => string] = ['a delete', (target) => `rm ${target}`];

describe('B248.V1: redirect and writers through a variable', () => {
  it.each([...WRITERS, DELETE])('%s of a state file', (_name, form) => {
    expectSameAsPlain(`T=${STATE}; ${form('"$T"')}`, form(STATE), 'state-integrity');
  });

  it('a chain with && reads the same', () => {
    expectSameAsPlain(`T=${STATE} && rm "$T"`, `rm ${STATE}`, 'state-integrity');
  });

  it('a newline between the assignment and the write reads the same', () => {
    expectSameAsPlain(`T=${STATE}\nrm "$T"`, `rm ${STATE}`, 'state-integrity');
  });
});

describe('B248.V2: every check reads the followed value', () => {
  it.each([...WRITERS, DELETE])('%s of a guard file', (_name, form) => {
    expectSameAsPlain(`T=${GUARD}; ${form('"$T"')}`, form(GUARD), 'guard-config');
  });

  it.each(WRITERS)('%s of a protected path', (_name, form) => {
    expectSameAsPlain(`T=${PROTECTED}; ${form('"$T"')}`, form(PROTECTED), 'protected-path');
  });

  it.each(WRITERS)('%s of a test file while tests are locked', (_name, form) => {
    const situation = { testsLocked: true };
    expectSameAsPlain(`T=${TEST_FILE}; ${form('"$T"')}`, form(TEST_FILE), 'tests-locked', situation);
  });

  it.each(WRITERS)('%s of a source file with no approved plan', (_name, form) => {
    const situation = { planRequired: true };
    expectSameAsPlain(`T=${SOURCE}; ${form('"$T"')}`, form(SOURCE), 'plan-gate', situation);
  });
});

describe('B248.V3: spellings of a use', () => {
  it.each(['$T', '"$T"', '${T}', '"${T}"'])('the whole word: %s', (use) => {
    expectSameAsPlain(`T=${STATE}; echo x > ${use}`, `echo x > ${STATE}`, 'state-integrity');
  });

  it.each(['$D/roles.yaml', '"$D/roles.yaml"', '${D}/roles.yaml', '"${D}"/roles.yaml'])('a prefix: %s', (use) => {
    expectSameAsPlain(`D=openspec; echo x > ${use}`, `echo x > ${STATE}`, 'state-integrity');
  });

  it.each(['"$A/$B"', '$A/$B', '"${A}/${B}"', '"$A"/"$B"'])('two variables: %s', (use) => {
    expectSameAsPlain(`A=openspec; B=roles.yaml; rm ${use}`, `rm ${STATE}`, 'state-integrity');
  });

  it.each(['"$T.yaml"', '${T}.yaml', '"${T}.yaml"'])('a suffix: %s', (use) => {
    expectSameAsPlain(`T=openspec/roles; echo x > ${use}`, `echo x > ${STATE}`, 'state-integrity');
  });

  it('a default value with no assignment', () => {
    expectSameAsPlain(`rm "\${X:-${STATE}}"`, `rm ${STATE}`, 'state-integrity');
  });

  it('negative: an assigned value wins over a default', () => {
    expectAllowed(`X=../other; echo x > "\${X:-${STATE}}"`);
  });

  it('negative: a single-quoted use is text', () => {
    expectAllowed(`T=${STATE}; echo x > '$T'`);
  });

  it('negative: an escaped dollar is text', () => {
    expectAllowed(`T=${STATE}; echo x > \\$T`);
  });

  it('negative: a longer name is another variable', () => {
    expectAllowed(`T=${STATE}; echo x > "$Tx"`);
  });

  it('negative: a value that only starts like the file is another file', () => {
    expectAllowed(`T=${STATE}; echo x > "\${T}.bak"`);
  });

  it('negative: POSIX names differ by case', () => {
    expectAllowed(`t=${STATE}; echo x > "$T"`);
  });
});

describe('B248.V4: spellings of an assignment', () => {
  it.each(['export', 'declare', 'typeset', 'local', 'readonly'])('the keyword %s', (keyword) => {
    expectSameAsPlain(`${keyword} T=${STATE}; rm "$T"`, `rm ${STATE}`, 'state-integrity');
  });

  it('an append with +=', () => {
    expectSameAsPlain('T=openspec/; T+=roles.yaml; rm "$T"', `rm ${STATE}`, 'state-integrity');
  });

  it('a chain through another variable', () => {
    expectSameAsPlain(`T=${STATE}; U=$T; rm "$U"`, `rm ${STATE}`, 'state-integrity');
  });

  it('a chain with a suffix', () => {
    expectSameAsPlain('D=openspec; T=$D/roles.yaml; rm "$T"', `rm ${STATE}`, 'state-integrity');
  });

  it('a quoted value', () => {
    expectSameAsPlain(`T="${STATE}"; rm "$T"`, `rm ${STATE}`, 'state-integrity');
    expectSameAsPlain(`T='${STATE}'; rm "$T"`, `rm ${STATE}`, 'state-integrity');
  });

  it('a for list', () => {
    expectSameAsPlain(`for f in a ${STATE}; do rm "$f"; done`, `rm ${STATE}`, 'state-integrity');
  });

  it.each([
    [`$T = '${STATE}'; Remove-Item $T`],
    [`$T='${STATE}'; Remove-Item $T`],
    [`$T = "${STATE}"; Set-Content $T x`],
    [`$env:T = '${STATE}'; Remove-Item $env:T`],
    [`Set-Variable T ${STATE}; Remove-Item $T`],
    [`$t = '${STATE}'; Remove-Item $T`],
  ])('PowerShell: %s', (command) => {
    expect(decide(command).rule, command).toBe('state-integrity');
  });

  it.each([
    [`set T=${STATE}& del %T%`],
    [`set "T=${STATE}"& del "%T%"`],
    [`set T=${STATE}& del !T!`],
  ])('cmd: %s', (command) => {
    expect(decide(command).rule, command).toBe('state-integrity');
  });

  it.each([
    [`bash -c 'T=${STATE}; rm "$T"'`, 'state-integrity'],
    [`sh -c 'T=${GUARD}; echo x > "$T"'`, 'guard-config'],
    [`powershell -Command '$T = "${STATE}"; Remove-Item $T'`, 'state-integrity'],
  ])('inside a shell body: %s', (command, rule) => {
    expect(decide(command).rule, command).toBe(rule);
  });
});

describe('B248.V5: a variable holding the program', () => {
  it('T=rm', () => {
    expectSameAsPlain(`T=rm; $T ${STATE}`, `rm ${STATE}`, 'state-integrity');
  });

  it('negative: a variable holding a reader', () => {
    expectAllowed(`T=cat; $T ${STATE}`);
  });
});

describe('B248.V6: a value reassigned away', () => {
  it.each([
    [`T=${STATE}; T=/tmp/x; echo x > "$T"`],
    [`T=${STATE}\nT=../out.txt\necho x > "$T"`],
    [`T=${STATE}; T=../out.txt; rm "$T"`],
  ])('%s', (command) => {
    expectAllowed(command);
  });
});

describe('B248.V7: an assignment that may not run', () => {
  it.each([
    [`T=${STATE}; true || T=../out.txt; rm "$T"`],
    [`T=${STATE}; false && T=../out.txt; rm "$T"`],
    [`T=${STATE}; if false; then T=../out.txt; fi; rm "$T"`],
    [`T=${STATE}; case x in y) T=../out.txt;; esac; rm "$T"`],
    [`T=${STATE}; while false; do T=../out.txt; done; rm "$T"`],
    [`T=${STATE}; until true; do T=../out.txt; done; rm "$T"`],
    [`T=${STATE}; for i in; do T=../out.txt; done; rm "$T"`],
    [`T=../out.txt; if true; then T=${STATE}; fi; rm "$T"`],
    [`T=../out.txt; true && T=${STATE}; rm "$T"`],
    [`T=${STATE}; (T=../out.txt); rm "$T"`],
    [`T=${STATE}; T=../out.txt true; rm "$T"`],
    [`T=${STATE}; echo x | T=../out.txt; rm "$T"`],
    [`T=${STATE}; unset T; rm "$T"`],
    [`T=${STATE}; T=../out.txt | cat; rm "$T"`],
    [`T=${STATE}; T=../out.txt & rm "$T"`],
    [`T=${STATE}; f() { T=../out.txt; }; rm "$T"`],
  ])('%s', (command) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('B248.V8: too many possible values', () => {
  const unsure = (names: string[]) => names.map((name) => `${name}=a; true || ${name}=b`).join('; ');

  it('past the limit the command is refused, never allowed unchecked', () => {
    const names = ['A', 'B', 'C', 'D', 'E'];
    const command = `${unsure(names)}; echo x > "../$A$B$C$D$E"`;
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it('the reason tells how to do the work: split the loop or put it in a script', () => {
    const names = Array.from({ length: 17 }, (_, index) => `f${index}`).join(' ');
    const command = `for f in ${names}; do cat "$f"; done`;
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'shell-parse' });
    expect(reasonOf(command)).toMatch(/split/i);
    expect(reasonOf(command)).toMatch(/script/i);
  });

  it('negative: at the limit the command is read', () => {
    const names = ['A', 'B', 'C', 'D'];
    expectAllowed(`${unsure(names)}; echo x > "../$A$B$C$D"`);
  });

  it('negative: variables that are never used do not count', () => {
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    expectAllowed(`${unsure(names)}; echo done`);
  });

  it('the second of two values is checked', () => {
    const command = 'A=other; true || A=openspec; rm "$A/roles.yaml"';
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('B248.V9: reading through a variable', () => {
  it.each([
    [`T=${STATE}; cat "$T"`],
    [`T=${STATE}; grep a "$T"`],
    [`T=${STATE}; head "$T"`],
    [`T=${STATE}; echo "$T"`],
    [`T=${STATE}; cat "$T" 2>/dev/null`],
    [`T=${STATE}; sed -n 1p "$T"`],
    [`T=${GUARD}; cat "$T"`],
    ['T=openspec/sdlc.yaml; head "$T" 2>&1 | tail -1'],
    ['$text="openspec/backlog.md";Write-Output $text'],
    [`$T = '${STATE}'; Get-Content $T`],
  ])('%s', (command) => {
    expectAllowed(command);
  });

  it('a read with no approved plan', () => {
    expectAllowed(`T=${SOURCE}; cat "$T"`, { planRequired: true });
  });
});

describe('B248.U1 to U3: a target with no known value stays as it is', () => {
  it('U1: an unknown variable', () => {
    expectAllowed('echo x > "$TMPDIR/y"');
  });

  it.each(['T=$(mktemp)', 'T=`mktemp`', 'T=$(mktemp); echo x > "$T"'])('U2: a substitution: %s', (command) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it('U2 negative: plain mktemp', () => {
    expectAllowed('mktemp');
  });

  it.each(['cp a "$T"', 'T=/tmp/x; cp a "$T"'])('U3: a variable copy keeps its refusal: %s', (command) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('Verification of B248: bash 5.3 brace substitutions and nested loops', () => {
  it.each([
    [`echo \${ rm ${STATE}; }`],
    [`echo \${| rm ${STATE}; }`],
    [`echo \${\trm ${STATE}; }`],
    [`x=\${ echo x > ${GUARD}; }`],
    ['echo ${ date; }'],
  ])('a brace substitution runs a command and stays refused: %s', (command) => {
    expect(decide(command).decision, command).toBe('deny');
  });

  it('a brace substitution with no write is refused as a substitution', () => {
    expect(decide('echo ${ date; }')).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    [`for i in 1; do for f in ${STATE}; do rm "$f"; done; done`],
    [`if true; then for f in ${STATE}; do rm "$f"; done; fi`],
    [`while false; do :; done; for f in ${STATE}; do rm "$f"; done`],
  ])('a nested for list is followed: %s', (command) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('No refusal is lost and no reading is invented (acceptance of card B248-1)', () => {
  it.each([
    [`echo \${X:-$(rm ${STATE})}`],
    [`echo \${X:-\`rm ${STATE}\`}`],
    [`rm \${X:-$(echo ${STATE})}`],
    ['echo ${X:-$(date)}'],
  ])('a substitution inside unquoted braces stays refused: %s', (command) => {
    expect(decide(command).decision, command).toBe('deny');
  });

  it('a substitution with no write inside braces is refused as a substitution', () => {
    expect(decide('echo ${X:-$(date)}')).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    ['sed -i "s/--text \\"<answer>\\"/--text \'<answer>\'/" docs/a.md'],
    ['ssh host "cd ~/x && python3 - <<\'EOF\'\nimport json\nprint(\\"a\\")\nEOF"'],
    ['echo "a\\"b" > /tmp/x'],
  ])('the plan gate reads no target the command does not write: %s', (command) => {
    expectAllowed(command, { planRequired: true });
  });
});

describe('Values cannot make a command up', () => {
  it.each([
    [`T='x; rm ${STATE}'; echo "$T"`],
    [`T='> ${STATE}'; echo "$T"`],
    [`T="a b"; echo "$T"`],
    [`T="it's"; echo "$T"`],
    [`T='$HOME'; echo x > "$T"`],
    [`T='a | tee ${STATE}'; echo "$T"`],
  ])('%s', (command) => {
    expectAllowed(command);
  });

  it('a long command with many assignments stays quick; past the work budget it is refused (owner, round 3)', () => {
    const assignments = Array.from({ length: 2000 }, (_, index) => `V${index}=a`).join('; ');
    const started = Date.now();
    expect(decide(`${assignments}; echo x > "../$V7"`)).toEqual({ decision: 'deny', rule: 'shell-parse' });
    expect(Date.now() - started).toBeLessThan(10000);
  });
});

/** Runs a command in a real bash in a fresh project and says whether it changed or removed the state file. */
function reachesStateFile(command: string): boolean {
  const base = tempDir('sdlc-b248-bash-');
  const cwd = path.join(base, 'project');
  const file = path.join(cwd, STATE);
  write(file, 'original\n');
  write(path.join(cwd, 'a'), 'source\n');
  const run = spawnSync('bash', ['-c', command], { cwd, timeout: 15000, encoding: 'utf8' });
  expect(run.error, `bash could not run: ${command}`).toBeUndefined();
  return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== 'original\n';
}

describe('A real bash agrees with the decision', () => {
  it.each([
    [`T=${STATE}; echo x > "$T"`, true],
    [`T=${STATE}; echo x | tee "$T" > /dev/null`, true],
    [`T=${STATE}; sed -i s/o/0/ "$T"`, true],
    [`T=${STATE}; rm "$T"`, true],
    [`T=${STATE}; mv a "$T"`, true],
    [`export T=${STATE}; rm "$T"`, true],
    [`D=openspec; echo x > "\${D}/roles.yaml"`, true],
    [`D=openspec; echo x > \${D}/roles.yaml`, true],
    ['A=openspec; B=roles.yaml; rm "$A/$B"', true],
    ['T=openspec/; T+=roles.yaml; rm "$T"', true],
    [`U=${STATE}; T=$U; rm "$T"`, true],
    [`for f in ${STATE}; do rm "$f"; done`, true],
    [`rm "\${X:-${STATE}}"`, true],
    [`T=rm; $T ${STATE}`, true],
    [`T=${STATE}; true || T=../out.txt; rm "$T"`, true],
    [`T=${STATE}; if false; then T=../out.txt; fi; rm "$T"`, true],
    [`T=${STATE}; (T=../out.txt); rm "$T"`, true],
    [`T=${STATE}; T=../out.txt true; rm "$T"`, true],
    [`T=${STATE}; echo x | T=../out.txt; rm "$T"`, true],
    [`T=${STATE}; T=../out.txt | cat; rm "$T"`, true],
    [`T=${STATE}; T=../out.txt & rm "$T"`, true],
    [`T=${STATE}; f() { T=../out.txt; }; rm "$T"`, true],
    [`echo \${X:-$(rm ${STATE})}`, true],
    [`T=${STATE}; T=../out.txt; echo x > "$T"`, false],
    [`T=${STATE}; echo x > '$T'`, false],
    [`T=${STATE}; echo x > \\$T`, false],
    [`T=${STATE}; echo x > "$Tx" 2> /dev/null`, false],
    [`t=${STATE}; echo x > "$T" 2> /dev/null`, false],
    [`T=${STATE}; cat "$T" > /dev/null`, false],
    [`T='x; rm ${STATE}'; echo "$T" > /dev/null`, false],
    [`T='> ${STATE}'; echo "$T" > /dev/null`, false],
  ])('%s reaches the file: %s', (command, reaches) => {
    expect(reachesStateFile(command), 'bash').toBe(reaches);
    expect(decide(command).decision, 'policy').toBe(reaches ? 'deny' : 'allow');
  });
});

describe('Review round 1 of B248: values, scope and splitting', () => {
  const doubled = (times: number, step = 'X=$X$X') => Array.from({ length: times }, () => `${step};`).join(' ');

  it('F1: a self-doubling assignment does not crash the policy and the write stays refused', () => {
    const command = `X=a; ${doubled(30)} rm ${STATE}`;
    expect(() => decide(command)).not.toThrow();
    expect(decide(command).decision).toBe('deny');
  });

  it('F1: the write before an exit stays refused when the doubling comes after it', () => {
    const command = `echo pwned > ${STATE}; exit 0; X=${'a'.repeat(1000)}; ${doubled(22, 'X+=$X')}`;
    expect(() => decide(command)).not.toThrow();
    expect(decide(command).decision).toBe('deny');
  });

  it('F1: PowerShell doubling does not crash the policy', () => {
    const steps = Array.from({ length: 30 }, () => 'Set-Variable X $X$X;').join(' ');
    const command = `$X = 'a'; ${steps} Remove-Item ${STATE}`;
    expect(() => decide(command)).not.toThrow();
    expect(decide(command).decision).toBe('deny');
  });

  it('F4: a spelling longer than the lexer limit is refused, never allowed unchecked', () => {
    const command = `X=a; ${doubled(18)} : $X; P=src/gen/x.ts; rm $P`;
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it('F2: a long command with a sixteen-value loop is decided well within the hook timeout', () => {
    const loop = 'for f in a b c d e f g h i j k l m n o p; do echo $f; done;';
    const padding = Array.from({ length: 100 }, () => 'cat a > /tmp/x;').join(' ');
    const started = Date.now();
    // Round 3 (owner): past the work budget the command is refused at once with shell-parse instead of being checked.
    expect(decide(`${loop} ${padding} echo x > src/gen/x.ts`)).toEqual({ decision: 'deny', rule: 'shell-parse' });
    expect(Date.now() - started).toBeLessThan(15000);
  }, 60000);

  it.each([
    [`T=${STATE}; if false; then if true; then :; fi; T=/tmp/x; fi; rm "$T"`],
    [`T=${STATE}; while false; do for i in a; do :; done; T=/tmp/x; done; rm "$T"`],
    [`T=${STATE}; if false; then :; else if true; then :; fi; T=/tmp/x; fi; rm "$T"`],
    [`T=${STATE}; if false; then case x in y) :;; esac; T=/tmp/x; fi; rm "$T"`],
  ])('F6: a nested block does not close the outer one: %s', (command) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    ['T="rm -f"; $T src/gen/x.ts', 'rm -f src/gen/x.ts'],
    ['T="sed -i"; $T s/a/b/ src/gen/x.ts', 'sed -i s/a/b/ src/gen/x.ts'],
    [`T="a ${STATE}"; rm $T`, `rm a ${STATE}`],
    [`T="-f ${STATE}"; rm $T`, `rm -f ${STATE}`],
  ])('F7: an unquoted use is split into words: %s', (disguised, plain) => {
    expect(decide(disguised), disguised).toEqual(decide(plain));
    expect(decide(disguised).decision).toBe('deny');
  });

  it('F7 negative: a quoted use stays one word', () => {
    expectAllowed('T="a b"; echo x > "../$T"');
  });

  it.each([[`T=${STATE}; set T=/tmp/x; rm "$T"`], [`T=${STATE}; local T=/tmp/x; rm "$T"`]])(
    'F8: POSIX set and a top-level local keep the earlier value: %s', (command) => {
      expect(decide(command), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
    },
  );

  it.each([['OUT=""; rm -f "$OUT"'], ['X=; mv a "$X"'], ['X=""; sed -i s/a/b/ "$X"']])(
    'F11, reverted in round 3 by the owner: an empty value keeps the empty-path refusal of B271: %s', (command) => {
      expect(decide(command), command).toEqual({ decision: 'deny', rule: 'guard-config' });
    },
  );

  it('F12: a quoted brace inside ${...} does not end the word', () => {
    expectAllowed('echo ${X:-"}"}x');
  });
});

describe('Review round 2 of B248: work budget, empty values, cd and word limit', () => {
  const loop = 'for X in a b c d e f g h i j k l m n o p; do :; done;';

  it('F19: forty commands that each use a sixteen-value variable are decided quickly and refused', () => {
    const uses = Array.from({ length: 40 }, (_, index) => `rm $X f${index};`).join(' ');
    const started = Date.now();
    expect(decide(`${loop} ${uses} echo x > src/gen/x.ts`).decision).toBe('deny');
    expect(Date.now() - started).toBeLessThan(10000);
  }, 60000);

  it('F19: one value used in six hundred commands is decided quickly', () => {
    const uses = Array.from({ length: 600 }, (_, index) => `rm $X f${index};`).join(' ');
    const started = Date.now();
    expect(decide(`X=a; ${uses} echo x > src/gen/x.ts`).decision).toBe('deny');
    expect(Date.now() - started).toBeLessThan(15000);
  }, 60000);

  it.each([
    [`E=; T=${STATE}; rm -f $E "$T"`, 'state-integrity'],
    [`E=""; T=${STATE}; echo x "$E" > "$T"`, 'state-integrity'],
    ['E=; T=src/gen/x.ts; echo x $E > "$T"', 'protected-path'],
  ])('F20: an empty value does not stop another variable from being followed: %s', (command, rule) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule });
  });

  it.each([
    ['D=openspec; cd $D; rm roles.yaml', 'state-integrity'],
    ['D=openspec; T=roles.yaml; cd $D; rm "$T"', 'state-integrity'],
    ['D=src/gen; cd $D; echo x > x.ts', 'protected-path'],
    ['D=src; cd $D; rm -f gen/x.ts', 'protected-path'],
  ])('F21: a literal variable in cd is followed: %s', (command, rule) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule });
  });

  it('F23: field splitting past the word limit is refused, never allowed unchecked', () => {
    const words = Array.from({ length: 4100 }, () => 'x').join(' ');
    const command = `T="${words} ${STATE}"; rm -f $T`;
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'shell-parse' });
  }, 60000);
});

describe('Review round 3 of B248: the work of one wide command, and shells named with .exe', () => {
  const loop = 'for f in v0 v1 v2 v3 v4 v5 v6 v7 v8 v9 v10 v11 v12 v13 v14 v15; do :; done;';
  const repeat = (text: string, count: number) => Array.from({ length: count }, () => text).join(' ');

  /** The hook fails open past 30 s, so a write must be refused well within it. */
  function expectQuickRefusal(command: string, limit = 5000) {
    const started = Date.now();
    expect(decide(command).decision, command.slice(0, 120)).toBe('deny');
    expect(Date.now() - started).toBeLessThan(limit);
  }

  it('F27: a sixteen-value variable used 400 times in one command is refused quickly', () => {
    expectQuickRefusal(`${loop} echo ${repeat('$f', 400)} > src/gen/x.ts`);
  }, 120000);

  it('F27: a sixteen-value variable before 450 redirects in one command is refused quickly', () => {
    expectQuickRefusal(`${loop} echo $f ${repeat('> /tmp/q', 450)}; echo x > src/gen/x.ts`);
  }, 120000);

  it('F27: one value used 3,000 times in one command is refused quickly', () => {
    expectQuickRefusal(`X=a; echo ${repeat('$X', 3000)} > src/gen/x.ts`);
  }, 120000);

  it('F27: a wide command with no write and no variable is still allowed', () => {
    expectAllowed(`echo ${repeat('a', 400)}`);
  });

  it.each([
    ['bash.exe -c "echo hi > src/gen/x.ts"', 'echo hi > src/gen/x.ts', 'protected-path', {}],
    ['sh.exe -c "rm src/gen/x.ts"', 'rm src/gen/x.ts', 'protected-path', {}],
    ['zsh.exe -c "rm src/gen/x.ts"', 'rm src/gen/x.ts', 'protected-path', {}],
    ['C:/Program-Files/Git/usr/bin/bash.exe -c "echo hi > src/gen/x.ts"', 'echo hi > src/gen/x.ts',
      'protected-path', {}],
    ['C:/x/bash.exe -c "cp a src/a.test.ts"', 'cp a src/a.test.ts', 'tests-locked', { testsLocked: true }],
    [`BASH.EXE -c "rm ${STATE}"`, `rm ${STATE}`, 'state-integrity', {}],
  ] as Array<[string, string, string, Situation]>)('F33: a shell named %s is followed into its body',
    (command, plain, rule, situation) => {
      expectSameAsPlain(command, plain, rule, situation);
    });

  it('F33: a read in a bash.exe body stays allowed', () => {
    expectAllowed(`bash.exe -c "cat ${STATE}"`);
  });

  it('F32: twelve thousand braced uses before a bash.exe body that writes are refused', () => {
    expectQuickRefusal(`X=a; echo ${'${X}'.repeat(12000)}; bash.exe -c 'rm src/gen/x.ts'`, 15000);
  }, 120000);
});

describe('Review round 4 of B248: the budget bounds what the checks read, not the written text', () => {
  const loop = 'for f in v0 v1 v2 v3 v4 v5 v6 v7 v8 v9 v10 v11 v12 v13 v14 v15; do :; done;';
  const repeat = (text: string, count: number) => Array.from({ length: count }, () => text).join(' ');
  const words = `A="${repeat('w', 10)}"; B="${repeat('$A', 10)}";`;
  const splitValues = Array.from({ length: 16 }, (_, index) => `"${repeat('$B', 4)} ${index}"`).join(' ');

  /** The hook fails open past 30 s, so a write must be decided well within it. */
  function expectQuickRefusal(command: string, limit = 5000) {
    const started = Date.now();
    expect(decide(command).decision, command.slice(0, 120)).toBe('deny');
    expect(Date.now() - started).toBeLessThan(limit);
  }

  it('F36: sixteen values that split into 400 words each are decided quickly', () => {
    expectQuickRefusal(`${words} for f in ${splitValues}; do :; done; echo $f > src/gen/x.ts`);
  }, 120000);

  it('F36: the same split values before a write to the hook settings are decided quickly', () => {
    expectQuickRefusal(`${words} for f in ${splitValues}; do :; done; echo $f > .claude/settings.json`);
  }, 120000);

  it('F36: one value that splits into 4,000 words is decided quickly', () => {
    expectQuickRefusal(`${words} C="${repeat('$B', 40)}"; echo $C > src/gen/x.ts`);
  }, 120000);

  it.each(['bash -c', 'cmd /c', 'pwsh -c'])('F36: a wide %s body after a sixteen-value loop is decided quickly',
    (verb) => {
      expectQuickRefusal(`${loop} echo $f; ${verb} "echo ${repeat('a', 400)} > src/gen/x.ts"`);
    }, 120000);

  it('F36: a 120,000-character word after a sixteen-value loop is decided quickly', () => {
    expectQuickRefusal(`${loop} echo $f ${'a'.repeat(120000)} > src/gen/x.ts`, 8000);
  }, 120000);

  it('F36: sixteen values of 7,000 characters each are decided quickly', () => {
    const values = Array.from({ length: 16 }, (_, index) => `v${index}${'a'.repeat(7000)}`).join(' ');
    expectQuickRefusal(`for f in ${values}; do :; done; echo $f > src/gen/x.ts`, 8000);
  }, 120000);

  it('F36: ten thousand uses of a sixteen-value variable in one word are decided quickly', () => {
    const uses = '$f'.repeat(10000);
    const values = 'a0 a1 a2 a3 a4 a5 a6 a7 a8 a9 b0 b1 b2 b3 b4 b5';
    expectQuickRefusal(`for f in ${values}; do :; done; echo "${uses}" > src/gen/x.ts`, 8000);
  }, 120000);

  it('F36: an ordinary loop over a few files through a variable is still read and allowed', () => {
    expectAllowed('for f in a.txt b.txt c.txt; do wc -l $f; done');
    expectAllowed(`${words} echo $B`);
  });
});
