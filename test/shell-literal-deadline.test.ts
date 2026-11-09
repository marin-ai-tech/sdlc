import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

/**
 * B248 review round 6, by the owner's decision: the work that literal values add has a time limit. The hook fails
 * open past the host's 30 s timeout, and every round of counting the work found another way past it (F39 values,
 * F40 nested bodies, F41 path depth). The command as written is checked first, as on the base build, so its
 * refusals stand whatever the time; the added spellings must finish within the limit, or the command is refused
 * with shell-parse. `literalDeadlineMs` in the policy context sets the limit; the default stays well under 30 s.
 */

const STATE = 'openspec/roles.yaml';
const FILES = [STATE, 'src/gen/x.ts', 'src/a.ts', 'a', 'openspec/sdlc.yaml'];
const LINK_CHAIN = 1000;

function newStand(): string {
  const root = tempDir('sdlc-b248-deadline-');
  for (const file of FILES) write(path.join(root, file), 'original\n');
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'src', 'l'), 'junction');
  return root;
}

const root = newStand();

interface Options {
  deadline?: number;
  planRequired?: boolean;
  warn?: boolean;
}

function decide(command: string, options: Options = {}) {
  const config = defaultConfig();
  config.enforcement.mode = options.warn ? 'warn' : 'block';
  config.enforcement.requireApprovedPlan = options.planRequired === true;
  config.enforcement.protectedPaths = ['src/gen/**'];
  const call = normalizeToolCall('Bash', { command }, root);
  const context = { paths: projectPaths(root), config,
    ...(options.deadline === undefined ? {} : { literalDeadlineMs: options.deadline }) };
  const result = evaluateToolCall(call, context);
  return { decision: result.decision, rule: result.decision === 'allow' ? undefined : result.rule };
}

/** The hook fails open past 30 s, so a write must be decided well within it. */
function expectQuickRefusal(command: string, limit = 8000) {
  const started = Date.now();
  expect(decide(command).decision, command.slice(0, 120)).toBe('deny');
  expect(Date.now() - started).toBeLessThan(limit);
}

const many = (count: number, word: string) => Array.from({ length: count }, () => word).join(' ');
const letters = 'a b c d e f g h i j k l m n o p';
const doubling = ['A=' + 'x'.repeat(64), 'S0=$A',
  ...Array.from({ length: 10 }, (_, index) => `A=$A$A; S${index + 1}=$A`)].join('; ');
const sum = 'L=' + Array.from({ length: 11 }, (_, index) => `$S${10 - index}`).join('');
const seed = `${doubling}; ${sum}; for X in ${letters}; do :; done; X=$L$X; `;

function quoted(text: string): string {
  return `"${text.replace(/[\\"$`]/g, (match) => `\\${match}`)}"`;
}

