import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

describe('Recursive source copies', () => {
  it.each(['cp -R source destination', 'robocopy source destination /E', 'xcopy source destination /E',
    'Copy-Item source destination -Recurse', 'Copy-Item -LiteralPath source -Destination destination -Recurse'])
    ('checks the actual source subtree: %s', (command) => {
      const root = tempDir('e20-copy-');
      const config = defaultConfig();
      config.enforcement.mode = 'warn';
      const decide = () => evaluateToolCall(normalizeToolCall('Bash', { command }, root),
        { paths: projectPaths(root), config });
      write(path.join(root, 'source/docs/readme.md'), 'ordinary');
      expect(decide().decision).not.toBe('deny');
      write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
      expect(decide()).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });
});

function copyDecision(root: string, command: string) {
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  config.enforcement.requireApprovedPlan = false;
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

function posixBody(command: string): string {
  return "sh -c '" + command.replace(/'/g, "'\\''") + "'";
}

const copyForms: Array<[string, (source: string) => string]> = [
  ['POSIX literal body', source => posixBody(`cp -R ${source} destination`)],
  ['CMD literal body', source => `cmd /c "robocopy ${source} destination /E"`],
  ['CMD argument remainder', source => `cmd /c robocopy ${source} destination /E`],
  ['PowerShell literal body', source => `powershell -Command "Copy-Item ${source} destination -Recurse"`],
  ['PowerShell argument remainder', source => `powershell -Command Copy-Item ${source} destination -Recurse`],
  ['pwsh literal named operands', source => `pwsh -c 'Copy-Item -LiteralPath ${source} -Destination destination -Recurse'`],
  ['three POSIX bodies', source => posixBody(posixBody(posixBody(`cp -R ${source} destination`)))],
  ['known launcher before a shell', source => `command env E20_COPY=1 ${posixBody(`cp -R ${source} destination`)}`],
  ['known launcher inside a shell', source => posixBody(`command env E20_COPY=1 cp -R ${source} destination`)],
  ['command launcher', source => `command cp -R ${source} destination`],
  ['repeated command launcher', source => `command command cp -R ${source} destination`],
  ['environment launcher', source => `env E20_COPY=1 cp -R ${source} destination`],
  ['exec launcher', source => `exec cp -R ${source} destination`],
  ['sudo launcher', source => `sudo cp -R ${source} destination`],
  ['native cp suffix', source => `cp.exe -R ${source} destination`],
  ['absolute POSIX cp', source => `/usr/bin/cp -R ${source} destination`],
  ['absolute Windows cp', source => `"C:\\Tools\\cp.exe" -R ${source} destination`],
  ['native robocopy suffix', source => `robocopy.exe ${source} destination /E`],
  ['absolute robocopy', source => `"C:\\Windows\\System32\\robocopy.exe" ${source} destination /E`],
  ['absolute xcopy', source => `"C:\\Windows\\System32\\xcopy.exe" ${source} destination /E`],
  ['suffixed copy in CMD', source => `cmd.exe /c robocopy.exe ${source} destination /E`],
  ['quoted concatenation in body', source => posixBody(`cp -R "${source.slice(0, 2)}"${source.slice(2)} destination`)],
  ['ANSI-C source in body', source => posixBody(`cp -R $'${source}' destination`)],
];

describe('Literal copy wrappers share recognized executable and source semantics', () => {
  it.each(copyForms)('checks source contents through %s', (_name, form) => {
    const root = tempDir('e20-copy-wrapper-');
    write(path.join(root, 'source/docs/readme.md'), 'ordinary');
    expect(copyDecision(root, form('source')).decision).toBe('allow');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyDecision(root, form('source'))).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each(copyForms.slice(0, 6))('retains state-free conventional source names through %s', (_name, form) => {
    const root = tempDir('e20-copy-conventional-wrapper-');
    write(path.join(root, 'openspec/changes/empty/intent.md'), 'ordinary draft');
    expect(copyDecision(root, form('openspec/changes/empty')).decision).toBe('allow');
  });

  it.each([
    'printf "%s" "sh -c \'cp -R source destination\'"',
    'command env printf "%s" "cp -R source destination"',
    'printf "%s" "robocopy.exe source destination /E"',
    "sh -c 'printf \"%s\" \"Copy-Item source destination -Recurse\"'",
  ])('keeps a quoted command mention as data: %s', command => {
    const root = tempDir('e20-copy-data-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyDecision(root, command).decision).toBe('allow');
  });

  it('does not join POSIX arguments after the single -c program', () => {
    const root = tempDir('e20-copy-posix-argv-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyDecision(root, "sh -c 'printf data' cp -R source destination").decision).toBe('allow');
  });

  it('refuses unsupported extra shell depth without inventing a copy refusal', () => {
    const root = tempDir('e20-copy-depth-');
    const command = posixBody(posixBody(posixBody(posixBody('printf data'))));
    expect(copyDecision(root, command)).toMatchObject({ decision: 'deny', rule: 'shell-parse' });
  });

  it('refuses a computed source in an otherwise literal copy body', () => {
    const root = tempDir('e20-copy-dynamic-');
    expect(copyDecision(root, posixBody('cp -R "$E20_SOURCE" destination')))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('retains the caller cwd in a child shell after a literal outer cd', () => {
    const root = tempDir('e20-copy-outer-cwd-');
    write(path.join(root, 'work/readme.md'), 'ordinary');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyDecision(root, `cd work; ${posixBody('cp -R ../source destination')}`))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('follows an independent literal child cwd before inspecting a copy source', () => {
    const root = tempDir('e20-copy-child-cwd-');
    write(path.join(root, 'source/readme.md'), 'ordinary');
    write(path.join(root, 'child/source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyDecision(root, posixBody('cd child; cp -R source destination')))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('does not leak a child cwd past shell return and miss a parent state source', () => {
    const root = tempDir('e20-copy-parent-cwd-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    write(path.join(root, 'child/source/readme.md'), 'ordinary');
    expect(copyDecision(root, `${posixBody('cd child; cp -R source destination')}; cp -R source destination`))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('does not leak a child cwd and refuse a state-free parent source', () => {
    const root = tempDir('e20-copy-parent-plain-');
    write(path.join(root, 'source/readme.md'), 'ordinary');
    write(path.join(root, 'child/source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyDecision(root, `${posixBody('cd child; printf data')}; cp -R source destination`).decision).toBe('allow');
  });

  for (const target of ['openspec/.sdlc/inbox', 'openspec/roles.yaml', 'openspec/sdlc.yaml']) {
    it.each(copyForms.slice(0, 6))(`retains protected destination ${target} through %s`, (_name, form) => {
      const root = tempDir('e20-copy-protected-destination-');
      write(path.join(root, 'source/readme.md'), 'ordinary');
      const command = form('source').replaceAll('destination', target);
      expect(copyDecision(root, command).decision).toBe('deny');
    });
  }

  it('does not move a protected parent destination into a child cwd', () => {
    const root = tempDir('e20-copy-parent-destination-');
    write(path.join(root, 'source/readme.md'), 'ordinary');
    write(path.join(root, 'child/readme.md'), 'ordinary');
    const command = `${posixBody('cd child; printf data')}; cp -R source openspec/.sdlc/inbox`;
    expect(copyDecision(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});
