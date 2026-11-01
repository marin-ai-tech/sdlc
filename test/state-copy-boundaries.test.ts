import * as path from 'node:path';
import * as fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

describe('Copy source contents govern conventional names too', () => {
  it.each(['cp -R', 'robocopy', 'xcopy', 'Copy-Item'])('allows a state-free conventional source: %s', (verb) => {
    const root = tempDir('e20-copy-shape-');
    const config = defaultConfig();
    config.enforcement.mode = 'warn';
    const source = 'openspec/changes/empty';
    write(path.join(root, source, 'intent.md'), 'plain draft');
    const suffix = verb === 'Copy-Item' ? ' -Recurse' : /^(?:robocopy|xcopy)$/.test(verb) ? ' /E' : '';
    const command = `${verb} ${source} destination${suffix}`;
    const decide = () => evaluateToolCall(normalizeToolCall('Bash', { command }, root),
      { paths: projectPaths(root), config });
    expect(decide().decision).not.toBe('deny');
    write(path.join(root, source, 'deep/.sdlc.yaml'), 'version: 1');
    expect(decide()).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});

function copyPolicy(root: string, command: string) {
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  config.enforcement.requireApprovedPlan = false;
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

describe('Reviewed copy traversal and POSIX whitespace', () => {
  it.each(['\u00a0', '\u2003'])('preserves a POSIX Unicode source and destination (%j)', whitespace => {
    const root = tempDir('e20-copy-posix-whitespace-');
    const source = `openspec/changes/source${whitespace}name`;
    write(path.join(root, source, 'readme.md'), 'ordinary');
    const command = `sh -c 'cp -R ${source} ordinary${whitespace}destination'`;
    expect(copyPolicy(root, command).decision).toBe('allow');
    write(path.join(root, source, '.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(copyPolicy(root, `sh -c "cp -R '${source}' destination"`))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each(['\u00a0', '\u2003'])('retains the protected POSIX destination with %j', whitespace => {
    const root = tempDir('e20-copy-posix-target-');
    write(path.join(root, 'plain/readme.md'), 'ordinary');
    const target = `openspec/changes/target${whitespace}name`;
    write(path.join(root, target, 'intent.md'), 'draft');
    expect(copyPolicy(root, `sh -c 'cp -R plain ${target}'`))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    expect(copyPolicy(root, `sh -c 'cp -R plain ordinary${whitespace}target'`).decision).toBe('allow');
  });

  it('refuses an existing protected source even when a descendant is dangling', () => {
    const root = tempDir('e20-copy-dangling-descendant-');
    const source = path.join(root, 'openspec/changes/victim');
    write(path.join(source, '.sdlc.yaml'), 'version: 1');
    const command = 'cp -R openspec/changes/victim destination';
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    fs.symlinkSync(path.join(root, 'missing'), path.join(source, 'zz-dangling'),
      process.platform === 'win32' ? 'junction' : 'dir');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('still allows a genuinely missing literal top-level source', () => {
    const root = tempDir('e20-copy-missing-source-');
    expect(copyPolicy(root, 'cp -R missing destination').decision).toBe('allow');
  });
});

describe('Recognized copy operand boundaries', () => {
  it.each([
    'cp -R -- -source destination',
    'cp --recursive -- -source -destination',
    'cp -R --target-directory destination -- -source',
    "sh -c 'cp -R -- -source destination'",
  ])('retains a literal leading-dash source after end-of-options: %s', command => {
    const root = tempDir('e20-copy-dash-');
    write(path.join(root, '-source/readme.md'), 'ordinary');
    expect(copyPolicy(root, command).decision).toBe('allow');
    write(path.join(root, '-source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    'Copy-Item -Path plain,source -Destination destination -Recurse',
    'Copy-Item -Path plain, source -Destination destination -Recurse',
    "Copy-Item -Path 'plain',source -Destination destination -Recurse",
    'Copy-Item -Path:plain,source -Destination destination -Recurse',
    'Copy-Item plain,source destination -Recurse',
    "pwsh -c 'Copy-Item -Path plain,source -Destination destination -Recurse'",
  ])('checks every literal PowerShell source in an array: %s', command => {
    const root = tempDir('e20-copy-array-');
    write(path.join(root, 'plain/readme.md'), 'ordinary');
    write(path.join(root, 'source/readme.md'), 'ordinary');
    expect(copyPolicy(root, command).decision).toBe('allow');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each([
    "Copy-Item -Path 'source,plain' -Destination destination -Recurse",
    'Copy-Item -LiteralPath "source,plain" -Destination destination -Recurse',
    'Copy-Item -Path source`,plain -Destination destination -Recurse',
    "pwsh -c 'Copy-Item -Path \"source,plain\" -Destination destination -Recurse'",
  ])('keeps a quoted or escaped comma in one literal source: %s', command => {
    const root = tempDir('e20-copy-literal-comma-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'unrelated state');
    write(path.join(root, 'source,plain/readme.md'), 'ordinary');
    expect(copyPolicy(root, command).decision).toBe('allow');
    write(path.join(root, 'source,plain/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('Copy cwd resolution does not assume a failed cd succeeded', () => {
  it.each(['cd missing; cp -R source destination', "sh -c 'cd missing; cp -R source destination'"])
    ('refuses state-bearing parent copies after a missing directory: %s', command => {
      const root = tempDir('e20-copy-failed-cd-');
      write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
      expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it('still allows a state-free source after a valid child cd', () => {
    const root = tempDir('e20-copy-valid-cd-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'unrelated parent state');
    write(path.join(root, 'child/source/readme.md'), 'ordinary');
    expect(copyPolicy(root, "sh -c 'cd child; cp -R source destination'").decision).toBe('allow');
  });
});

describe('Copy uncertainty and literal source spellings', () => {
  it('does not mistake an existing literal glob spelling for a resolved shell source', () => {
    const root = tempDir('e20-copy-glob-shadow-');
    write(path.join(root, 'source[1]/readme.md'), 'ordinary literal path');
    write(path.join(root, 'source1/deep/.sdlc.yaml'), 'expanded state source');
    expect(copyPolicy(root, "cp -R 'source[1]' destination").decision).toBe('allow');
    expect(copyPolicy(root, 'cp -R source\\[1\\] destination').decision).toBe('allow');
    expect(copyPolicy(root, 'cp -R source[1] destination'))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each(['cash$literal', 'percent%literal', 'tick`literal'])
    ('uses decoded static quoted source values without guessing variables: %s', source => {
      const root = tempDir('e20-copy-literal-meta-');
      write(path.join(root, source, 'readme.md'), 'ordinary');
      const direct = `cp -R '${source}' destination`;
      const wrapped = "sh -c '" + direct.replace(/'/g, "'\\''") + "'";
      expect(copyPolicy(root, direct).decision).toBe('allow');
      expect(copyPolicy(root, wrapped).decision).toBe('allow');
      write(path.join(root, source, 'deep/.sdlc.yaml'), 'version: 1');
      expect(copyPolicy(root, direct)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
      expect(copyPolicy(root, wrapped)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each(['source[1]', "'source[1]'"])
    ('keeps PowerShell provider wildcard uncertainty despite shell quoting: %s', source => {
      const root = tempDir('e20-copy-provider-glob-');
      write(path.join(root, 'source[1]/readme.md'), 'ordinary literal path');
      write(path.join(root, 'source1/deep/.sdlc.yaml'), 'expanded state source');
      expect(copyPolicy(root, `Copy-Item -LiteralPath ${source} -Destination destination -Recurse`).decision)
        .toBe('allow');
      expect(copyPolicy(root, `Copy-Item -Path ${source} -Destination destination -Recurse`))
        .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
    });

  it.each([
    'cp $E20_FLAGS source destination',
    'cp "$E20_FLAGS" source destination',
    "sh -c 'cp $E20_FLAGS source destination'",
    "sh -c 'cp \"$E20_FLAGS\" source destination'",
  ])('does not assume an unknown argument cannot enable recursion: %s', command => {
    const root = tempDir('e20-copy-unknown-flags-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it.each(['cp file.txt copied.txt', 'cp --help', 'cp --version'])('retains a static ordinary operation: %s', command => {
    const root = tempDir('e20-copy-static-');
    write(path.join(root, 'file.txt'), 'ordinary');
    expect(copyPolicy(root, command).decision).toBe('allow');
  });

  it('keeps a comma in a native POSIX source filename rather than a PowerShell argument list', () => {
    const root = tempDir('e20-copy-posix-comma-');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'unrelated state');
    write(path.join(root, 'source,plain/readme.md'), 'ordinary literal path');
    expect(copyPolicy(root, 'cp -R source,plain destination').decision).toBe('allow');
    write(path.join(root, 'source,plain/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, 'cp -R source,plain destination'))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('Known PowerShell copy aliases retain their parameter profile', () => {
  it.each([
    "pwsh -c 'cp -Destination destination -LiteralPath source -Recurse'",
    "powershell -Command 'copy -Destination destination -Path source -Recurse'",
    "powershell -Command 'cp.exe -R -t destination source'",
    "sh -c 'cp -R -t destination source'",
  ])('distinguishes a standard alias from an explicit native cp executable: %s', command => {
    const root = tempDir('e20-copy-profile-');
    write(path.join(root, 'source/readme.md'), 'ordinary');
    expect(copyPolicy(root, command).decision).toBe('allow');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('Shell field expansion precedes copy operand binding', () => {
  it.each([
    "sh -c 'robocopy source[1] destination /E'",
    "sh -c 'xcopy source[1] destination /E'",
    "sh -c 'cp.exe -R source[1] destination'",
  ])('retains outer POSIX field uncertainty for every native copy profile: %s', command => {
    const root = tempDir('e20-copy-native-source-fields-');
    write(path.join(root, 'source[1]/readme.md'), 'ordinary literal path');
    write(path.join(root, 'source1/deep/.sdlc.yaml'), 'expanded state source');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('does not let LiteralPath suppress expansion by an explicit outer POSIX shell', () => {
    const root = tempDir('e20-copy-literalpath-shell-');
    write(path.join(root, 'source[1]/readme.md'), 'ordinary literal path');
    write(path.join(root, 'source1/deep/.sdlc.yaml'), 'expanded state source');
    const quoted = 'sh -c "Copy-Item -LiteralPath \'source[1]\' -Destination destination -Recurse"';
    expect(copyPolicy(root, quoted).decision).toBe('allow');
    const expanded = "sh -c 'Copy-Item -LiteralPath source[1] -Destination destination -Recurse'";
    expect(copyPolicy(root, expanded)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('does not assume a glob in the apparent destination cannot introduce another source', () => {
    const root = tempDir('e20-copy-destination-fields-');
    write(path.join(root, 'source/readme.md'), 'ordinary');
    write(path.join(root, 'destination1/deep/.sdlc.yaml'), 'expanded state source');
    write(path.join(root, 'destination2/readme.md'), 'ordinary destination');
    write(path.join(root, 'destination[12]/readme.md'), 'ordinary literal destination');
    expect(copyPolicy(root, "cp -R source 'destination[12]'").decision).toBe('allow');
    expect(copyPolicy(root, 'cp -R source destination[12]'))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });
});

describe('GNU cp target-directory short-option binding', () => {
  it.each([
    'cp -Rt destination source',
    'cp -Rtdestination source',
    'cp -R -tdestination source',
    'cp -rt destination source',
    'cp -atdestination source',
    'cp -rvftdestination source',
    'cp.exe -Rt destination source',
    "powershell -Command 'cp.exe -Rtdestination source'",
    "sh -c 'cp -Rt destination source'",
    'cp -rT source destination',
    'cp -R --target-directory=destination source',
  ])('binds the target without dropping the actual source: %s', command => {
    const root = tempDir('e20-copy-short-target-');
    write(path.join(root, 'destination/readme.md'), 'ordinary destination');
    write(path.join(root, 'source/readme.md'), 'ordinary source');
    expect(copyPolicy(root, command).decision).toBe('allow');
    write(path.join(root, 'source/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, command)).toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('keeps a target-looking filename after end-of-options as source data', () => {
    const root = tempDir('e20-copy-short-target-data-');
    write(path.join(root, '-Rt/readme.md'), 'ordinary source');
    expect(copyPolicy(root, 'cp -R -- -Rt destination').decision).toBe('allow');
    write(path.join(root, '-Rt/deep/.sdlc.yaml'), 'version: 1');
    expect(copyPolicy(root, 'cp -R -- -Rt destination'))
      .toMatchObject({ decision: 'deny', rule: 'state-integrity' });
  });

  it('does not interpret R inside the attached target name as a recursive flag', () => {
    const root = tempDir('e20-copy-short-target-value-');
    write(path.join(root, 'R/readme.md'), 'ordinary destination');
    write(path.join(root, 'plain.txt'), 'ordinary source');
    expect(copyPolicy(root, 'cp -tR plain.txt').decision).toBe('allow');
  });
});