describe('B248 round 6: literal values have a time limit', () => {
  it('F39: sixteen long values used 10,000 times before a write to the hook settings are refused quickly', () => {
    expectQuickRefusal(`${seed}: "${'$X'.repeat(10000)}"; echo {} > .claude/settings.json`);
  }, 120000);

  it('F39: sixteen long values in a for list of 3,800 words are refused quickly', () => {
    expectQuickRefusal(`${seed}for Y in ${many(3800, '$X.')}; do :; done; echo {} > .claude/settings.json`);
  }, 120000);

  it('F40: a third level of eval inside a shell body with four values is refused quickly', () => {
    const inner = `echo ${many(3800, 'a')} > x.log`;
    const third = `eval ${quoted(`eval ${quoted(inner)}`)}`;
    const body = `for T in v0 v1 v2 v3; do :; done; echo $T; eval ${quoted(third)}`;
    expectQuickRefusal(`bash -c '${body}'; echo {} > .claude/settings.json`);
  }, 120000);

  it('F41: a chain of 1,000 links through a junction after a fourteen-value loop is refused quickly', () => {
    const chain = `src/${many(LINK_CHAIN, 'l').replace(/ /g, '/')}/a.ts`;
    const loop = 'for f in a b c d e f g h i j k l m n; do :; done;';
    expectQuickRefusal(`${loop} echo $f ${chain} > .claude/settings.json`);
  }, 120000);

  it('past the limit, a command whose added spellings were not read is refused with shell-parse', () => {
    expect(decide('T=src/gen/x.ts; echo x > "$T"', { deadline: 0 })).toEqual({ decision: 'deny', rule: 'shell-parse' });
    expect(decide('T=a; echo $T', { deadline: 0 })).toEqual({ decision: 'deny', rule: 'shell-parse' });
  });

  it('past the limit, a refusal of the command as written keeps its own rule', () => {
    expect(decide(`T=a; rm ${STATE}`, { deadline: 0 })).toEqual({ decision: 'deny', rule: 'state-integrity' });
    expect(decide('T=a; echo x > src/gen/x.ts', { deadline: 0 })).toEqual({ decision: 'deny', rule: 'protected-path' });
    expect(decide('T=a; echo x > src/a.ts', { deadline: 0, planRequired: true }))
      .toEqual({ decision: 'deny', rule: 'plan-gate' });
  });

  it('past the limit, a command with no literal value is decided as before', () => {
    expect(decide('echo hi', { deadline: 0 })).toEqual({ decision: 'allow', rule: undefined });
    expect(decide('cat src/a.ts', { deadline: 0 })).toEqual({ decision: 'allow', rule: undefined });
    expect(decide(`rm ${STATE}`, { deadline: 0 })).toEqual({ decision: 'deny', rule: 'state-integrity' });
  });

  it('a warning on the command as written does not hide a refusal found through a value', () => {
    const command = `T=${STATE}; echo x > src/a.ts; rm "$T"`;
    expect(decide(command, { warn: true, planRequired: true })).toEqual({ decision: 'deny', rule: 'state-integrity' });
    expect(decide('echo x > src/a.ts', { warn: true, planRequired: true }))
      .toEqual({ decision: 'warn', rule: 'plan-gate' });
  });

  it('with the default limit, ordinary commands with values are still read and decided', () => {
    expect(decide('for f in a.txt b.txt; do wc -l $f; done')).toEqual({ decision: 'allow', rule: undefined });
    expect(decide(`T=${STATE}; rm "$T"`)).toEqual({ decision: 'deny', rule: 'state-integrity' });
    expect(decide('T=src/gen/x.ts; echo x > "$T"')).toEqual({ decision: 'deny', rule: 'protected-path' });
  });
});

describe('B248 round 7: building is linear, uses with the same values share a group, early checks come first', () => {
  const files = 'a.txt b.txt c.txt d.txt e.txt';

  it('F46: two loops over the same five files are read and allowed', () => {
    const loop = `for f in ${files}; do wc -l $f; done`;
    expect(decide(`${loop}; ${loop}`)).toEqual({ decision: 'allow', rule: undefined });
  });

  it('F46: three loops over the same four files are read and allowed', () => {
    const loop = 'for f in a.txt b.txt c.txt d.txt; do wc -l $f; done';
    expect(decide(`${loop}; ${loop}; ${loop}`)).toEqual({ decision: 'allow', rule: undefined });
  });

  it('F46: two loops over the same files still find a write through either', () => {
    const loop = `for f in a.txt ${STATE}; do cat $f; done`;
    expect(decide(`${loop}; for f in a.txt ${STATE}; do rm $f; done`))
      .toEqual({ decision: 'deny', rule: 'state-integrity' });
  });

  it('F45: eight thousand fallback uses are built quickly, so the written command is checked at once', () => {
    const started = Date.now();
    const command = `: "${'${U:-a}'.repeat(8000)}"; echo {} > .claude/settings.json`;
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'guard-config' });
    expect(Date.now() - started).toBeLessThan(3000);
  }, 120000);

  it('F50: two assignments with the same values keep every combination between them', () => {
    const pick = (test: string) => `if test -d ${test}; then D=.claude; else D=settings.json; fi`;
    const command = `${pick('.claude')}; cd $D; ${pick('x')}; echo {} > $D`;
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'guard-config' });
  });

  it('F52: slow early checks do not use up the building time of a command without known values', () => {
    const command = `true || exec ${'-a '.repeat(32)}x; echo $HOME > /tmp/out.txt`;
    expect(decide(command)).toEqual({ decision: 'allow', rule: undefined });
  }, 120000);

  it('F45: a command that clears agent markers keeps the agent-marker rule past the spelling limit', () => {
    const values = Array.from({ length: 17 }, (_, index) => `v${index}`).join(' ');
    const command = `for f in ${values}; do echo $f; done; unset CLAUDECODE; echo hi`;
    expect(decide(command)).toEqual({ decision: 'deny', rule: 'agent-marker' });
  });
});
