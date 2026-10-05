import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

/**
 * People write in openspec/backlog.md by hand; agents change it only through the CLI. A CLI write must change its
 * own item and nothing else: notes, unknown fields, fenced blocks, an unknown status and extra sections stay.
 */

const BACKLOG = [
  '# Backlog',
  '',
  'Order is priority.',
  '<!-- next-B: 5 -->',
  '<!-- next-E: 2 -->',
  'A paragraph the team wrote about how to use this backlog.',
  '',
  '## E1 Claims',
  'Goal: see status',
  'Epic note: talk to support first.',
  '',
  '### B1 [open] First',
  '- **Outcome**: o1',
  '- **Acceptance**:',
  '  - a1',
  'Note: ask Dana before starting.',
  '',
  '### B2 [open] Second',
  '- **Outcome**: o2',
  '- **Acceptance**:',
  '  - a2',
  '- **Owner**: Dana',
  '```text',
  '### B9 [open] not an item, only an example',
  '```',
  '',
  '### B3 [blocked] Waiting for legal',
  '- **Outcome**: o3',
  '- **Acceptance**:',
  '  - a3',
  '',
  '## Unassigned',
  '',
  '### B4 [open] Loose',
  '- **Outcome**: o4',
  '- **Acceptance**:',
  '  - a4',
  '',
  '## Notes',
  'Free text kept by people.',
  '',
].join('\n');

const HAND_WRITTEN = [
  'A paragraph the team wrote about how to use this backlog.',
  'Epic note: talk to support first.',
  'Note: ask Dana before starting.',
  '- **Owner**: Dana',
  '```text',
  '### B9 [open] not an item, only an example',
  '### B3 [blocked] Waiting for legal',
  '## Notes',
  'Free text kept by people.',
];

function project() {
  const root = tempDir('sdlc-backlog-keep-');
  const env = humanEnv(tempDir('sdlc-home-'));
  initGitRepo(root);
  git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
  const cli = (args: string[]) => runCli(args, root, env);
  expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
  const file = path.join(root, 'openspec/backlog.md');
  write(file, BACKLOG);
  return { cli, read: () => read(file) };
}

const lines = (text: string) => text.split('\n');

function expectHandWrittenKept(text: string): void {
  for (const line of HAND_WRITTEN) expect(lines(text), line).toContain(line);
}

describe('CLI writes keep what people wrote in the backlog', () => {
  it('editing one item changes only that item\'s line; every other byte stays', () => {
    const p = project();
    const r = p.cli(['backlog', 'edit', 'B1', '--title', 'First, renamed', '--json']);
    expect(r.code, r.stderr + r.stdout).toBe(0);
    const expected = BACKLOG.replace('### B1 [open] First\n', '### B1 [open] First, renamed\n');
    expect(p.read()).toBe(expected);
  });

  it('notes and unknown fields under the edited item stay under it', () => {
    const p = project();
    expect(p.cli(['backlog', 'edit', 'B2', '--outcome', 'o2 sharper', '--json']).code).toBe(0);
    const text = lines(p.read());
    const at = text.indexOf('### B2 [open] Second');
    const next = text.indexOf('### B3 [blocked] Waiting for legal');
    const block = text.slice(at, next);
    expect(block).toContain('- **Outcome**: o2 sharper');
    expect(block).toContain('- **Owner**: Dana');
    expect(block).toContain('### B9 [open] not an item, only an example');
    expectHandWrittenKept(p.read());
  });

  it('add, done and an epic edit keep the notes, the unknown status and the extra sections', () => {
    const p = project();
    expect(p.cli(['backlog', 'add', 'Fifth', '--epic', 'E1', '--json']).code).toBe(0);
    expectHandWrittenKept(p.read());
    expect(p.cli(['backlog', 'done', 'B4', '--note', 'shipped', '--json']).code).toBe(0);
    expectHandWrittenKept(p.read());
    expect(p.cli(['backlog', 'epic', 'edit', 'E1', '--title', 'Claims, phase 1', '--json']).code).toBe(0);
    expectHandWrittenKept(p.read());
    expect(lines(p.read())).toContain('## E1 Claims, phase 1');
  });

  it('a moved item takes its notes with it', () => {
    const p = project();
    expect(p.cli(['backlog', 'move', 'B1', '--after', 'B2', '--json']).code).toBe(0);
    const text = lines(p.read());
    const b1 = text.indexOf('### B1 [open] First');
    const note = text.indexOf('Note: ask Dana before starting.');
    expect(text.indexOf('### B2 [open] Second')).toBeLessThan(b1);
    expect(note).toBeGreaterThan(b1);
    const nextHeading = text.findIndex((line, index) => index > b1 && /^#{2,3} /.test(line));
    expect(note).toBeLessThan(nextHeading);
    expectHandWrittenKept(p.read());
  });

  it('negative: a fenced example is not an item, and notes are not fields', () => {
    const p = project();
    const items = p.cli(['backlog', 'list', '--json']).json().items as Array<{ id: string; outcome?: string }>;
    expect(items.map((item) => item.id)).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(items.find((item) => item.id === 'B1')!.outcome).toBe('o1');
  });
});
