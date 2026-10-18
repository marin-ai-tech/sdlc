import { describe, expect, it } from 'vitest';
import { maskNoteArguments } from '../src/core/person-note.js';

const TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8';

function masked(args: string[]): string[] {
  const argv = ['node', 'sdlc', ...args];
  expect(maskNoteArguments(argv)).toBe(true);
  expect(argv.join(' ')).not.toContain(TOKEN);
  return argv.slice(2);
}

describe('recorded free text is masked before command parsing', () => {
  it('masks config proposal and board reopening reasons', () => {
    expect(masked(['config', 'propose', '--reason', `Token ${TOKEN}`])[3]).toContain('[masked: GitHub token]');
    expect(masked(['board', 'reopen', `--reason=Token ${TOKEN}`])[2]).toContain('[masked: GitHub token]');
  });

  it('masks backlog titles and other fields that reach the backlog file', () => {
    const args = masked([
      'backlog', 'add', `Title ${TOKEN}`, '--outcome', `Outcome ${TOKEN}`,
      `--accept=Accept ${TOKEN}`,
    ]);
    expect(args[2]).toContain('[masked: GitHub token]');
    expect(args[4]).toContain('[masked: GitHub token]');
    expect(args[5]).toContain('[masked: GitHub token]');
  });

  it('keeps rework reason categories intact', () => {
    const argv = ['node', 'sdlc', 'rework', 'spec', '--reason', 'missing-requirement'];
    expect(maskNoteArguments(argv)).toBe(false);
    expect(argv[5]).toBe('missing-requirement');
  });
});
