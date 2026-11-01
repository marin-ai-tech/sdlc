import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config.js';
import { callsHumanCommand, callsNamedHumanCommand } from '../src/core/human-command-match.js';
import { evaluateToolCall, normalizeToolCall } from '../src/core/policy.js';
import { projectPaths } from '../src/core/project.js';
import { tempDir, write } from './helpers.js';

function shell(command: string, root = tempDir('e20-shell-')) {
  const config = defaultConfig();
  config.enforcement.mode = 'warn';
  return evaluateToolCall(normalizeToolCall('Bash', { command }, root), { paths: projectPaths(root), config });
}

describe('Bounded shell-word enforcement (approved D4)', () => {
  it.each(['sdlc "approve" plan', 'sdlc ap""prove plan', "sdlc a'p'prove plan", 'sdlc ap\\prove plan',
    "sdlc $'appr\\x6fve' plan", 'sdlc ap`prove plan'])('recognizes a static person command: %s', (command) => {
    expect(callsHumanCommand(command)).toBe(true);
  });

  it.each(['sdlc approve --help', 'sdlc --help approve', 'sdlc approve -h',
    'echo "sdlc approve plan"', 'node app.js sdlc approve plan'])('does not submit a decision: %s', (command) => {
    expect(callsHumanCommand(command)).toBe(false);
  });

  it('recognizes decoded plugin command names without interpreting ordinary argument data', () => {
    expect(callsNamedHumanCommand('sdlc eco""nomy settle', ['economy settle'])).toBe(true);
    expect(callsNamedHumanCommand('echo "sdlc economy settle"', ['economy settle'])).toBe(false);
  });

  it('quotes only the submitted decision in a compound command', () => {
    const result = shell('echo harmless && sdlc approve plan --change demo && echo afterwards');
    expect(result).toMatchObject({ decision: 'deny', rule: 'separation-of-duties' });
    expect(result.reason).toContain('sdlc approve plan --change demo');
    expect(result.reason).not.toContain('echo harmless');
    expect(result.reason).not.toContain('echo afterwards');
  });

  it.each(["grep 'x' openspec/backlog.md", "sed -n '1,5p' openspec/.sdlc/log.jsonl",
    "awk '{print $1}' openspec/backlog.md", "node -e 'const f = () => 1; console.log(f())'",
    'git status 2>/dev/null'])('permits an otherwise harmless read: %s', (command) => {
    expect(shell(command).decision).not.toBe('deny');
  });

  it('does not treat a Node positional project root as a write target', () => {
    const root = tempDir('e20-shell-positional-');
    expect(shell(`node app.js "${root}"`, root).decision).not.toBe('deny');
  });

  it.each(["sed -n 'w openspec/backlog.md' input.txt", "awk 'BEGIN {print 1 > \"openspec/backlog.md\"}'",
    'grep x README.md > openspec/backlog.md', 'sdlc approve --help; sdlc approve plan'])
    ('retains actual side-effect restrictions: %s', (command) => {
      expect(shell(command).decision).toBe('deny');
    });

  it.each(['vic""tim', "v'i'ctim", 'vic\\tim', 'vic`tim', "$'vic\\x74im'"])
    ('honors a decoded held change: %s', (id) => {
      const root = tempDir('e20-held-');
      write(path.join(root, 'openspec/changes/victim/.sdlc.yaml'),
        'version: 1\nkind: feature\nrisk: low\ntakeover:\n  by: Owner\n  at: 2026-10-30\n  note: held\n');
      expect(shell(`sdlc stamp --change ${id}`, root)).toMatchObject({ decision: 'deny', rule: 'takeover' });
      expect(shell(`sdlc status --change ${id}`, root).decision).not.toBe('deny');
      expect(shell('sdlc stamp --change another', root).decision).not.toBe('deny');
    });
});
