import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBacklog, readBacklog } from '../src/core/backlog.js';
import { renderBacklog } from '../src/core/backlog-format.js';
import { editEpic } from '../src/core/backlog-epic-edit.js';
import { humanEnv, read, runCli, tempDir, write } from './helpers.js';

const SOURCE = [
  '# Backlog', '', '## E12 Field feedback', 'Goal: One integrated delivery',
  'Granularity: package', '<!-- owner note stays -->', '',
  '### B8 [open] First item', '- **Outcome**: First result', '- **Acceptance**:', '  - Works', '',
  '### B3 [open] Second item', '- **Outcome**: Second result', '- **Acceptance**:', '  - Works', '',
].join('\n');

describe('Remembered epic granularity', () => {
  it('actual backlog CLI persists and refines the bounded property without losing unknown notes or priority', () => {
    const root = tempDir('sdlc-granularity-cli-');
    const env = humanEnv(tempDir('sdlc-granularity-home-'));
    expect(runCli(['init', '--tools', 'none', '--json'], root, env).code).toBe(0);
    write(path.join(root, 'openspec/backlog.md'), SOURCE);
    const changed = runCli(['backlog', 'epic', 'edit', 'E12', '--granularity', 'small', '--json'], root, env);
    expect(changed.code, changed.stdout + changed.stderr).toBe(0);
    expect(changed.json().epic.granularity).toBe('small');
    const before = read(path.join(root, 'openspec/backlog.md'));
    expect(runCli(['backlog', 'epic', 'edit', 'E12', '--granularity', 'unbounded', '--json'], root, env).code).toBe(1);
    expect(read(path.join(root, 'openspec/backlog.md'))).toBe(before);
    expect(before).toContain('<!-- owner note stays -->');
    expect(readBacklog(root).items.map((item) => item.id)).toEqual(['B8', 'B3']);
  }, 120000);

  it('parses and round-trips the explicit E12 package choice with unknown text and item order', () => {
    const backlog = parseBacklog(SOURCE);
    expect(backlog.epics[0]).toMatchObject({ id: 'E12', granularity: 'package' });
    const again = parseBacklog(renderBacklog(backlog, SOURCE));
    expect(again.epics[0]).toMatchObject({ granularity: 'package' });
    expect(again.items.map((item) => item.id)).toEqual(['B8', 'B3']);
    expect(renderBacklog(backlog, SOURCE)).toContain('<!-- owner note stays -->');
  });

  it('persists a bounded CLI refinement and retains it through an unrelated title edit', () => {
    const root = tempDir('sdlc-granularity-');
    write(path.join(root, 'openspec/backlog.md'), SOURCE);
    const refinement = { granularity: 'feature' } as Parameters<typeof editEpic>[2];
    expect(editEpic(root, 'E12', refinement)).toMatchObject({ granularity: 'feature' });
    editEpic(root, 'E12', { title: 'Refined title' });
    expect(readBacklog(root).epics[0]).toMatchObject({ granularity: 'feature' });
    const before = read(path.join(root, 'openspec/backlog.md'));
    const invalid = { granularity: 'unbounded' } as Parameters<typeof editEpic>[2];
    expect(() => editEpic(root, 'E12', invalid)).toThrow();
    expect(read(path.join(root, 'openspec/backlog.md'))).toBe(before);
    expect(readBacklog(root).items.map((item) => item.id)).toEqual(['B8', 'B3']);
  });

  it('positive control: absent granularity and unknown future metadata survive unrelated edits', () => {
    const root = tempDir('sdlc-granularity-legacy-');
    write(path.join(root, 'openspec/backlog.md'), SOURCE.replace('Granularity: package', 'Future: preserve'));
    editEpic(root, 'E12', { goal: 'Updated goal' });
    expect(readBacklog(root).epics[0]).not.toHaveProperty('granularity');
    expect(read(path.join(root, 'openspec/backlog.md'))).toContain('Future: preserve');
  });
});
