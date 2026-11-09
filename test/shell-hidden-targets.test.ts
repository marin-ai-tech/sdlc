import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { newChangeState, writeChangeState } from '../src/core/change-state.js';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { shellWords } from '../src/core/shell-words.js';
import { tempDir, write } from './helpers.js';

/**
 * B248, a form that hides a target does not change the decision. The oracle is the plain form evaluated in the same
 * project: an input redirect, an unresolved directory, a variable prefix or quotes inside a word must leave the
 * decision of the plain write as it is. The plan gate does not apply after an unresolved directory, a named limit.
 */

const STATE = 'openspec/roles.yaml';
const GUARD = 'opencode.json';

interface Situation {
  planRequired?: boolean;
  testsLocked?: boolean;
}

const stands = new Map<string, string>();

function standFor(situation: Situation): string {
  const key = JSON.stringify(situation);
  const known = stands.get(key);
  if (known) return known;
  const root = tempDir('sdlc-b248-hidden-');
  for (const file of [STATE, GUARD, 'src/gen/x.ts', 'src/a.test.ts', 'src/a.ts', 'a']) {
    write(path.join(root, file), 'original\n');
  }
  if (situation.testsLocked) {
    const dir = path.join(root, 'openspec/changes/fix');
    write(path.join(dir, '.openspec.yaml'), 'schema: sdlc\n');
    writeChangeState(dir, { ...newChangeState(), kind: 'bugfix', tests_locked: true });
  }
  stands.set(key, root);
  return root;
}

function decide(command: string, situation: Situation = {}, tool = 'Bash') {
  const root = standFor(situation);
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = situation.planRequired === true;
  config.enforcement.protectedPaths = ['src/gen/**'];
  const call = normalizeToolCall(tool, { command }, root);
  const result = evaluateToolCall(call, { paths: projectPaths(root), config });
  return { decision: result.decision, rule: result.decision === 'allow' ? undefined : result.rule };
}

function expectSameAsPlain(hidden: string, plain: string, rule: string, situation: Situation = {}, tool = 'Bash') {
  const expected = decide(plain, situation, tool);
  expect(expected, `plain form: ${plain}`).toEqual({ decision: 'deny', rule });
  expect(decide(hidden, situation, tool), hidden).toEqual(expected);
}

function expectAllowed(command: string, situation: Situation = {}, tool = 'Bash') {
  expect(decide(command, situation, tool), command).toEqual({ decision: 'allow', rule: undefined });
}

describe('B248.H1: redirects around a git subcommand', () => {
  it.each([
    [`git < a checkout -- ${STATE}`, `git checkout -- ${STATE}`],
    [`git < a restore ${STATE}`, `git restore ${STATE}`],
    [`git --no-pager < a mv a ${STATE}`, `git --no-pager mv a ${STATE}`],
    [`git -C . < a checkout -- ${STATE}`, `git -C . checkout -- ${STATE}`],
    [`git < a checkout -- ${GUARD}`, `git checkout -- ${GUARD}`],
  ])('%s', (hidden, plain) => {
    expectSameAsPlain(hidden, plain, plain.includes(GUARD) ? 'guard-config' : 'state-integrity');
  });

  it('the plan gate reads the same', () => {
    expectSameAsPlain('git < a checkout -- src/a.ts', 'git checkout -- src/a.ts', 'plan-gate', { planRequired: true });
  });

  it.each([['git < a status'], ['git < a log -1'], [`git < a show HEAD:${STATE}`]])('negative: %s', (command) => {
    expectAllowed(command, { planRequired: true });
  });

  it.each([
    [`tee out.txt < ${STATE}`, 'state-integrity'],
    [`tee out.txt < ${GUARD}`, 'guard-config'],
    [`cp a out.txt < ${STATE}`, 'state-integrity'],
  ])('no refusal is lost: the file after < is still seen by the state and guard checks: %s', (command, rule) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule });
  });
});

