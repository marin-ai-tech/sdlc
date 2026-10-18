import { describe, expect, it } from 'vitest';
import { unifiedDiff } from '../src/core/line-diff.js';

function changes(diff: string): string[] {
  return diff.split('\n').filter((line) => /^[+-]/.test(line) && !/^(---|\+\+\+) /.test(line));
}

describe('line diff', () => {
  it('normalizes line ends and keeps unchanged lines out of add/remove rows', () => {
    const before = 'a\r\nb\r\nc\r\nd\r\n';
    const after = 'a\r\nB\r\nc\r\nd\r\ne\r\n';
    const diff = unifiedDiff(before, after);
    expect(changes(diff)).toEqual(['-b', '+B', '+e']);
    expect(diff).not.toContain('\\u000d');
  });

  it('shows a minimal insertion in a large file with context', () => {
    const lines = Array.from({ length: 3000 }, (_, index) => `line ${index}`);
    const after = [...lines.slice(0, 1500), 'inserted', ...lines.slice(1500)];
    const diff = unifiedDiff(lines.join('\n'), after.join('\n'));
    expect(changes(diff)).toEqual(['+inserted']);
    expect(diff).not.toContain('line 1000');
  });

  it('aligns repeated lines across separate edits', () => {
    const before = ['a', 'repeat', 'b', 'repeat', 'c', 'd'].join('\n');
    const after = ['a', 'repeat', 'B', 'repeat', 'c', 'D'].join('\n');
    expect(changes(unifiedDiff(before, after))).toEqual(['-b', '+B', '-d', '+D']);
  });
});
