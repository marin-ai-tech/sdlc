import { describe, expect, it } from 'vitest';
import { humanEnv, runCli, tempDir } from './helpers.js';

/**
 * The owner's remark (2026-10-15): a guide table wider than the terminal wrapped the whole line at the window edge,
 * so its third column broke across the next row. A table now fits the window: the widest columns are narrowed and
 * their cells wrap by words onto continuation lines that keep the columns aligned. The width is the terminal's
 * (`process.stdout.columns`), or COLUMNS when the output is not a terminal; without either the table keeps its
 * natural width.
 */

function guide(extra: NodeJS.ProcessEnv, args: string[] = ['guide', 'lifecycle']) {
  const env = humanEnv(tempDir('sdlc-home-'), extra);
  const r = runCli(args, tempDir('sdlc-guide-width-'), env);
  expect(r.code, r.stderr).toBe(0);
  return r.stdout;
}

/** The lines of the stage table: from its header to the blank line after it. */
function tableOf(text: string, header: RegExp): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => header.test(line));
  const end = lines.findIndex((line, index) => index > start && line.trim() === '');
  return lines.slice(start, end < 0 ? undefined : end);
}

const length = (line: string) => Array.from(line).length;
const words = (text: string) => text.split(/\s+/).filter(Boolean);

describe('guide tables fit the terminal', () => {
  it('at 80 columns every table line fits, and no word of a cell is lost', () => {
    const natural = tableOf(guide({}), /^Stage\s+What is written/);
    const narrow = tableOf(guide({ COLUMNS: '80' }), /^Stage\s+What is written/);
    expect(Math.max(...natural.map(length))).toBeGreaterThan(80);
    for (const line of narrow) expect(length(line), line).toBeLessThanOrEqual(80);
    const content = (table: string[]) => words(table.filter((_, index) => index !== 1).join(' ')).sort();
    expect(content(narrow)).toEqual(content(natural));
    expect(narrow.length).toBeGreaterThan(natural.length);
  }, 120000);

  it('a wrapped cell continues in its own column: continuation lines start blank in the first column', () => {
    const narrow = tableOf(guide({ COLUMNS: '80' }), /^Stage\s+What is written/);
    const firstColumn = /^Stage(\s+)/.exec(narrow[0])?.[0].length ?? 0;
    const rows = narrow.slice(2);
    const continuation = rows.filter((line) => /^\s/.test(line));
    expect(continuation.length).toBeGreaterThan(0);
    for (const line of continuation) expect(line.slice(0, firstColumn).trim(), line).toBe('');
    for (const stage of ['plan', 'design', 'build', 'test', 'deploy', 'maintain']) {
      expect(rows.some((line) => line.startsWith(`${stage} `)), stage).toBe(true);
    }
  }, 120000);

  it('the English; a wide window and no width keep the natural table', () => {
    const natural = tableOf(guide({}), /^Stage\s+What is written/);
    const wide = tableOf(guide({ COLUMNS: '200' }), /^Stage\s+What is written/);
    expect(wide).toEqual(natural);
  }, 120000);
  });