describe('B248.H2: a directory that cannot be resolved', () => {
  it.each([
    [`cd "$X"; rm ${STATE}`, `rm ${STATE}`],
    [`cd "$X"; echo x > ${STATE}`, `echo x > ${STATE}`],
    [`cd $PWD; mv a ${STATE}`, `mv a ${STATE}`],
    [`cd "$PWD" && sed -i s/a/b/ ${STATE}`, `sed -i s/a/b/ ${STATE}`],
    [`cd ~; rm ${STATE}`, `rm ${STATE}`],
    [`pushd "$X"; echo x | tee ${STATE}`, `echo x | tee ${STATE}`],
  ])('%s', (hidden, plain) => {
    expectSameAsPlain(hidden, plain, 'state-integrity');
  });

  it('PowerShell', () => {
    expectSameAsPlain(`Set-Location $PWD; Remove-Item ${STATE}`, `Remove-Item ${STATE}`, 'state-integrity', {},
      'PowerShell');
  });

  it('the same forms on a guarded file are refused already', () => {
    expectSameAsPlain(`cd "$X"; rm ${GUARD}`, `rm ${GUARD}`, 'guard-config');
  });
});

describe('B248.H3: protected and test paths after an unresolved directory', () => {
  it('a protected path', () => {
    expectSameAsPlain('cd "$X"; echo x > src/gen/x.ts', 'echo x > src/gen/x.ts', 'protected-path');
  });

  it('a locked test', () => {
    const situation = { testsLocked: true };
    expectSameAsPlain('cd "$X"; echo x > src/a.test.ts', 'echo x > src/a.test.ts', 'tests-locked', situation);
  });
});

describe('B248.H4: ordinary work after an unresolved directory', () => {
  it.each([
    ['cd "$X"; echo x > out.log'],
    ['cd "$X"; rm out.log'],
    [`cd "$X"; cat ${STATE}`],
    [`cd "$X"; grep a ${STATE}`],
    ['cd ~; ls'],
  ])('%s', (command) => {
    expectAllowed(command);
  });

  it('a named limit: the plan gate does not apply after an unresolved directory', () => {
    expectAllowed('cd "$X"; echo x > src/a.ts', { planRequired: true });
  });
});

describe('B248.H5: a variable prefix', () => {
  it.each([
    [`echo x > "$PWD/${STATE}"`, 'state-integrity'],
    [`echo x > \${PWD}/${STATE}`, 'state-integrity'],
    [`echo x > $HOME/${STATE}`, 'state-integrity'],
    [`echo x > \${X}${STATE}`, 'state-integrity'],
    [`rm "$PWD/${STATE}"`, 'state-integrity'],
    [`echo x > "\${X}/${GUARD}"`, 'guard-config'],
    [`echo x > \${PWD}/${GUARD}`, 'guard-config'],
    [`echo x > \${X}${GUARD}`, 'guard-config'],
  ])('%s', (command, rule) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule });
  });

  it.each([[`Remove-Item $env:X/${STATE}`, 'state-integrity'], [`Remove-Item $env:X/${GUARD}`, 'guard-config']])(
    'a PowerShell environment prefix: %s', (command, rule) => {
      expect(decide(command, {}, 'PowerShell'), command).toEqual({ decision: 'deny', rule });
    },
  );

  it.each([[`cat "$PWD/${STATE}"`], ['echo x > "$PWD/out.log"'], ['echo x > "$TMPDIR/roles.yaml"']])(
    'negative: %s', (command) => {
      expectAllowed(command);
    },
  );
});

describe('B248.H6: unquoted braces stay one word', () => {
  const view = (input: string) => shellWords(input).commands.map((command) =>
    command.words.filter((word) => !word.operator).map((word) => word.value));

  it('${PWD}/a is one word of one command', () => {
    expect(view('echo x > ${PWD}/a')).toEqual([['echo', 'x', '${PWD}/a']]);
  });

  it('${X:-a} is one word', () => {
    expect(view('echo ${X:-a}')).toEqual([['echo', '${X:-a}']]);
  });

  it('a brace group still splits into commands', () => {
    expect(view('{ echo a; echo b; }')).toEqual([['echo', 'a'], ['echo', 'b']]);
  });

  it('>| is one redirect, so its target stays with its command', () => {
    const words = shellWords('echo x >| f').commands[0].words.map((word) => word.value);
    expect(words).toEqual(['echo', 'x', '>', 'f']);
  });
});

describe('B248.H7: quotes inside a word and backslash spellings', () => {
  it.each([
    ['echo x > op""enspec/roles.yaml', `echo x > ${STATE}`],
    ["rm 'openspec'/roles.yaml", `rm ${STATE}`],
    ['mv a openspec\\roles.yaml', `mv a ${STATE}`],
    ['cp a op""enspec/roles.yaml', `cp a ${STATE}`],
    ['rm openspec\\roles.yaml', `rm ${STATE}`],
  ])('%s', (hidden, plain) => {
    expectSameAsPlain(hidden, plain, 'state-integrity');
  });
});

