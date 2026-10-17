import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLog } from '../src/core/log.js';
import { tempDir, write } from './helpers.js';

/**
 * Review of 0.23.1 part A (Б4): `readLog` returns the shared log in file order, then the local hook decision queue in
 * file order. The shared log is merged from several people's branches (`merge=union`) whose clocks differ, so its
 * entries are not re-sorted by time.
 */

const entry = (event: string, ts: string) => JSON.stringify({ ts, event, sdlc: '0.0.0', license: 'community' });

describe('Б4 review: the log keeps file order', () => {
  it('the shared log out of time order is returned unchanged, followed by the queue', () => {
    const root = tempDir('sdlc-log-order-');
    write(path.join(root, 'openspec/.sdlc/log.jsonl'), [
      entry('change.created', '2026-10-17T10:00:00.000Z'),
      entry('gate.approved', '2026-10-17T09:00:00.000Z'),
      entry('change.archived', '2026-10-17T08:00:00.000Z'),
      '',
    ].join('\n'));
    write(path.join(root, 'openspec/.sdlc/hook-log.jsonl'), [
      entry('hook.denied', '2026-10-17T07:00:00.000Z'),
      entry('hook.warned', '2026-10-17T06:00:00.000Z'),
      '',
    ].join('\n'));
    expect(readLog(root).map((e) => e.event)).toEqual([
      'change.created', 'gate.approved', 'change.archived', 'hook.denied', 'hook.warned',
    ]);
  });

  it('negative: without a queue only the shared log is read, and a malformed line is skipped', () => {
    const root = tempDir('sdlc-log-order-');
    write(path.join(root, 'openspec/.sdlc/log.jsonl'), [
      entry('b', '2026-10-17T10:00:00.000Z'), '{not json', entry('a', '2026-10-17T09:00:00.000Z'), '',
    ].join('\n'));
    expect(readLog(root).map((e) => e.event)).toEqual(['b', 'a']);
  });
});
