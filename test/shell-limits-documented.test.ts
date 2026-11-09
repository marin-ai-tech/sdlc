import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.js';

/**
 * B248.L1 and L3: the limits of the hook's static reading are written down where people look (the architecture, the
 * guide, `sdlc guide denials`), so nobody takes the hook for a security boundary, and the old known limit on shell
 * variables is gone.
 */

const DOCUMENTS = ['docs/en/04-architecture.md', 'docs/en/05-guide.md', 'assets/guide/en/denials.md'];
const read = (file: string) => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/\s+/g, ' ');

/** A section of a document: from a heading that matches to the next heading of the same or a higher level. */
function limitsSection(text: string): string {
  const start = text.search(/#+ [^#]*limits of (?:a|the) static reading/i);
  return start < 0 ? '' : text.slice(start, start + 6000);
}

const NAMED_LIMITS: Array<[string, RegExp]> = [
  ['an earlier shell call', /earlier shell call/i],
  ['an export read by a script', /export(?:ed)? .{0,40}read by a script|script .{0,40}reads? an export/i],
  ['a script given a protected path', /script .{0,60}protected path/i],
  ['a program the agent wrote', /program the agent wrote/i],
  ['source, aliases and functions', /source.{0,40}alias.{0,40}function/i],
  ['xargs', /xargs/],
  ['values read at run time', /read at run time/i],
  ['printf -v', /printf -v/],
  ['find -delete', /find .{0,20}-delete/],
  ['mkdir', /mkdir/],
  ['git stash, reset and clean after the plan', /git stash.{0,80}reset.{0,80}clean.{0,120}after the plan/i],
  ['branch switches, merges, pulls and rebases', /switch.{0,80}merge.{0,80}pull.{0,80}rebase/i],
  ['the plan gate after an unresolved directory', /plan gate.{0,120}(?:unresolved|cannot be resolved)/i],
  ['the spelling limit', /16 /],
  ['the work budget in words', /times its words pass 512/],
  ['the time limit on literal work', /spellings with values has half a second.{0,200}added spellings has 5 s/],
  ['one long step of the added checks', /one long step of the added checks.{0,240}watchdog/],
  ['a quoted } in a default text', /quoted or escaped `\}` in the default text/],
  ['a comment after a PowerShell assignment', /PowerShell assignment followed by a comment/],
  ['a quoted # or a block comment before a target', /quoted `#` or a `<# #>` block/],
  ['a variable cd before a shell body', /`cd` to a variable before a nested shell body/],
];

describe('B248.L1: the limits are written down', () => {
  it.each(DOCUMENTS)('%s has a section on the limits of a static reading', (file) => {
    expect(limitsSection(read(file)), file).not.toBe('');
  });

  it.each(DOCUMENTS.flatMap((file) => NAMED_LIMITS.map(([name, pattern]) => [file, name, pattern] as const)))(
    '%s names %s', (file, _name, pattern) => {
      expect(limitsSection(read(file))).toMatch(pattern);
    },
  );

  it.each(DOCUMENTS)('%s says the hook is not a security boundary and points to signing', (file) => {
    const section = limitsSection(read(file));
    expect(section).toMatch(/not a security boundary/i);
    expect(section).toContain('sdlc approvals verify --mode required');
  });

  it.each(DOCUMENTS)('%s says how to make a temporary file without a substitution', (file) => {
    expect(limitsSection(read(file))).toMatch(/plain `?mktemp`?/i);
  });
});

describe('B248.L3: the old known limit is gone', () => {
  it.each(DOCUMENTS)('%s no longer says a write through a literal variable passes', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/write through a shell variable that holds a literal path is not followed/i);
    expect(text).not.toMatch(/Known limit: a write through a shell variable/i);
  });

  it('the architecture says what is followed now', () => {
    expect(limitsSection(read('docs/en/04-architecture.md'))).toMatch(/literal assignment.{0,80}same command/i);
  });
});