describe('B248.L2: a script given a protected path is a named limit', () => {
  it.each([[`node run.mjs ${STATE}`], [`./run.sh ${STATE}`], [`bash run.sh ${GUARD}`], [`python run.py ${STATE}`]])(
    '%s', (command) => {
      expectAllowed(command);
    },
  );
});

describe('Review round 1 of B248: comments and redirects', () => {
  it('F3: a backslash continuation inside a bash comment does not hide the next command', () => {
    const command = 'echo hi # note \\\necho x > src/gen/x.ts';
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'protected-path' });
  });

  it('F3: cmd has no # comments', () => {
    expect(decide('cmd /c "echo hi # > src/gen/x.ts"')).toEqual({ decision: 'deny', rule: 'protected-path' });
    expect(decide('cmd /c del #x src\\gen\\x.ts').decision).toBe('deny');
  });

  it.each([['echo a >&src/gen/x.ts', 'protected-path'], [`echo a >&${GUARD}`, 'guard-config']])(
    'F9: an unspaced >&FILE writes the file: %s', (command, rule) => {
      expect(decide(command), command).toEqual({ decision: 'deny', rule });
    },
  );

  it.each([['echo a >&2'], ['echo a 2>&1'], ['echo a >&-']])(
    'F9 negative: a descriptor is not a file: %s', (command) => {
      expectAllowed(command, { planRequired: true });
    },
  );
});

describe('Review round 2 of B248: a # is not a comment that hides a command', () => {
  const APPROVE = 'sdlc approve fix --gate plan';
  it.each([
    [`echo a,#b; ${APPROVE}`],
    ['echo ,#b && sdlc tests unlock fix'],
    [`echo x}#y; ${APPROVE}`],
    [`echo {#,y}; ${APPROVE}`],
    [`echo a{b,c}#d; ${APPROVE}`],
    [`echo a\r#b; ${APPROVE}`],
    [`bash -c "echo a,#b; ${APPROVE}"`],
  ])('F17: a person-only command after a # stays refused: %s', (command) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule: 'separation-of-duties' });
  });

  it.each([
    [`rm -f a,#b ${STATE}`, 'state-integrity'],
    [`rm -f ,#b ${STATE}`, 'state-integrity'],
    [`eval rm a,#b ${STATE}`, 'state-integrity'],
    ['echo hi > a,#b > src/gen/x.ts', 'protected-path'],
    ['echo x > a,#b; echo x > src/gen/x.ts', 'protected-path'],
    ["sh -c 'echo x > a,#b > src/gen/x.ts'", 'protected-path'],
  ])('F17: a write after a # stays refused: %s', (command, rule) => {
    expect(decide(command), command).toEqual({ decision: 'deny', rule });
  });

  it.each([
    [`<# c #> rm ${STATE}`, 'Bash'],
    [`<# c #> Remove-Item ${STATE}`, 'PowerShell'],
    [`<# c\n#> Remove-Item ${STATE}`, 'PowerShell'],
    [`pwsh -c "<# c #> Remove-Item ${STATE}"`, 'Bash'],
  ])('F18: a PowerShell block comment does not hide the command after it: %s', (command, tool) => {
    expect(decide(command, {}, tool), command).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });

  it('F18: the plan gate reads the command after a block comment', () => {
    expect(decide('<# c #> Remove-Item src/a.ts', { planRequired: true }, 'PowerShell').decision).toBe('deny');
  });

  it.each([['Bash'], ['PowerShell']])('F24: a cmd body started by Start-Process keeps its write (%s)', (tool) => {
    const command = "Start-Process cmd -ArgumentList '/c echo hi # > src/gen/x.ts'";
    expect(decide(command, {}, tool)).toEqual({ decision: 'deny', rule: 'protected-path' });
  });

  it.each([
    ['C:/Windows/System32/cmd.exe /c "echo hi > src/gen/x.ts"'],
    ['/c/Windows/System32/cmd /c "echo hi > src/gen/x.ts"'],
    ['/usr/bin/bash -c "echo hi > src/gen/x.ts"'],
  ])('F26: a shell started by its full path is followed into its body: %s', (command) => {
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'protected-path' });
  });
});
