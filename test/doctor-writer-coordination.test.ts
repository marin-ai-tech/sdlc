import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { writerLockFindings } from '../src/core/doctor-locks.js';
import { tempDir, write, read } from './helpers.js';

describe('Observational writer recovery diagnostics', () => {
  it('names protected partial coordination metadata even before a fixed lock exists', () => {
    const root = tempDir('sdlc-doctor-coordination-');
    const file = path.join(root, 'openspec/.sdlc/board.lock.writers',
      `${process.pid}-u-${'0'.repeat(64)}-${randomUUID()}.json`);
    write(file, '{partial');
    const before = fs.readdirSync(path.dirname(file));
    const checks = writerLockFindings(root, 'npx --no-install sdlc');
    expect(checks).toContainEqual(expect.objectContaining({ check: 'board writer', code: 'writer_coordination' }));
    expect(checks.find(check => check.check === 'board writer')?.fix).toMatch(/quiescen|stopped/i);
    expect(read(file)).toBe('{partial');
    expect(fs.readdirSync(path.dirname(file))).toEqual(before);
    expect(fs.existsSync(path.join(root, 'openspec/.sdlc/board.lock'))).toBe(false);
  });
});
