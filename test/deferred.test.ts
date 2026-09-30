import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDeferred, closeDeferred, DEFERRED_PATH, parseDeferred, readDeferred } from '../src/core/deferred.js';
import { git, humanEnv, initGitRepo, read, runCli, tempDir, write } from './helpers.js';

const NOW = new Date('2026-09-30T12:00:00Z');

describe('deferred-work registry (core)', () => {
  it('a missing file is an empty registry', () => {
    expect(readDeferred(tempDir())).toEqual([]);
  });

  it('adds items with increasing ids and a header, one field per line', () => {
    const root = tempDir();
    const d1 = addDeferred(root, { title: 'Rate-limit export', why: 'not needed for the pilot', change: 'add-export', finding: 'F2', revisit: 'before GA', by: 'Pat <pat@example.com>' }, NOW);
    const d2 = addDeferred(root, { title: 'Streaming export', why: 'large tenants only' }, NOW);
    expect(d1).toMatchObject({ id: 'D1', status: 'open', title: 'Rate-limit export', change: 'add-export', finding: 'F2', why: 'not needed for the pilot', revisit: 'before GA' });
    expect(d2.id).toBe('D2');
    const text = read(path.join(root, DEFERRED_PATH));
    expect(text).toMatch(/^# /);
    expect(text).toContain('### D1 [open] Rate-limit export');
    expect(text).toContain('- **Finding**: F2');
    expect(text).toMatch(/- \*\*Created\*\*: 2026-09-30 by Pat <pat@example\.com>/);
    expect(readDeferred(root).map((d) => d.id)).toEqual(['D1', 'D2']);
  });

  it('never reuses an id, even after items are removed by hand', () => {
    const root = tempDir();
    write(path.join(root, DEFERRED_PATH), '# Deferred work\n\n### D7 [done] Old thing\n- **Why**: x\n');
    expect(addDeferred(root, { title: 'Next', why: 'y' }, NOW).id).toBe('D8');
  });

  it('closes an item as done or dropped with a dated note', () => {
    const root = tempDir();
    addDeferred(root, { title: 'A', why: 'x' }, NOW);
    const closed = closeDeferred(root, 'D1', 'done', 'shipped in add-rate-limits', NOW);
    expect(closed).toMatchObject({ id: 'D1', status: 'done' });
    expect(read(path.join(root, DEFERRED_PATH))).toContain('### D1 [done] A');
    expect(closed.closed).toMatch(/2026-09-30 done/);
    expect(closed.closed).toContain('shipped in add-rate-limits');
  });

  it('negative: unknown id, closing twice and multi-line input are refused', () => {
    const root = tempDir();
    addDeferred(root, { title: 'A', why: 'x' }, NOW);
    expect(() => closeDeferred(root, 'D9', 'done', 'n', NOW)).toThrow(/D9/);
    closeDeferred(root, 'D1', 'dropped', 'no longer needed', NOW);
    expect(() => closeDeferred(root, 'D1', 'done', 'again', NOW)).toThrow(/open/);
    expect(() => addDeferred(root, { title: 'two\nlines', why: 'x' }, NOW)).toThrow();
    expect(() => addDeferred(root, { title: 'ok', why: 'x\ny' }, NOW)).toThrow();
  });

  it('parses tolerantly: prose, unknown statuses and malformed headings', () => {
    const items = parseDeferred([
      '# Deferred work', '', 'Some prose here.', '',
      '### D1 [open] First', '- **Why**: because', '- **Revisit when**: later',
      '### not an item', '',
      '### D2 [weird] Second', '* **Change**: c-2',
      '```', '### D3 [open] inside a code block', '```',
    ].join('\n'));
    expect(items.map((i) => [i.id, i.status, i.title])).toEqual([['D1', 'open', 'First'], ['D2', 'open', 'Second']]);
    expect(items[0]).toMatchObject({ why: 'because', revisit: 'later', line: 5 });
    expect(items[1].change).toBe('c-2');
  });
});

describe('sdlc defer (CLI)', () => {
  function project() {
    const root = tempDir('sdlc-defer-');
    const env = humanEnv(tempDir('sdlc-home-'));
    initGitRepo(root);
    git(root, ['commit', '-q', '--allow-empty', '-m', 'init']);
    const cli = (args: string[], extra: NodeJS.ProcessEnv = {}) => runCli(args, root, { ...env, ...extra });
    expect(cli(['init', '--tools', 'none', '--json']).code).toBe(0);
    return { root, cli };
  }

  it('add, list and close; logged; agents may add', () => {
    const { root, cli } = project();
    const a = cli(['defer', 'add', 'Rate-limit export', '--why', 'pilot only', '--change', 'add-export', '--finding', 'F2', '--revisit', 'before GA', '--json']);
    expect(a.code, a.stderr).toBe(0);
    expect(a.json().item).toMatchObject({ id: 'D1', status: 'open', finding: 'F2' });
    const b = cli(['defer', 'add', 'Streaming export', '--why', 'large tenants', '--json'], { CLAUDECODE: '1' });
    expect(b.code, b.stderr).toBe(0);

    const list = cli(['defer', 'list', '--json']).json();
    expect(list.items.map((i: { id: string }) => i.id)).toEqual(['D1', 'D2']);
    expect(cli(['defer', 'list', '--change', 'add-export', '--json']).json().items.map((i: { id: string }) => i.id)).toEqual(['D1']);

    const closed = cli(['defer', 'close', 'D1', '--status', 'done', '--note', 'shipped', '--json']);
    expect(closed.code, closed.stderr).toBe(0);
    expect(cli(['defer', 'list', '--open', '--json']).json().items.map((i: { id: string }) => i.id)).toEqual(['D2']);

    const events = read(path.join(root, 'openspec/.sdlc/log.jsonl')).trim().split('\n').map((l) => JSON.parse(l).event);
    expect(events.filter((e: string) => e === 'deferred.added')).toHaveLength(2);
    expect(events).toContain('deferred.closed');
  });

  it('text list is a table whose columns line up', () => {
    const { cli } = project();
    cli(['defer', 'add', 'Short', '--why', 'x', '--change', 'a', '--json']);
    cli(['defer', 'add', 'A much longer deferred title', '--why', 'y', '--change', 'add-export', '--json']);
    cli(['defer', 'close', 'D1', '--status', 'dropped', '--note', 'n', '--json']);
    const lines = cli(['defer', 'list']).stdout.split('\n').filter((l) => l.trim() !== '');
    const header = lines.find((l) => /\bID\b/.test(l) && /\bTitle\b/.test(l))!;
    expect(header).toBeDefined();
    const rows = lines.filter((l) => /^\s*D\d+\s/.test(l));
    expect(rows).toHaveLength(2);
    for (const column of ['Status', 'Title', 'Change']) {
      const at = header.indexOf(column);
      for (const row of rows) {
        expect(row.charAt(at - 1), `${column} column in "${row}"`).toBe(' ');
        expect(row.charAt(at), `${column} column in "${row}"`).not.toBe(' ');
      }
    }
  });

  it('negative: add without --why and close without --note are refused', () => {
    const { cli } = project();
    expect(cli(['defer', 'add', 'No reason', '--json']).code).toBe(1);
    cli(['defer', 'add', 'A', '--why', 'x', '--json']);
    expect(cli(['defer', 'close', 'D1', '--status', 'done', '--json']).code).toBe(1);
    expect(cli(['defer', 'close', 'D1', '--status', 'maybe', '--note', 'n', '--json']).code).toBe(1);
  });

  it('report and dashboard show the open items', () => {
    const { root, cli } = project();
    cli(['defer', 'add', 'Streaming export', '--why', 'large tenants', '--json']);
    cli(['defer', 'add', 'Old idea', '--why', 'x', '--json']);
    cli(['defer', 'close', 'D2', '--status', 'dropped', '--note', 'n', '--json']);
    const model = cli(['report', '--json']).json();
    expect(model.deferred.open).toBe(1);
    expect(model.deferred.items.map((i: { id: string }) => i.id)).toEqual(['D1']);
    expect(cli(['report', '--format', 'md']).stdout).toMatch(/Deferred[\s\S]*D1[\s\S]*Streaming export/);
    const html = cli(['dashboard']).stdout;
    // Only the Deferred work section: the timeline legitimately shows the deferred.closed log entry.
    const start = html.indexOf('<h2 id="deferred"');
    expect(start).toBeGreaterThan(-1);
    const section = html.slice(start, html.indexOf('</section>', start));
    expect(section).toContain('Streaming export');
    expect(section).not.toContain('Old idea');
    expect(fs.existsSync(path.join(root, DEFERRED_PATH))).toBe(true);
  });
});
