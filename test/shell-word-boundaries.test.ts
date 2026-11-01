import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { callsHumanCommand } from '../src/core/human-command-match.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { shellWords } from '../src/core/shell-words.js';
import { shellCliInvocations } from '../src/core/shell-cli.js';
import { tempDir, write } from './helpers.js';

function decide(command: string, cli = 'sdlc') {
  const root = tempDir('e20-word-boundary-');
  const config = defaultConfig();
  config.cli = cli;
  write(path.join(root, 'package.json'), '{"scripts":{"sdlc":"sdlc"},"name":"demo"}');
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

describe('Static parser boundaries and launcher neighbors', () => {
  it.each(['\u00a0', '\u2003', '\r'])('keeps explicit POSIX literal filename whitespace %j', whitespace => {
    const input = `cp -R source${whitespace}name destination`;
    const parsed = shellWords(input, false, { dialect: 'posix' });
    expect(parsed.problem).toBeUndefined();
    expect(parsed.commands[0].words.map(word => word.value))
      .toEqual(['cp', '-R', `source${whitespace}name`, 'destination']);
  });

  it('keeps exact original spans while decoding concatenation', () => {
    const input = 'echo ok && sdlc ap""prove plan';
    const command = shellWords(input).commands[1];
    expect(command.raw).toBe('sdlc ap""prove plan');
    expect(command.words.map((word) => word.value)).toEqual(['sdlc', 'approve', 'plan']);
    expect(input.slice(command.words[1].start, command.words[1].end)).toBe('ap""prove');
  });

  it.each(['sdlc "ap`prove" plan', 'sdlc plugins --locale en accept economy'])
    ('retains supported PowerShell quotes and group global options: %s', (command) => {
      expect(callsHumanCommand(command)).toBe(true);
    });

  it('refuses bounded excess and unresolved SDLC writes while allowing dynamic harmless data', () => {
    expect(decide('echo ' + 'x'.repeat(131073)).decision).toBe('deny');
    expect(decide('sdlc "$STEP" --change demo').decision).toBe('deny');
    expect(decide('echo "$DATA"').decision).not.toBe('deny');
  });

  it.each(['rm node_modules/.bin/sdlc', 'mv node_modules/.bin/sdlc old-shim'])
    ('protects npx removal as well as overwrite: %s', (command) => {
      expect(decide(command, 'npx --no-install sdlc')).toMatchObject({ decision: 'deny', rule: 'guard-config' });
    });

  it('selectively allows a static unrelated shell package replacement', () => {
    expect(decide('echo \'{"scripts":{"sdlc":"sdlc"},"name":"updated"}\' > package.json', 'pnpm sdlc').decision)
      .not.toBe('deny');
    expect(decide('echo \'{"scripts":{"sdlc":"echo bypass"},"name":"demo"}\' > package.json', 'pnpm sdlc'))
      .toMatchObject({ decision: 'deny', rule: 'guard-config' });
  });
});

function nestedShell(depth: number, body: string): string {
  for (let index = 0; index < depth; index += 1) body = "sh -c '" + body.replace(/'/g, "'\\''") + "'";
  return body;
}

function executionDecision(command: string) {
  const root = tempDir('e20-shell-execution-');
  const config = defaultConfig();
  config.enforcement.mode = 'block';
  config.enforcement.requireApprovedPlan = false;
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

describe('Known-shell execution evidence and bounds', () => {
  it.each([
    { label: 'read command substitution', command: 'sdlc status "$(printf inert > openspec/sdlc.yaml)"' },
    { label: 'help command substitution', command: 'sdlc approve --help "$(printf inert > openspec/sdlc.yaml)"' },
    { label: 'read paired backticks', command: 'sdlc status "`printf inert > openspec/sdlc.yaml`"' },
    { label: 'read paired backticks with static suffix',
      command: 'sdlc status "x`printf inert > openspec/sdlc.yaml`y"' },
    { label: 'unquoted read substitution', command: 'sdlc status $(printf inert)' },
    { label: 'outer shell-body substitution', command: 'sh -c "sdlc status $(printf inert > marker.txt)"' },
    { label: 'outer shell-argument substitution', command: 'sh -c "sdlc status" "$(printf inert > marker.txt)"' },
    { label: 'CMD single-quoted percent operation', command: 'cmd /c "sdlc \'%E20_STEP%\' plan"' },
    { label: 'CMD read percent operand', command: 'cmd /c "sdlc status \'%E20_DATA%\'"' },
    { label: 'CMD help percent operand', command: 'cmd /c "sdlc approve --help \'%E20_DATA%\'"' },
    { label: 'CMD delayed operation enabled', command: 'cmd /v:on /c "sdlc !E20_STEP! plan"' },
    { label: 'known-shell bound with person command', command: nestedShell(4, 'sdlc approve plan') },
    { label: 'known-shell bound with harmless body', command: nestedShell(4, 'echo harmless') },
  ])('refuses $label with a bounded shell diagnostic', ({ command }) => {
    expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    'cmd /c sdlc approve plan',
    'cmd.exe /k sdlc approve plan',
    'powershell -Command sdlc approve plan',
    'pwsh -c sdlc approve plan',
    'C:\\Windows\\System32\\cmd.exe /c sdlc approve plan',
    "/usr/bin/sh -c 'sdlc approve plan'",
    "env sh -c 'sdlc approve plan'",
    'powershell -Co sdlc approve plan',
  ])('retains the complete command remainder: %s', command => {
    expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
  });

  it.each([
    'sdlc status --change "$CHANGE"',
    'sdlc approve --help "$NOTE"',
    "sdlc status '$(printf literal)'",
    "sdlc status '`printf literal`'",
    'sh -c "sdlc status \'%E20_DATA%\'"',
    'cmd /c "sdlc status literal"',
    'cmd /c "sdlc approve --help"',
    'cmd /v:off /c "sdlc status !E20_DATA!"',
    'cmd /v:on /c "sdlc status !E20_DATA!"',
    "sh -c 'echo harmless' sdlc approve plan",
    'sh -c sdlc approve plan',
    nestedShell(3, 'echo harmless'),
  ])('keeps inert scalar, literal, help or POSIX argv control: %s', command => {
    expect(executionDecision(command).decision).toBe('allow');
  });

  it('retains person-command denial at the exact supported nesting boundary', () => {
    expect(executionDecision(nestedShell(3, 'sdlc approve plan')))
      .toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
  });

  it('retains the existing refusal for a visible unquoted protected write', () => {
    expect(executionDecision('sdlc status $(printf inert > openspec/sdlc.yaml)').decision).toBe('deny');
  });

  it('refuses active substitution in a double-quoted PowerShell here-string', () => {
    expect(executionDecision('sdlc status @"\n$(printf inert > marker.txt)\n"@'))
      .toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each(['sdlc status @"\n$CHANGE\n"@', "sdlc status @'\n$(printf literal)\n'@"])
    ('keeps scalar and literal PowerShell here-string data: %s', command => {
      expect(executionDecision(command).decision).toBe('allow');
    });

  it.each(['sdlc --locale $LANG status', 'sdlc --locale=$LANG status', 'sdlc --locale "$LANG" status',
    'sh -c "sdlc status \'$CHANGE\'"'])('refuses uncertain operation or interpolated shell code: %s', command => {
    expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each(["sh -c 'sdlc --locale \"$LANG\" status'", 'sdlc status --change $CHANGE'])
    ('keeps a quoted global value or scalar after a known read: %s', command => {
      expect(executionDecision(command).decision).toBe('allow');
    });

  it.each(['cmd /v:on /c sdlc --locale !LANG! status'])
    ('refuses delayed operation changes in an explicit CMD context: %s', command => {
      expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
    });

  it('refuses a quoted delayed global value whose contents can reshape CMD argv', () => {
    expect(executionDecision('cmd /v:on /c sdlc --locale "!LANG!" status'))
      .toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each(['printf "%s" "$(printf E20_INERT > openspec/sdlc.yaml)"',
    'printf "%s" "$(sdlc approve plan)"'])('retains execution evidence beyond a read-looking outer program: %s',
    command => expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' }));

  it.each(['cmd /v:on /c "sdlc ap!prove plan"', "printf \"%s\" '$(sdlc approve plan)'",
    'powershell -Command \'sdlc status @"\n``literal``\n"@\''])('keeps native-confirmed literal data: %s', command => {
    expect(executionDecision(command).decision).toBe('allow');
  });

  it.each(['printf "%s" <(sdlc approve plan)', 'printf "%s" >(sdlc approve plan)'])
    ('refuses active process substitution without executing it: %s', command => {
      expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
    });

  it.each(['printf "%s" "<(sdlc approve plan)"', "printf '%s' '>(sdlc approve plan)'"])
    ('keeps quoted process-substitution text literal: %s', command => {
      expect(executionDecision(command).decision).toBe('allow');
    });

  it.each(['powershell', 'pwsh'])('keeps explicit %s double-quoted backtick escapes literal', shell => {
    const command = `${shell} -Command 'sdlc status "a\`\`b"'`;
    const call = shellCliInvocations(command)[0];
    expect(call.args).toEqual(['status', 'a`b']);
    expect(call.command.raw).toBe('sdlc status "a``b"');
    expect(executionDecision(command).decision).toBe('allow');
  });

  it.each(['powershell', 'pwsh'])('refuses uncertain %s native quoted global expansion', shell => {
    expect(executionDecision(`${shell} -Command 'sdlc --locale "$LANG" status'`))
      .toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it('keeps native PowerShell scalar data after a stable read operation', () => {
    expect(executionDecision('powershell -Command \'sdlc status "$DATA"\'').decision).toBe('allow');
  });

  it.each(['sdlc status @"\n`printf inert > marker.txt`\n"@',
    'sh -c \'sdlc status @"\n`printf inert > marker.txt`\n"@\'', 'sdlc status @"\n``literal``\n"@'])
    ('retains non-PowerShell execution ambiguity in double-quoted here syntax: %s', command => {
      expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
    });

  it.each(['command command sdlc approve plan', 'command env sdlc approve plan'])
    ('retains person-only refusal through repeated known launchers: %s', command => {
      expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    });

  it('keeps data literal after repeated known launchers', () => {
    expect(executionDecision('command env printf "%s" "sdlc approve plan"').decision).toBe('allow');
  });
});

describe('Opaque launcher configuration before a stable operation', () => {
  it.each([
    'cmd $E20_FLAGS /c "sdlc !E20_STEP! plan"',
    'cmd /v:$E20_MODE /c "sdlc !E20_STEP! plan"',
    "powershell $E20_FLAGS -Command 'sdlc status'",
    "sh $E20_FLAGS -c 'sdlc status'",
    'env E20_VALUE=$E20_FIELDS sdlc status',
    'env E20_VALUE=$E20_FIELDS sh -c "sdlc status"',
  ])('refuses unresolved launcher fields or shell options: %s', command => {
    expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it('keeps a scalar environment assignment in an explicit POSIX body', () => {
    expect(executionDecision("sh -c 'env E20_VALUE=\"$E20_DATA\" sdlc status'").decision).toBe('allow');
  });
});

describe('Known CLI filename fields cannot resolve a submitted operation', () => {
  it.each([
    'sdlc *',
    'sdlc [ap]*',
    'sdlc plugins *',
    'sdlc --locale * status',
    'sdlc --cwd [ap]* status',
    'sdlc * --help',
    'sdlc plugins * --help',
  ])('refuses unresolved operation fields without consulting filesystem matches: %s', command => {
    const actual = executionDecision(command);
    expect(actual).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
    expect(actual.reason!.length).toBeLessThanOrEqual(1000);
  });

  it.each([
    'sdlc "*"',
    "sdlc '*'",
    'sdlc \\*',
    'sdlc plugins "*"',
    'sdlc status *',
    'rg *',
    "printf '%s' *",
    "printf '%s' 'sdlc *'",
    'sdlc --dir ~ status',
    'sdlc --cwd ~ status',
    'sdlc approve plan --help *',
  ])('retains literal patterns, stable read/help tails and scalar home values: %s', command => {
    expect(executionDecision(command).decision).toBe('allow');
  });
});

describe('Outer fields remain executable evidence at known shell body boundaries', () => {
  it.each([
    'sh -c *',
    "sh -c 'cmd /c sdlc status *'",
    "sh -c 'powershell -Command *'",
    'sh -c \'powershell * -Command "sdlc status"\'',
  ])('refuses an expanded known-shell body or option rather than guessing literal code: %s', command => {
    expect(executionDecision(command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it.each([
    "sh -c 'sdlc status *'",
    "powershell -Command 'sdlc status *'",
    "sh -c 'printf data' *",
  ])('keeps literal read bodies and POSIX trailing argv separate from code: %s', command => {
    expect(executionDecision(command).decision).toBe('allow');
  });
});
